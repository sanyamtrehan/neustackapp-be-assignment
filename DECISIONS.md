# Decisions

Checkout and rewards service. ~5 hours. Setup and API docs: [README.md](README.md).

## Invariants

Enforced by the database unless noted, so a bug in service code can't break them.

| Invariant | Enforced by |
|---|---|
| Inventory never negative | `CHECK inventory >= 0` + conditional `UPDATE` |
| One order per cart, ever | `UNIQUE(orders.cart_id)` + `SELECT … FOR UPDATE` |
| A coupon is redeemed once | `UNIQUE(orders.coupon_id)` + conditional `UPDATE` |
| A failed checkout consumes nothing | transaction rollback |
| One coupon per milestone | `UNIQUE(coupons.milestone_order_count)` |
| `total = subtotal − discount`, never negative | `CHECK` on `orders` |
| `line_total = price × qty` | `CHECK` on `order_items` |
| Order lines never change when products change | snapshot columns, no FK to products |
| Report matches the rows | derived on read, no counters |

I checked each constraint by inserting violating rows in psql before writing any service code.

## Ambiguities I had to resolve

| Question | Chose | Because |
|---|---|---|
| Invalid/spent coupon at checkout | Fail the checkout | Charging full price when a discount was expected is the worse surprise. Retry without the code. |
| Price changes before checkout | Charge current price, snapshot it | A cart is a selection, not a quote. |
| When stock is reserved | At checkout only | No phantom holds, no expiry reaper. Cost: a cart can fail at checkout. |
| 12 orders, no coupons yet | Each call rewards the lowest unrewarded milestone | Nothing is skipped: 5, then 10, then refuse. |
| Coupons per order | One | Stacking needs an ordering rule and a combined cap. |
| Discounted order counts toward next milestone | Yes | It's a placed order. |
| Retry supplying a different coupon | Ignored, original order returned | Changing a placed order is worse. |
| Coupon code matching | Case-insensitive, trimmed | Codes get retyped out of emails. |
| Admin operations | `POST /admin/coupons`, `GET /admin/report` | Auth out of scope per the brief. |

## Key decisions

**1. Conditional UPDATE, not SELECT … FOR UPDATE, for inventory**
Alternatives: lock each product row then update; serializable + retry; per-product queue.
Chose `UPDATE … WHERE id = :id AND inventory >= :q`. One atomic statement, so there's no gap between deciding and writing — which is where overselling comes from. Postgres re-evaluates the `WHERE` after waiting on a concurrent writer, so two checkouts can't both pass. No lock held across a round trip.
Cost: the signal is a row count, not an exception. Getting that wrong caused a real bug (see AI section). Lines are claimed in `product_id` order so overlapping carts can't deadlock.

**2. Idempotency via the cart row lock, not an idempotency-key table**
Alternatives: `Idempotency-Key` header + stored responses; rely on the unique constraint alone.
The cart id is already a natural key — one order per cart is a domain rule, not a transport concern. A key table adds expiry and response-replay for something the data model already says.
Result: first call `201`, retry `200` with the same order. Retries of one cart serialise; different carts don't block.

**3. Invariants in the database, not in service code**
Alternative: validate in services, treat the DB as storage.
Constraints hold for every writer and every instance; service checks hold once per process. The migrations double as a readable list of guarantees.
Cost: worse error messages, so every constraint is named explicitly and the error model maps names to codes. Some rules appear twice (DTO + `CHECK`) deliberately — the DTO gives a good 400, the constraint guarantees it.

**4. Snapshot order lines instead of joining to products**
Alternatives: FK to products and join; full price-history tables.
`order_items` stores name, unit price and line total as at checkout; `product_id` is a plain column with no FK. An order explains itself after a product is renamed, repriced or deleted.
Cost: per-product reporting groups by id, not name, so a renamed product is still one product.

**5. Advisory lock for coupon generation**
Alternatives: let the unique constraint reject the loser; serializable + retry.
There's no row to lock — the coupon doesn't exist yet and the order count is an aggregate. Without serialising, two admins compute the same milestone and one errors, even when a second milestone was available for them. The lock makes them queue; the unique constraint is still what guarantees correctness.
Cost: generation is globally serialised. Fine for an admin action, wrong for a hot path. 20 simultaneous calls produced milestones 5/10/15/20 exactly once each.

**6. Payment abstraction with a fake, charged last**
Alternative: treat checkout success as payment success.
Without a step that can fail *after* stock and coupon are claimed, the rollback guarantee is untestable. The interface is one method; tests substitute a declining provider; `FAKE_PAYMENT_DECLINE=true` demonstrates it against a running server.
The charge runs after every row is written, so a failed insert can't take money.

**7. Report derived on every call, no counters**
Alternative: maintain running totals.
A counter is a second source of truth that drifts silently the first time a write path forgets it. An aggregate can't disagree with its own rows.
The three queries run in one `REPEATABLE READ` transaction so they share a snapshot. Cost: it scans all history — first thing to revisit at scale.

## Concurrency and idempotency

One transaction for checkout. The order is the design:

```
BEGIN
 1. SELECT cart FOR UPDATE                  -- retries of this cart serialise here
 2. already checked out? -> return that order, 200
 3. empty? -> 400
 4. per line, by product_id:
      UPDATE products SET inventory = inventory - :q
       WHERE id = :id AND inventory >= :q   -- 0 rows -> 409
 5. snapshot name + price, sum subtotal
 6. UPDATE coupons SET status='redeemed'
       WHERE code = :c AND status='available' -- 0 rows -> 404/409
 7. INSERT order + lines, cart -> checked_out
 8. charge payment                          -- last
COMMIT
```

