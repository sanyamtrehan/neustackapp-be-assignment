# CLAUDE.md

Working agreement for this repository. Read this first in any new session.

## What this is

Backend for a reliable checkout and rewards service: carts, checkout, inventory,
and milestone discount coupons. Built as a take-home exercise under a stated
4–6 hour timebox.

The interesting part is not the CRUD. It is behaviour under retries, concurrent
checkouts, inventory contention, and two operations competing for one coupon.

## Stack

- NestJS + TypeScript
- PostgreSQL via TypeORM (migrations, not `synchronize`)
- Jest for unit and integration tests
- Docker Compose for Postgres — setup must work with no private credentials
- Scalar over Nest's generated OpenAPI document for API docs

## Documents

| File | Purpose |
|---|---|
| `docs/PLAN.md` | Phase plan, commit map, progress |
| `docs/DOMAIN.md` | Invariants, checkout transaction, chosen semantics |
| `DECISIONS.md` | Required deliverable. Written in the final phase |
| `temp/` | Gitignored scratch. Never commit |

## Conventions

- Conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`).
- Commit in small increments. History should read as the solution developing.
- Money is integer minor units everywhere. No floats, ever, for currency.
- Invariants are enforced by database constraints where possible, service code
  only where they cannot be.
- New non-trivial logic ships with a test. Trivial changes do not need one.

## How we work

The user navigates. Before each phase: explain what is being built and why,
get agreement, then implement and commit. Flag overruns rather than absorbing
them silently.

Decisions get explained in a form the author can defend without notes — the
follow-up discussion covers explaining invariants, predicting concurrent
behaviour, and changing a business rule live.

## Ponytail

The `ponytail` plugin (lazy senior dev mode: YAGNI, smallest complete change)
is enabled and suits this task — "focused and proportionate to the timebox" is
an explicit evaluation criterion. Run at `full`, not `ultra`.

Its limit here: laziness never cuts the concurrency guarantees, validation at
trust boundaries, or error handling. Those were asked for.
