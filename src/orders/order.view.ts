import { Order } from './order.entity';

export interface OrderLineView {
  productId: string;
  name: string;
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
}

export interface OrderView {
  id: string;
  cartId: string;
  items: OrderLineView[];
  subtotalMinor: number;
  discountMinor: number;
  totalMinor: number;
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
