import { Cart } from './cart.entity';
import { CartStatus } from './cart.entity';

export class CartLineView {
  productId: string;

  /** Product name as it reads in the catalog right now. */
  name: string;

  /** Current catalog price, in minor units. */
  unitPriceMinor: number;

  quantity: number;

  /** unitPriceMinor * quantity. */
  lineTotalMinor: number;
}

export class CartView {
  id: string;

  /** `open` until checkout succeeds, then `checked_out` and immutable. */
  status: CartStatus;

  items: CartLineView[];

  /** Sum of the line totals, in minor units. */
  subtotalMinor: number;
}

/**
 * Maps a loaded cart to the shape returned by the API.
 *
 * Prices come from the product rows as they are right now, not from when the
 * item was added: a cart is a selection, not a price quote. Checkout snapshots
 * these same current prices onto the order.
 *
 * @param cart Cart with `items` and each item's `product` loaded. A cart
 *   loaded without those relations is treated as empty.
 * @returns Lines sorted by product name, so repeated reads are byte-identical,
 *   with the subtotal summed from the line totals.
 */
export function toCartView(cart: Cart): CartView {
  const items = (cart.items ?? [])
    .map((item) => ({
      productId: item.productId,
      name: item.product.name,
      unitPriceMinor: item.product.unitPriceMinor,
      quantity: item.quantity,
      lineTotalMinor: item.product.unitPriceMinor * item.quantity,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return {
    id: cart.id,
    status: cart.status,
    items,
    subtotalMinor: items.reduce((sum, line) => sum + line.lineTotalMinor, 0),
  };
}
