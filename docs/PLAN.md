# Build plan

Nine phases, ~22 commits, ~6 hours. Commits are small so `git log` reads as a
timeline of how the solution developed.

Status: `[ ]` pending · `[~]` in progress · `[x]` done

## Phase 0 — Foundation · ~30 min ✅

- [x] `chore: scaffold nest application`
- [x] `chore: add docker compose with postgres`
- [x] `chore: add typeorm datasource and coupon configuration`

Config reads `COUPON_N` (milestone interval) and `COUPON_X` (percent off) from
env. One `docker compose up` must work on a machine that has never seen this
project.

## Phase 1 — Schema · ~45 min ✅

- [x] `feat: add product and cart entities with migration`
- [x] `feat: add order and coupon entities with migration`
- [x] `feat: seed products`

Constraints land here, before any service code:

| Constraint | Invariant it makes unrepresentable |
|---|---|
| `UNIQUE(orders.cart_id)` | A cart checked out twice |
| `UNIQUE(coupons.code)` | Ambiguous coupon lookup |
| `UNIQUE(coupons.milestone_order_count)` | Two coupons for one milestone |
| `CHECK(products.inventory >= 0)` | Oversold inventory |
| `CHECK(cart_items.quantity > 0)` | Zero or negative quantities |

Seed: five products, one with inventory 3 so contention is easy to exercise.

## Phase 2 — Money · ~20 min ✅

- [x] `feat: add money helpers in minor units`

Integer minor units with unit tests. Blocks everything downstream, so it comes
early. The percentage-discount rounding rule is decided and tested here.

## Phase 3 — Carts · ~45 min ✅

- [x] `feat: add cart creation and retrieval`
- [x] `feat: add cart item add, update and remove`
- [x] `test: cover cart validation rules`

Invalid products and non-positive quantities never enter a cart. Viewing a cart
returns line prices and totals computed from current product prices.

## Phase 4 — Checkout · ~90 min — the centrepiece ✅

- [x] `feat: add payment abstraction with fake provider`
- [x] `feat: add checkout transaction with inventory claim`
- [x] `feat: return existing order on checkout retry` (merged into the commit above)
- [x] `test: cover concurrent checkout and retry replay`

One transaction (see `docs/DOMAIN.md`). Tests must include genuinely competing
requests: N parallel checkouts against 3 units, asserting exactly 3 succeed and
inventory settles at 0.

## Phase 5 — Coupons · ~60 min

- [ ] `feat: add administrator coupon generation`
- [ ] `feat: redeem coupon within checkout transaction`
- [ ] `test: cover concurrent redemption and rollback on payment failure`

The rollback test is why the payment fake exists: it provides a realistic
failure point after the coupon has been claimed, proving a failed checkout does
not consume a coupon.

## Phase 6 — Reporting · ~30 min

- [ ] `feat: add administrator report`
- [ ] `test: report reconciles with orders and coupons`

Pure aggregate queries over orders and coupons. No counters. Repeated calls
must not mutate state, and the test asserts that.

## Phase 7 — Errors and docs · ~45 min

- [ ] `feat: add distinguishable error model`
- [ ] `docs: add api documentation and readme`

Every failure path returns a stable, distinguishable code. Scalar serves the
OpenAPI document Nest generates.

## Phase 8 — DECISIONS.md · ~60 min

- [ ] `docs: add decisions`

Written last, when the decisions are real rather than predicted. Covers
invariants, ambiguities and chosen semantics, at least five material decisions
with alternatives, the concurrency and idempotency strategy, money rules, the
error model, what was deferred, how the design scales to multiple instances,
honest AI use including a redirection, and what the next two hours would target.

## Time accounting

Git span is not time spent. Record actual working hours in the README; use
`git log --format='%ad %s' --date=iso` for the development timeline.