- Cart edits take the same cart lock. Without it two simultaneous adds lose each other's quantity, and an edit can land in a cart checkout just closed. Both were real bugs.
- READ COMMITTED everywhere except the report. Sufficient because no contended write decides from a value read earlier — each is a single conditional statement.
- Deadlock avoidance is lock ordering: always `product_id` order.

Verified at up to 100-way parallelism, by the test suite and three external QA passes: 50 checkouts against 3 units → exactly 3 orders, stock 0. 50 simultaneous retries of one cart → 1 order, 49 replays, one id. 20 checkouts racing one coupon → 1 winner, losers charged nothing. Redeemed coupons with no order: 0.

## Money

- Integer minor units everywhere. No float ever holds currency.
- One rounding rule, half up: 10% off 1255 is 126. The half cent goes to the customer and the total reproduces on audit.
- Division is integer arithmetic (`scaled − (scaled % 100)` is an exact multiple of 100), so "no floats" is literally true.
- Rounded once on the subtotal, not per line, or the discount drifts from `percent × subtotal`.
- Discount clamped to subtotal; a 100% coupon settles at zero.
- `integer` columns cap an order near 21M minor units. Deferred, one migration.

## Errors

- Every failure is `{ code, message }` plus context (`productId`, `nextMilestone`).
- `code` is the contract, `message` isn't. All codes are in one typed list, so one can't be invented at a throw site.
- One global filter catches everything: our throws pass through, Nest built-ins get a code, DB constraints become a 409 naming the constraint, anything unanticipated is `INTERNAL_ERROR` with the cause logged and nothing leaked.
- Codes split where the client's next step differs: `COUPON_NOT_FOUND` vs `COUPON_NOT_AVAILABLE`.

## Deferred

| Deferred | Why |
|---|---|
| Auth / roles | Out of scope. Admin boundary exists as a route prefix. |
| Coupon expiry, min order value, per-customer limits | Product rules I'd be inventing. Columns on `coupons` + checks at redemption. |
| Multiple coupons per order | Needs stacking order and a combined cap. |
| Product CRUD | Catalog is seeded; it's the CRUD that isn't being assessed. |
| Refunds / cancellations | A second lifecycle with its own invariants. |
| Report date ranges and pagination | Whole-history aggregate is what reconciles. |
| `bigint` money columns | One migration when order values need it. |
| Rate limiting, metrics, graceful shutdown | Production concerns the brief excludes. |

## Multiple instances and scale

Correctness doesn't change with instance count: every contended decision is a
single conditional statement the database arbitrates, with no in-process
locks, caches or counters, so five instances behave like one. What's bounded
is throughput — connections grow with instance count (PgBouncer or a tuned
pool), checkouts for one product serialise on its row however many instances
you add (sharded counters or a reservation queue), and the report scans all
history (incremental aggregates or a materialised view). None of those is a
correctness risk: slower or rejected, never wrong. The one residual
correctness risk is unrelated to scale — the charge sits inside the
transaction, so a crash between the provider returning and the commit landing
leaves money taken with no order, and a single instance has the same
exposure. The cart id is sent as the idempotency reference so a retry settles
rather than double-charges; a transactional outbox is the complete fix, which
a fake provider can't prove works.

## AI use

I built this with Claude Code, phase by phase: I decided what each phase
contained, Claude wrote it, and I reviewed the diff and ran the service and
the tests before committing. I own every line.

**What it was good at.** Most of this exists because AI made it cheap. The
schema, migrations, test suite, OpenAPI docs and README were drafted far
faster than I would have written them, and more consistently. It was
especially useful for the things I would otherwise have cut under a timebox:
naming every constraint, documenting every error code, and writing the
concurrency tests that later earned their place.

**Where I redirected it.** Claude committed the first migrations as
`migration:generate` emitted them — raw DDL strings. I had them rewritten
with the TypeORM schema builder. It pushed back fairly: the generator diffs
entities against the live schema, and hand-written migrations lose that. So I
kept that as a rule — `migration:generate` must report no changes — and had
it rewrite them anyway. `down()` now derives from the same table definitions
as `up()`, and every constraint has a name I chose rather than a generated
hash. Those names are what the error model maps to codes.

**Where it was wrong.** Two bugs, both mine to own:

- The inventory guard read the wrong value back from TypeORM, so the check
  was dead code. Ten concurrent checkouts against three units produced ten
  orders. The concurrency test caught it on its first run.
- Its own fix for a cart race put every mutation behind a row lock, then
  asked for a second database connection while already holding one. Ten
  simultaneous adds deadlocked the service permanently. The test it wrote
  fired four requests against a pool of ten, so it could never have failed. A
  separate AI agent running QA against the live service found it in minutes.

**What I take from it.** AI made this several times faster and wrote tests I
would have cut for time. It also produced a confident fix paired with a test
that could not fail, which is the real risk of working this way. Both of its
bugs looked correct on the page — a guard reading the wrong return value, a
lock needing one more connection than it had. Reading the diff did not catch
either; running the code under concurrency did. That is why the concurrency
tests and an independent QA pass were worth the time they cost.

## Next two hours

1. **Load-test and size the connection pool.** Ten per instance with a 5s
   acquire timeout is the one thing I know would bite a real deployment on
   day one. Saturation should answer `503`, not `500`.
2. **Close the payment gap with a transactional outbox**, and prove it with a
   provider fake that fails *after* charging — the one failure the current
   fake cannot express.
3. **Property-based tests for the money rules**, generating subtotals and
   percentages rather than checking chosen examples.
