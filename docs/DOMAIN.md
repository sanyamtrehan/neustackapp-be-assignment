# Domain notes

Working notes on invariants, the checkout transaction, and the semantics chosen
where the specification left room. Source material for `DECISIONS.md`.

## Entities

| Entity | Key fields | Guards |
|---|---|---|
| `Product` | name, `unit_price_minor`, `inventory` | `inventory >= 0` |
| `Cart` | `status: open \| checked_out` | — |
| `CartItem` | cart, product, quantity | `UNIQUE(cart, product)`, `quantity > 0` |
| `Order` | cart, subtotal / discount / total in minor units, coupon | `UNIQUE(cart_id)` |
| `OrderItem` | product id, **name and unit price snapshot**, quantity, line total | immutable |
| `Coupon` | code, `percent_off`, `milestone_order_count`, status | `UNIQUE(code)`, `UNIQUE(milestone_order_count)` |

`OrderItem` carries a snapshot rather than a live join, so an order still
explains itself after a product is renamed, repriced or deleted.

## Invariants

1. Inventory never goes negative; nothing is sold that was not available.
2. Exactly one order per cart, ever.
3. A coupon is redeemed at most once.
4. A coupon claimed by a checkout that later fails returns to available.
5. At most one coupon exists per milestone.
6. `total = subtotal - discount`, never negative, integer minor units only.
7. An order's line snapshot never changes when product data changes.
8. The report is a pure derivation of orders and coupons.

Invariants 1, 2, 3 and 5 are enforced by database constraints. Invariant 4 is
enforced by transaction scope. The rest are enforced in service code.

## Checkout: one transaction

```
BEGIN
 1. SELECT cart FOR UPDATE              -- serializes retries of the same cart
 2. if already checked_out -> load existing order, return 200   -- replay
 3. reject empty cart
 4. per item, ordered by product_id:    -- stable order avoids deadlock
      UPDATE products SET inventory = inventory - :q
       WHERE id = :id AND inventory >= :q
      rows affected 0 -> INSUFFICIENT_INVENTORY
 5. snapshot name and unit price, compute subtotal
 6. if coupon supplied:
      UPDATE coupons SET status = 'redeemed'
       WHERE code = :c AND status = 'available'
      rows affected 0 -> COUPON_NOT_AVAILABLE
 7. discount = round(subtotal * percent / 100); clamp total at 0
 8. payment (fake); INSERT order and items; cart -> checked_out
COMMIT
```

Step 1 makes retries safe. Step 4 makes overselling impossible without holding
long locks. Step 6 makes double redemption impossible. Because step 6 is inside
the transaction, a failure at step 8 returns the coupon automatically.

The conditional `UPDATE ... WHERE inventory >= :q` was chosen over
`SELECT ... FOR UPDATE` on products: it is a single atomic statement, holds no
lock across round trips, and cannot deadlock given a stable item order.

## Chosen semantics

The specification deliberately leaves these open. Status below is **proposed**
until confirmed.

| Question | Chosen | Reasoning |
|---|---|---|
| Invalid or already-redeemed coupon at checkout | Fail the checkout | Silently charging full price when a discount was expected is the worse failure. The client can retry without the coupon. |
| Product price changed between add-to-cart and checkout | Charge the current price, snapshot it on the order | A cart is a selection, not a price quote. Alternative — reject and force re-confirmation — is safer for the customer but adds a state machine the timebox does not justify. |
| Inventory reservation | At checkout only, never at add-to-cart | Avoids phantom holds and an expiry reaper. Cost: a cart can fail at checkout, which is documented behaviour rather than a bug. |
| 12 orders exist, no coupons generated | Each administrator call generates the lowest ungenerated eligible milestone | No milestone is silently skipped, and the administrator stays in control. Idempotent either way thanks to the unique constraint. |
| Coupons per order | One | Keeps the discount deterministic and the arithmetic auditable. |
| Does a discounted order count toward the next milestone | Yes | It is a successfully placed order. |
| Coupon expiry, minimum order value, per-customer limits | Deferred | Out of timebox. Recorded as deferred, not overlooked. |
| Payment | Small abstraction with a fake implementation | Costs little and gives the transaction a realistic failure point, which is what proves invariant 4. |

## Money and rounding

Every amount is an integer in minor units (cents). No float ever holds a
currency value, and `percentOfMinor` does its division in integer arithmetic:
`scaled - (scaled % 100)` is an exact multiple of 100, so the divide cannot
introduce a representation error.

| Rule | Chosen | Reasoning |
|---|---|---|
| Rounding direction | Half **up** | 10% off 1255 is 126, not 125. The half cent goes to the customer, and a fixed rule reproduces the same total when an order is audited later. |
| Discount larger than subtotal | Clamp to subtotal | A 100% coupon settles at zero. Guarantees invariant 6; `orders_amounts_non_negative` enforces the same thing in the database. |
| Where rounding happens | Once, on the order subtotal | Rounding per line then summing would let the discount drift from `percent × subtotal`. |
| Fractional input | Throws | A float reaching the money path is a bug upstream, not something to round away quietly. |

## Error model

Failures return stable, distinguishable codes rather than prose, so a client can
branch on them: `CART_NOT_FOUND`, `CART_ALREADY_CHECKED_OUT`, `CART_EMPTY`,
`PRODUCT_NOT_FOUND`, `INVALID_QUANTITY`, `INSUFFICIENT_INVENTORY`,
`COUPON_NOT_FOUND`, `COUPON_NOT_AVAILABLE`, `MILESTONE_NOT_REACHED`,
`MILESTONE_ALREADY_REWARDED`, `CART_ITEM_NOT_FOUND`, `ORDER_NOT_FOUND`,
`PAYMENT_FAILED`, `VALIDATION_FAILED`, `NOT_FOUND`, `PAYLOAD_TOO_LARGE`,
`CONSTRAINT_VIOLATED`, `INTERNAL_ERROR`.

## Scaling beyond one instance

The database is already the arbiter: every invariant is held by a constraint or
a conditional update, not by in-process state. Running N instances changes
nothing about correctness. What would need attention at production scale is
hot-row contention on popular products, which points at per-product queues or
sharded inventory counters, and the growth of the report query, which points at
incrementally maintained aggregates.
