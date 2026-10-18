import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Cart } from './cart.entity';
import { CartView, toCartView } from './cart.view';

@Injectable()
export class CartsService {
  constructor(@InjectRepository(Cart) private readonly carts: Repository<Cart>) {}

  async create(): Promise<CartView> {
    const cart = await this.carts.save(this.carts.create({ status: 'open' }));
    return toCartView(cart);
  }

  async view(cartId: string): Promise<CartView> {
    return toCartView(await this.loadCart(cartId));
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
}
