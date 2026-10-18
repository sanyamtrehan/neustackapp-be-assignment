import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, Repository } from 'typeorm';
import { Product } from '../products/product.entity';
import { CartItem } from './cart-item.entity';
import { Cart } from './cart.entity';
import { CartView, toCartView } from './cart.view';

/** The cart row as the lock returns it; the lines are loaded separately. */
interface LockedCart {
  id: string;
  status: string;
}

/**
 * Cart reads and mutations.
 *
 * Every mutation runs in a transaction that starts by locking the cart row,
 * the same row checkout locks. Edits and checkout therefore queue behind each
 * other instead of interleaving, and two edits of one cart cannot both read
 * the same state before either writes.
 *
 * Inventory is deliberately not consulted here. A cart may hold more units
 * than exist; the claim happens inside the checkout transaction, which is the
 * only place that can make it atomic.
 */
@Injectable()
export class CartsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @InjectRepository(Cart) private readonly carts: Repository<Cart>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
  ) {}

  /**
   * Opens an empty cart.
   *
   * @returns The new cart, status `open`, no lines, subtotal zero.
   */
  async create(): Promise<CartView> {
    const cart = await this.carts.save(this.carts.create({ status: 'open' }));
    return toCartView(cart);
  }

  /**
   * Reads a cart, priced against the catalog as it is right now.
   *
   * @param cartId Cart to read.
   * @returns Lines with current unit prices, line totals and the subtotal.
   * @throws NotFoundException `CART_NOT_FOUND` if no such cart exists.
   */
  async view(cartId: string): Promise<CartView> {
    const cart = await this.carts.findOne({
      where: { id: cartId },
      relations: { items: { product: true } },
    });
    if (!cart) {
      throw new NotFoundException({ code: 'CART_NOT_FOUND', message: `No cart ${cartId}` });
    }
    return toCartView(cart);
  }

  /**
   * Adds a product to a cart, or raises the quantity if it is already there.
   *
   * Adding twice sums rather than failing: clients do resend "add to cart".
   * Because the cart row is locked first, two simultaneous adds queue, so the
   * second reads the first one's quantity instead of overwriting it.
   *
   * @param cartId Cart to add to.
   * @param productId Product to add; must exist in the catalog.
   * @param quantity Units to add, already validated as 1..10000 by the DTO.
   * @returns The cart after the change.
   * @throws NotFoundException `CART_NOT_FOUND` or `PRODUCT_NOT_FOUND`.
   * @throws ConflictException `CART_ALREADY_CHECKED_OUT` if the cart is closed.
   */
  async addItem(cartId: string, productId: string, quantity: number): Promise<CartView> {
    return this.mutate(cartId, async (manager) => {
      await this.assertProductExists(productId);

      const existing = await manager.findOneBy(CartItem, { cartId, productId });
      if (existing) {
        await manager.update(CartItem, existing.id, { quantity: existing.quantity + quantity });
      } else {
        await manager.insert(CartItem, { cartId, productId, quantity });
      }
    });
  }

  /**
   * Replaces the quantity on an existing line.
   *
   * Setting rather than adjusting, so a client retrying the same request twice
   * lands on the same quantity both times.
   *
   * @param cartId Cart holding the line.
   * @param productId Product whose line is being changed.
   * @param quantity New quantity, already validated as 1..10000 by the DTO.
   *   Removing a line is DELETE, not a quantity of zero.
   * @returns The cart after the change.
   * @throws NotFoundException `CART_NOT_FOUND` or `CART_ITEM_NOT_FOUND`.
   * @throws ConflictException `CART_ALREADY_CHECKED_OUT` if the cart is closed.
   */
  async setItemQuantity(cartId: string, productId: string, quantity: number): Promise<CartView> {
    return this.mutate(cartId, async (manager) => {
      const existing = await this.findItem(manager, cartId, productId);
      await manager.update(CartItem, existing.id, { quantity });
    });
  }

  /**
   * Removes a line from a cart.
   *
   * @param cartId Cart holding the line.
   * @param productId Product whose line is removed.
   * @returns The cart after the removal.
   * @throws NotFoundException `CART_NOT_FOUND` or `CART_ITEM_NOT_FOUND`.
   * @throws ConflictException `CART_ALREADY_CHECKED_OUT` if the cart is closed.
   */
  async removeItem(cartId: string, productId: string): Promise<CartView> {
    return this.mutate(cartId, async (manager) => {
      const existing = await this.findItem(manager, cartId, productId);
      await manager.delete(CartItem, existing.id);
    });
  }

  /**
   * Runs a cart change under the cart's row lock.
   *
   * Shared by every mutation so none can forget the lock or the open check,
   * which is what keeps an edit from landing in a cart that checkout has
   * already closed.
   *
   * @param cartId Cart to change.
   * @param change Work to do once the cart is locked and known open.
   * @returns The cart as it stands after the transaction commits.
   * @throws NotFoundException `CART_NOT_FOUND`.
   * @throws ConflictException `CART_ALREADY_CHECKED_OUT`.
   */
  private async mutate(
    cartId: string,
    change: (manager: EntityManager) => Promise<void>,
  ): Promise<CartView> {
    await this.dataSource.transaction(async (manager) => {
      const [cart] = (await manager.query(
        'SELECT "id", "status" FROM "carts" WHERE "id" = $1 FOR UPDATE',
        [cartId],
      )) as LockedCart[];

      if (!cart) {
        throw new NotFoundException({ code: 'CART_NOT_FOUND', message: `No cart ${cartId}` });
      }
      if (cart.status !== 'open') {
        throw new ConflictException({
          code: 'CART_ALREADY_CHECKED_OUT',
          message: `Cart ${cartId} has already been checked out`,
        });
      }

      await change(manager);
    });

    return this.view(cartId);
  }

  /**
   * Finds a line in a locked cart.
   *
   * @throws NotFoundException `CART_ITEM_NOT_FOUND` if the cart has no such line.
   */
  private async findItem(
    manager: EntityManager,
    cartId: string,
    productId: string,
  ): Promise<CartItem> {
    const item = await manager.findOneBy(CartItem, { cartId, productId });
    if (!item) {
      throw new NotFoundException({
        code: 'CART_ITEM_NOT_FOUND',
        message: `Cart ${cartId} has no item for product ${productId}`,
      });
    }
    return item;
  }

  /**
   * Checks a product exists before an insert references it, so an unknown id
   * is a 404 with a code rather than a foreign key violation surfacing as 500.
   *
   * @throws NotFoundException `PRODUCT_NOT_FOUND` if the catalog has no such product.
   */
  private async assertProductExists(productId: string): Promise<void> {
    if (!(await this.products.existsBy({ id: productId }))) {
      throw new NotFoundException({
        code: 'PRODUCT_NOT_FOUND',
        message: `No product ${productId}`,
      });
    }
  }
}
