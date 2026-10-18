import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Product } from '../products/product.entity';
import { CartItem } from './cart-item.entity';
import { Cart } from './cart.entity';
import { CartView, toCartView } from './cart.view';

@Injectable()
export class CartsService {
  constructor(
    @InjectRepository(Cart) private readonly carts: Repository<Cart>,
    @InjectRepository(CartItem) private readonly items: Repository<CartItem>,
    @InjectRepository(Product) private readonly products: Repository<Product>,
  ) {}

  async create(): Promise<CartView> {
    const cart = await this.carts.save(this.carts.create({ status: 'open' }));
    return toCartView(cart);
  }

  async view(cartId: string): Promise<CartView> {
    return toCartView(await this.loadCart(cartId));
  }

  /**
   * Adding a product already in the cart raises its quantity rather than
   * failing: "add to cart" twice is a normal thing for a client to do, and
   * cart_items_cart_product_unique makes a second row impossible anyway.
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

  async setItemQuantity(cartId: string, productId: string, quantity: number): Promise<CartView> {
    const cart = await this.loadCart(cartId);
    this.assertOpen(cart);
    const existing = this.findItem(cart, productId);

    await this.items.update(existing.id, { quantity });
    return this.view(cartId);
  }

  async removeItem(cartId: string, productId: string): Promise<CartView> {
    const cart = await this.loadCart(cartId);
    this.assertOpen(cart);
    const existing = this.findItem(cart, productId);

    await this.items.delete(existing.id);
    return this.view(cartId);
  }

  /** Loads a cart with its lines, or fails with the code a client can branch on. */
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

  /** A checked out cart is immutable: its order already quoted these lines. */
  assertOpen(cart: Cart): void {
    if (cart.status !== 'open') {
      throw new ConflictException({
        code: 'CART_ALREADY_CHECKED_OUT',
        message: `Cart ${cart.id} has already been checked out`,
      });
    }
  }

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

  // Checked before insert so an unknown product is a 404 with a code, rather
  // than a foreign key violation surfacing as a 500.
  private async assertProductExists(productId: string): Promise<void> {
    if (!(await this.products.existsBy({ id: productId }))) {
      throw new NotFoundException({
        code: 'PRODUCT_NOT_FOUND',
        message: `No product ${productId}`,
      });
    }
  }
}
