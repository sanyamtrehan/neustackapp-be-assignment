import { Order } from './order.entity';

export class OrderLineView {
  productId: string;

  /** Product name snapshotted at checkout, not the catalog's current name. */
  name: string;

  /** Unit price snapshotted at checkout, in minor units. */
  unitPriceMinor: number;

  quantity: number;

  /** unitPriceMinor * quantity, as stored on the order. */
  lineTotalMinor: number;
}

export class OrderView {
  id: string;

  /** The cart this order was created from. One order per cart, ever. */
  cartId: string;

  items: OrderLineView[];

  /** Sum of the line totals before any discount, in minor units. */
  subtotalMinor: number;

  /** Discount applied, in minor units. Zero when no coupon was used. */
  discountMinor: number;

  /** subtotalMinor - discountMinor. Never negative. */
  totalMinor: number;

  /** Code of the coupon redeemed, or null. */
  couponCode: string | null;

  createdAt: Date;
}

/**
 * Maps an order to the shape returned by the API.
 *
 * Everything here comes from the order's own rows, never from a live join to
 * products: the snapshot is what lets an order explain itself after the
 * catalog changes.
 *
 * @param order Order with `items` loaded, and `coupon` loaded if one was used.
 * @returns Lines sorted by product name, with the stored money amounts.
 */
export function toOrderView(order: Order): OrderView {
  return {
    id: order.id,
    cartId: order.cartId,
    items: (order.items ?? [])
      .map((item) => ({
        productId: item.productId,
        name: item.productName,
        unitPriceMinor: item.unitPriceMinor,
        quantity: item.quantity,
        lineTotalMinor: item.lineTotalMinor,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
    subtotalMinor: order.subtotalMinor,
    discountMinor: order.discountMinor,
    totalMinor: order.totalMinor,
    couponCode: order.coupon?.code ?? null,
    createdAt: order.createdAt,
  };
}
