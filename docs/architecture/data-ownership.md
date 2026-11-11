# Data ownership

- **One PostgreSQL database, one schema per module group** (`identity`, `customers`, `sellers`, `catalogue`, `inventory`, `cart`, `orders`, `payments`, `ledger`, `shipping`, `platform`). `cart` holds both carts and checkout sessions; `shipping` holds the delivery zones and rates owned by `logistics`.
- **No foreign keys between schemas.** A cross-context reference is a plain UUID column. Foreign keys exist only inside a schema. Consistency across contexts comes from application contracts and events, so a module's schema can be moved out later.
- **Only the owning module's repositories touch its tables.** Prisma is restricted to `infrastructure/`, and the architecture test enforces this.
- **Single Prisma schema and migration history** at `apps/api/prisma`, because the monolith deploys as one unit. Models are grouped by Postgres schema.
- **Migrations** run as a separate deployment step before the new API version starts, and must be backward compatible with the running version.

## Financial data rules

- Money is stored as `BIGINT` minor units plus a `currency` column. Floats and `DECIMAL` amounts are not used.
- Orders copy price and product details at purchase time, so later catalogue changes do not alter history.
- Ledger entries are append-only. A correction is a reversing entry.
- Aggregates that can race (payments, stock, shipments) carry a `version` column for optimistic locking.
- State change and its events commit in one transaction, using `platform.outbox_events`.
- `(provider, providerEventId)` is unique on webhook events, and `reference` is unique on payments.
- The database backs the most critical rules directly, in `migrations/0001_init`: ledger tables reject `UPDATE` and `DELETE`, stock cannot go negative or over-reserve, and refunds cannot exceed the payment amount.

## Connections

The API and worker use `DATABASE_URL`, through a pooler in production. Migrations use `DIRECT_DATABASE_URL`, because they need a direct session.
