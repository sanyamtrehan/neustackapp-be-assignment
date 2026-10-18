# Checkout and Rewards Service

Backend for an ecommerce store: carts, checkout, inventory, and a discount
coupon that becomes available after every *n*th placed order.

The interesting part is not the CRUD. It is what happens when a checkout is
retried, when several customers check out at once, when stock runs out
mid-request, and when two checkouts want the same coupon. Those are covered by
tests, not by hope — see [Tests](#tests).

Design reasoning lives in [DECISIONS.md](DECISIONS.md); working notes on
invariants and the checkout transaction are in [docs/DOMAIN.md](docs/DOMAIN.md).

## Stack

NestJS · TypeScript · PostgreSQL via TypeORM (migrations, never `synchronize`)
· Jest · Docker Compose · Scalar for API docs.

## Setup

Requirements: Node 22+ and Docker. No private services or credentials.

```bash
cp .env.example .env     # local defaults, already correct
npm install
docker compose up -d     # Postgres on the port in .env
npm run migration:run    # schema + seeds five products
npm run start:dev
```

Then open **http://localhost:3000/docs** for the API reference, which has a
request runner built in. The raw document is at `/openapi.json`.

The seed includes *Limited Edition Mug* with **3 units**, deliberately scarce
so inventory contention is easy to exercise by hand.

### Configuration

All of it lives in `.env`:

| Variable | Default | Meaning |
|---|---|---|
| `DB_HOST` `DB_PORT` `DB_USER` `DB_PASSWORD` `DB_NAME` | `localhost` `5432` `checkout` `checkout` `checkout` | Database. `docker-compose.yml` reads the same variables, so there is one place to change them. |
| `PORT` | `3000` | HTTP port. |
| `COUPON_N` | `5` | Every *n*th placed order earns one coupon. |
| `COUPON_X` | `10` | Percent off, 1..100. Snapshotted onto each coupon, so changing it never reprices one already issued. |
| `FAKE_PAYMENT_DECLINE` | unset | Set to `true` to make every payment fail. For demonstrating that a failed checkout returns the stock and the coupon. |

A bad `COUPON_N` or `COUPON_X` fails startup rather than producing a nonsense
discount later.

## API

Full detail, including every request and response shape, is at `/docs`.

### Customer

| Method | Path | Notes |
|---|---|---|
| `POST` | `/carts` | Opens a cart. |
| `GET` | `/carts/:cartId` | Lines and totals, priced against the catalog **now**. |
| `POST` | `/carts/:cartId/items` | Adds a product; adding again sums the quantity. |
| `PUT` | `/carts/:cartId/items/:productId` | Sets a quantity. |
| `DELETE` | `/carts/:cartId/items/:productId` | Removes a line. |
| `POST` | `/carts/:cartId/checkout` | Places the order. Optional `{ "couponCode": "..." }`. |
| `GET` | `/orders/:orderId` | Reads an order. |

Checkout is **idempotent per cart**: the first call returns `201` with the new
order, every retry returns `200` with that same order. A client that lost the
response can simply call again.

### Administrative

These two are the administrative operations. Authentication is out of scope
for the exercise, so they are not protected; they sit under `/admin` to make
the boundary obvious, and in a real deployment would require an operator role.

| Method | Path | Notes |
|---|---|---|
| `POST` | `/admin/coupons` | Generates the coupon for the lowest reached, unrewarded milestone. |
| `GET` | `/admin/report` | Sales, revenue, discounts and coupon totals. Read only. |

### Errors

Every failure returns the same shape, plus any context the code carries:

```json
{ "code": "INSUFFICIENT_INVENTORY", "message": "Not enough inventory for product ...", "productId": "..." }
```

Branch on `code`; it is stable. Messages may be reworded.

| Code | Status | When |
|---|---|---|
| `VALIDATION_FAILED` | 400 | Bad body or path parameter. |
| `PAYLOAD_TOO_LARGE` | 413 | Request body above the server limit. |
| `UNSUPPORTED_MEDIA_TYPE` | 415 | Content type, charset or encoding the server cannot read. |
| `CLIENT_ERROR` | other 4xx | Any other client mistake. |
| `CART_EMPTY` | 400 | Checkout of a cart with no lines. |
| `PAYMENT_FAILED` | 402 | Payment declined. Nothing was claimed. |
| `CART_NOT_FOUND` `CART_ITEM_NOT_FOUND` `PRODUCT_NOT_FOUND` `ORDER_NOT_FOUND` `COUPON_NOT_FOUND` `NOT_FOUND` | 404 | No such thing. |
| `CART_ALREADY_CHECKED_OUT` | 409 | Editing a cart that already produced an order. |
| `INSUFFICIENT_INVENTORY` | 409 | Stock ran out. Carries `productId` and `requested`. |
| `COUPON_NOT_AVAILABLE` | 409 | Already redeemed. |
| `MILESTONE_NOT_REACHED` / `MILESTONE_ALREADY_REWARDED` | 409 | Carry `ordersPlaced` and `nextMilestone`. |
| `CONSTRAINT_VIOLATED` | 409 | A database constraint refused the write. A backstop. |
| `INTERNAL_ERROR` | 500 | Unanticipated. Logged server side, details never returned. |

## Tests

```bash
npm test
```

They need Postgres running and migrated, because the rules under test are
partly enforced by database constraints — a mocked repository would prove
nothing about them. The suite truncates and reseeds between tests.

No count is quoted here on purpose: it went stale twice while the suite grew.
`npm test` prints it.

To watch a failed checkout roll back by hand, restart with
`FAKE_PAYMENT_DECLINE=true npm run start:dev`, check out a cart holding a
coupon, and confirm the `402`, then that stock and the coupon are untouched.

The ones that matter are the competing and repeated ones:

| Test | Asserts |
|---|---|
| 10 checkouts, 3 units in stock | exactly 3 orders, 7 × `INSUFFICIENT_INVENTORY`, inventory settles at 0 |
| 8 simultaneous retries of one cart | 1 order created, 7 replays, all the same order id, inventory moved once |
| 2 checkouts racing for 1 coupon | one wins, one `COUPON_NOT_AVAILABLE`, loser pays nothing |
| payment declines after the coupon is claimed | coupon back to `available`, inventory restored, no order, retry works |
| 4 simultaneous adds of one product | quantity 4, not a lost update |
| 20 simultaneous adds, above the connection pool size | all answered, service still responsive |
| 5 administrators generating at once | exactly 2 coupons for 10 orders, milestones 5 and 10 |
| carts sharing products in opposite orders | no deadlock |

One of these found a real oversell bug on first run: the inventory guard was
reading the wrong value from TypeORM and was silently dead code. Ten
concurrent checkouts against three units produced ten orders. That is written
up in `DECISIONS.md`.

## How the guarantees work

Briefly; the full reasoning is in [DECISIONS.md](DECISIONS.md).

- **Retry safety.** Checkout locks the cart row with `SELECT ... FOR UPDATE`.
  A second request waits, then sees the first one's order instead of racing
  it. `UNIQUE(orders.cart_id)` makes a second order for a cart impossible
  even if that logic were wrong.
- **No overselling.** Stock is claimed with one conditional statement,
  `UPDATE products SET inventory = inventory - :q WHERE id = :id AND inventory >= :q`.
  Nothing is read, decided on, then written. Lines are claimed in product id
  order, so overlapping carts cannot deadlock.
- **Coupons.** Redemption is the same shape: a conditional `UPDATE` that only
  one of two racing checkouts can win. It happens inside the checkout
  transaction, so a later failure returns the coupon with no compensating
  write.
- **Money.** Integer minor units everywhere, never a float. One rounding
  rule, half up, applied once to the subtotal.
- **Reporting.** Pure aggregates over `orders` and `coupons` on every call.
  No stored counter exists to drift, and nothing is written.

## Time spent

About 5 hours, inside the stated 4–6 hour box: first commit 17:24, last 22:28,
with the pauses in between spent on external QA runs and review rather than
away from the work. For the development timeline:

```bash
git log --format='%ad %s' --date=iso
```

## Useful commands

| Command | Does |
|---|---|
| `npm run start:dev` | Run with reload. |
| `npm test` | Full suite. |
| `npm run migration:run` / `:revert` | Apply or roll back schema. |
| `npm run migration:generate -- src/migrations/Name` | Diff entities against the database. |
| `npm run db:reset` | Destroy the database and rebuild it seeded. Useful between manual test runs. |
| `docker compose down -v` | Destroy the database, including all data. |
