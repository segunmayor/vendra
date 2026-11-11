# System overview

## Deployment units

| Unit | Path | Proposed domain | Local port | Audience |
| --- | --- | --- | --- | --- |
| Customer portal (Next.js) | `apps/customer` | vendra.com | 3000 | Public, customers |
| Admin portal (Next.js) | `apps/admin` | admin.vendra.com | 3001 | Vendra staff |
| Vendor portal (Next.js) | `apps/vendor` | vendor.vendra.com | 3002 | Approved sellers |
| Central API (NestJS) | `apps/api` | api.vendra.com | 4000 | The three portals |
| Worker (BullMQ) | `apps/worker` | none | none | Background jobs |

```
customer ─┐
admin ────┼── HTTPS, versioned REST ──► api ──► PostgreSQL
vendor ───┘                              │  └─► Meilisearch, R2/S3
                                         └─► Redis ◄── worker
```

Rules:

- A portal talks only to the API. It has no database credentials and never imports another portal or `apps/api`. `apps/api/test/architecture.spec.ts` enforces the import rule.
- All business rules live in the API. Portals may validate input for usability, but the API always re-validates.
- Each portal builds to its own container. A portal is redeployed only when its own code, a shared package it uses, or an API contract it consumes changes.

## Shared packages

| Package | Contents | Must not contain |
| --- | --- | --- |
| `@vendra/ui` | Design tokens, shadcn-style components | Portal screens, API calls |
| `@vendra/api-client` | Types generated from OpenAPI, typed fetch client | Hand-written endpoint types |
| `@vendra/validation` | Zod schemas for form input | Business decisions such as pricing or eligibility |
| `@vendra/utils` | Pure formatting helpers | I/O |
| `@vendra/config` | TypeScript base configuration | Runtime code |

The proposed `packages/types` was dropped. API types are generated into `@vendra/api-client`, so a second hand-maintained copy could only drift from the contract.

## API conventions

- **Versioning:** URI prefix, `/v1/...`. Breaking changes need a new version.
- **Surfaces:** `/v1/store/*` (customer), `/v1/admin/*`, `/v1/vendor/*`, `/v1/webhooks/*`, `/v1/health*`. A token is accepted only on its own surface.
- **Contract:** the API generates OpenAPI, which is committed at `packages/api-client/openapi.json`. CI fails if the committed contract or generated types are stale.
- **Errors:** RFC 9457 `application/problem+json`, with a stable machine-readable `code`.
- **Money:** `{ "amountMinor": "150000", "currency": "NGN" }`. The amount is an integer string in minor units (kobo). Floats are never used.
- **Idempotency:** every state-changing financial or order operation requires an `Idempotency-Key` header.
- **Pagination:** cursor-based, using `?cursor=&limit=`.
- **Time:** ISO 8601 in UTC.

## Authentication and authorization

Decisions:

1. **Separate audiences.** Customer, staff and vendor accounts authenticate separately. Access tokens carry `aud` set to `store`, `admin` or `vendor`, and each API surface rejects any other audience. A customer token can never reach an admin route, even if a guard is misconfigured elsewhere.
2. **Tokens stay out of browser JavaScript.** Each portal holds them in `HttpOnly`, `Secure`, `SameSite=Lax` cookies scoped to its own host, and server-side route handlers forward them to the API.
3. **Short-lived access, rotating refresh.** Access tokens last 15 minutes. Refresh tokens are stored hashed, rotate on every use, and reuse revokes the whole session family.
4. **Passwords** are hashed with Argon2id.
5. **Staff authorization** is permission-based (`orders.refund`, `vendors.approve`). Roles are named sets of permissions. Handlers check permissions, never role names.
6. **Staff accounts require MFA** before production access to financial operations.
7. **Vendor authorization** adds tenancy: every vendor query is scoped by the `sellerId` from the token, never from a client-supplied value.
8. **Customer authorization** is by ownership: a customer reads only their own orders, addresses and payments.
9. **Sensitive staff actions** write to the audit log in the same transaction as the change.

Enforcement: a global guard refuses any route that is neither marked `Public` nor assigned a `Surface`. Each request re-checks the session, account status and permissions in the database, so logout, suspension and permission changes apply at once.

Login failures are limited to 5 per account and 100 per IP address in 15 minutes. Session lifetimes are absolute: 30 days for customers, 14 for vendors, 12 hours for staff.

Status: decisions 1, 2, 3, 4, 5, 8 and 9 are built. Decision 2 is described in [portal-sessions.md](portal-sessions.md). Still to build: staff MFA (6) and vendor tenancy (7).
