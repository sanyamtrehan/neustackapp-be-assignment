import { Cart } from './cart.entity';
import { CartStatus } from './cart.entity';

export interface CartLineView {
  productId: string;
  name: string;
  unitPriceMinor: number;
  quantity: number;
  lineTotalMinor: number;
}

export interface CartView {
  id: string;
  status: CartStatus;
  items: CartLineView[];
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
