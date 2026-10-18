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
import { Coupon } from '../coupons/coupon.entity';
import { applyPercentDiscount } from '../money';
import { Product } from '../products/product.entity';
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
   * @param couponCode Coupon to redeem, or undefined. On a replay this is
   *   ignored: the existing order already has whatever coupon it was placed
   *   with, and applying another one would change a completed order.
   * @returns The order, and whether it was created now or replayed.
   * @throws NotFoundException `CART_NOT_FOUND` or `COUPON_NOT_FOUND`.
   * @throws BadRequestException `CART_EMPTY`.
   * @throws ConflictException `INSUFFICIENT_INVENTORY`, naming the product,
   *   or `COUPON_NOT_AVAILABLE` if the coupon is already redeemed.
   * @throws HttpException 402 `PAYMENT_FAILED`, after the transaction has
   *   rolled the inventory claim and the coupon redemption back.
   */
  async checkout(cartId: string, couponCode?: string): Promise<CheckoutResult> {
    try {
      return await this.dataSource.transaction((manager) =>
        this.runCheckout(manager, cartId, couponCode),
      );
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

  private async runCheckout(
    manager: EntityManager,
    cartId: string,
    couponCode?: string,
  ): Promise<CheckoutResult> {
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

    // Claimed inside the transaction, so a failure below returns it to
    // available without any compensating write.
    const coupon = couponCode ? await this.redeemCoupon(manager, couponCode) : null;
    const { discountMinor, totalMinor } = coupon
      ? applyPercentDiscount(subtotalMinor, coupon.percentOff)
      : { discountMinor: 0, totalMinor: subtotalMinor };

    const order = await manager.save(
      manager.create(Order, {
        cartId,
        subtotalMinor,
        discountMinor,
        totalMinor,
        couponId: coupon?.id ?? null,
      }),
    );
    await manager.insert(
      OrderItem,
      lines.map((line) => ({ orderId: order.id, ...line })),
    );
    await manager.update(Cart, { id: cartId }, { status: 'checked_out' });

    // Charged after every row is written, so a failed write cannot take money
    // without producing an order. A decline still rolls all of it back. The
    // remaining window is a crash between this returning and the commit; the
    // cart id is the idempotency reference, so a retry of a real provider
    // settles that rather than charging twice.
    await this.payments.charge({ reference: cartId, amountMinor: totalMinor });

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
      // affected, not the returned rows: manager.query() hands back
      // [rows, count] for an UPDATE, so a row count of zero is the only
      // honest way to detect that the condition did not hold.
      const claimed = await manager
        .createQueryBuilder()
        .update(Product)
        .set({ inventory: () => '"inventory" - :quantity' })
        .where('"id" = :productId AND "inventory" >= :quantity')
        .setParameters({ productId: item.productId, quantity: item.quantity })
        .execute();

      if (claimed.affected === 0) {
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
   * Claims a coupon for this checkout.
   *
   * One conditional statement flips `available` to `redeemed`, so of two
   * checkouts racing for the same coupon exactly one can win: the loser's
   * update matches no row. Nothing is read, decided on, then written.
   *
   * @param supplied Code as the client sent it; trimmed and upper-cased
   *   before lookup, since issued codes are uppercase.
   * @returns The coupon, for its percentage.
   * @throws NotFoundException `COUPON_NOT_FOUND` if no such code exists.
   * @throws ConflictException `COUPON_NOT_AVAILABLE` if it is already redeemed.
   */
  private async redeemCoupon(manager: EntityManager, supplied: string): Promise<Coupon> {
    // Codes are issued uppercase and get retyped from emails and screenshots,
    // so matching is case-insensitive. Otherwise "reward-5-ab" reports
    // COUPON_NOT_FOUND, which reads as "that code never existed".
    const code = supplied.trim().toUpperCase();

    const claimed = await manager
      .createQueryBuilder()
      .update(Coupon)
      .set({ status: 'redeemed' })
      .where('"code" = :code AND "status" = :available', { code, available: 'available' })
      .execute();

    if (claimed.affected === 0) {
      const exists = await manager.existsBy(Coupon, { code });
      if (!exists) {
        throw new NotFoundException({ code: 'COUPON_NOT_FOUND', message: `No coupon ${code}` });
      }
      throw new ConflictException({
        code: 'COUPON_NOT_AVAILABLE',
        message: `Coupon ${code} has already been redeemed`,
      });
    }

    return manager.findOneByOrFail(Coupon, { code });
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
