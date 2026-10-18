import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../products/product.entity';
import { CartItem } from './cart-item.entity';
import { Cart } from './cart.entity';
import { CartView, toCartView } from './cart.view';

/**
 * Cart reads and mutations.
 *
 * Every mutation re-reads the cart, refuses it if the cart is no longer open,
 * and returns the whole cart afterwards so a client never has to guess what
 * the change produced.
 *
 * Inventory is deliberately not consulted here. A cart may hold more units
 * than exist; the claim happens inside the checkout transaction, which is the
 * only place that can make it atomic.
 */
@Injectable()
export class CartsService {
  constructor(
    @InjectRepository(Cart) private readonly carts: Repository<Cart>,
    @InjectRepository(CartItem) private readonly items: Repository<CartItem>,
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
    return toCartView(await this.loadCart(cartId));
  }

  /**
   * Adds a product to a cart, or raises the quantity if it is already there.
   *
   * Adding twice sums rather than failing: clients do resend "add to cart",
   * and `cart_items_cart_product_unique` makes a duplicate row impossible
   * anyway, so rejecting it would buy nothing.
   *
   * @param cartId Cart to add to.
   * @param productId Product to add; must exist in the catalog.
   * @param quantity Units to add, already validated as 1..10000 by the DTO.
   * @returns The cart after the change.
   * @throws NotFoundException `CART_NOT_FOUND` or `PRODUCT_NOT_FOUND`.
   * @throws ConflictException `CART_ALREADY_CHECKED_OUT` if the cart is closed.
   */
  async addItem(cartId: string, productId: string, quantity: number): Promise<CartView> {
    const cart = await this.loadCart(cartId);
    this.assertOpen(cart);
    await this.assertProductExists(productId);

    const existing = cart.items.find((item) => item.productId === productId);
    if (existing) {
      await this.items.update(existing.id, { quantity: existing.quantity + quantity });
    } else {
      await this.items.insert({ cartId, productId, quantity });
    }
    return this.view(cartId);
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
    const cart = await this.loadCart(cartId);
    this.assertOpen(cart);
    const existing = this.findItem(cart, productId);

    await this.items.update(existing.id, { quantity });
    return this.view(cartId);
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
    const cart = await this.loadCart(cartId);
    this.assertOpen(cart);
    const existing = this.findItem(cart, productId);

    await this.items.delete(existing.id);
    return this.view(cartId);
  }

  /**
   * Loads a cart with its lines and their products.
   *
   * Shared with checkout, which needs the same lines and the same failure
   * code before it opens its transaction.
   *
   * @param cartId Cart to load.
   * @returns The cart entity with `items` and each item's `product` populated.
   * @throws NotFoundException `CART_NOT_FOUND` if no such cart exists.
   */
  async loadCart(cartId: string): Promise<Cart> {
    const cart = await this.carts.findOne({
      where: { id: cartId },
      relations: { items: { product: true } },
    });
    if (!cart) {
      throw new NotFoundException({ code: 'CART_NOT_FOUND', message: `No cart ${cartId}` });
    }
    return cart;
  }

  /**
   * Guards every mutation: a checked out cart is immutable, because the order
   * it produced already quoted these exact lines.
   *
   * This is an ordinary read-then-check, so it is not a concurrency control.
   * Checkout re-checks the same thing under `SELECT ... FOR UPDATE`, which is
   * what actually makes a double checkout impossible.
   *
   * @param cart Cart to check.
   * @throws ConflictException `CART_ALREADY_CHECKED_OUT` if the cart is closed.
   */
  assertOpen(cart: Cart): void {
    if (cart.status !== 'open') {
      throw new ConflictException({
        code: 'CART_ALREADY_CHECKED_OUT',
        message: `Cart ${cart.id} has already been checked out`,
      });
    }
  }

  /**
   * Finds a line in an already-loaded cart.
   *
   * @param cart Cart whose lines are searched.
   * @param productId Product to find a line for.
   * @returns The matching line.
   * @throws NotFoundException `CART_ITEM_NOT_FOUND` if the cart has no such line.
   */
  private findItem(cart: Cart, productId: string): CartItem {
    const item = cart.items.find((candidate) => candidate.productId === productId);
    if (!item) {
      throw new NotFoundException({
        code: 'CART_ITEM_NOT_FOUND',
        message: `Cart ${cart.id} has no item for product ${productId}`,
      });
    }
    return item;
  }

  /**
   * Checks a product exists before an insert references it, so an unknown id
   * is a 404 with a code rather than a foreign key violation surfacing as 500.
   *
   * @param productId Product to check.
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
