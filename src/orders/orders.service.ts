import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { CartItem } from '../carts/cart-item.entity';
import { Cart } from '../carts/cart.entity';
import {
  PAYMENT_PROVIDER,
  PaymentDeclinedError,
  PaymentProvider,
} from '../payments/payment.provider';
import { OrderItem } from './order-item.entity';
import { Order } from './order.entity';
import { OrderView, toOrderView } from './order.view';

export interface CheckoutResult {
  order: OrderView;
  /** True when this request returned an order a previous request had created. */
  replayed: boolean;
}

@Injectable()
export class OrdersService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
  ) {}

  /**
   * Turns a cart into an order, in one transaction.
   *
   * Everything that must hold together — the inventory claim, the payment and
   * the order rows — happens inside a single transaction, so any failure
   * leaves the database exactly as it was. See docs/DOMAIN.md for the full
   * sequence and why each step is shaped the way it is.
   *
   * @param cartId Cart to check out.
   * @returns The order, and whether it was created now or replayed.
   * @throws NotFoundException `CART_NOT_FOUND`.
   * @throws BadRequestException `CART_EMPTY`.
   * @throws ConflictException `INSUFFICIENT_INVENTORY`, naming the product.
   * @throws HttpException 402 `PAYMENT_FAILED`, after the transaction has
   *   rolled the inventory claim back.
   */
  async checkout(cartId: string): Promise<CheckoutResult> {
    try {
      return await this.dataSource.transaction((manager) => this.runCheckout(manager, cartId));
    } catch (error) {
      if (error instanceof PaymentDeclinedError) {
        throw new HttpException(
          { code: 'PAYMENT_FAILED', message: error.message },
          HttpStatus.PAYMENT_REQUIRED,
        );
      }
      throw error;
    }
  }

  private async runCheckout(manager: EntityManager, cartId: string): Promise<CheckoutResult> {
    // Lock the cart row first. Two requests for the same cart serialise here,
    // which is what makes a retry safe: the second one waits, then sees the
    // first one's result instead of racing it.
    const [locked] = (await manager.query(
      'SELECT "id", "status" FROM "carts" WHERE "id" = $1 FOR UPDATE',
      [cartId],
    )) as { id: string; status: string }[];

    if (!locked) {
      throw new NotFoundException({ code: 'CART_NOT_FOUND', message: `No cart ${cartId}` });
    }

    // Replay: this cart already produced an order, so return that one.
    if (locked.status === 'checked_out') {
      return { order: await this.loadOrderByCart(manager, cartId), replayed: true };
    }

    const items = await manager.find(CartItem, { where: { cartId }, relations: { product: true } });
    if (items.length === 0) {
      throw new BadRequestException({
        code: 'CART_EMPTY',
        message: `Cart ${cartId} has no items`,
      });
    }

    await this.claimInventory(manager, items);

    const lines = items.map((item) => ({
      productId: item.productId,
      productName: item.product.name,
      unitPriceMinor: item.product.unitPriceMinor,
      quantity: item.quantity,
      lineTotalMinor: item.product.unitPriceMinor * item.quantity,
    }));
    const subtotalMinor = lines.reduce((sum, line) => sum + line.lineTotalMinor, 0);
    const totalMinor = subtotalMinor;

    // Last, because everything it could invalidate is already claimed: a
    // decline here rolls back the inventory above.
    await this.payments.charge({ reference: cartId, amountMinor: totalMinor });

    const order = await manager.save(
      manager.create(Order, { cartId, subtotalMinor, discountMinor: 0, totalMinor }),
    );
    await manager.insert(
      OrderItem,
      lines.map((line) => ({ orderId: order.id, ...line })),
    );
    await manager.update(Cart, { id: cartId }, { status: 'checked_out' });

    return { order: await this.loadOrder(manager, order.id), replayed: false };
  }

  /**
   * Decrements inventory for every line, or fails.
   *
   * Each claim is one conditional statement: the row is only decremented if it
   * still holds enough, and Postgres re-evaluates that condition after waiting
   * on any concurrent writer, so two checkouts cannot both pass the same
   * check. No row is read, decided on, then written — which is where
   * overselling normally comes from.
   *
   * Lines are claimed in product id order so that two checkouts sharing
   * products always take their locks in the same sequence and cannot deadlock.
   *
   * @throws ConflictException `INSUFFICIENT_INVENTORY`, naming the product.
   */
  private async claimInventory(manager: EntityManager, items: CartItem[]): Promise<void> {
    const ordered = [...items].sort((a, b) => a.productId.localeCompare(b.productId));

    for (const item of ordered) {
      const claimed = (await manager.query(
        `UPDATE "products" SET "inventory" = "inventory" - $1
          WHERE "id" = $2 AND "inventory" >= $1
          RETURNING "id"`,
        [item.quantity, item.productId],
      )) as { id: string }[];

      if (claimed.length === 0) {
        throw new ConflictException({
          code: 'INSUFFICIENT_INVENTORY',
          message: `Not enough inventory for product ${item.productId}`,
          productId: item.productId,
          requested: item.quantity,
        });
      }
    }
  }

  /**
   * Reads an order by its own id.
   *
   * @throws NotFoundException `ORDER_NOT_FOUND`.
   */
  async findOrder(orderId: string): Promise<OrderView> {
    return this.loadOrder(this.dataSource.manager, orderId);
  }

  private async loadOrder(manager: EntityManager, orderId: string): Promise<OrderView> {
    const order = await manager.findOne(Order, {
      where: { id: orderId },
      relations: { items: true, coupon: true },
    });
    if (!order) {
      throw new NotFoundException({ code: 'ORDER_NOT_FOUND', message: `No order ${orderId}` });
    }
    return toOrderView(order);
  }

  private async loadOrderByCart(manager: EntityManager, cartId: string): Promise<OrderView> {
    const order = await manager.findOne(Order, {
      where: { cartId },
      relations: { items: true, coupon: true },
    });
    if (!order) {
      // A checked out cart without an order would mean the transaction that
      // set the status did not also write the order, which it cannot.
      throw new NotFoundException({
        code: 'ORDER_NOT_FOUND',
        message: `Cart ${cartId} is checked out but has no order`,
      });
    }
    return toOrderView(order);
  }
}
