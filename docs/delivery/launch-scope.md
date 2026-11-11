# Launch scope and vertical plan

Approved 11 November 2026: **Option 1, Vendra-owned products on 18 November 2026.**

## In scope for launch

- All three portals and the API deployed independently.
- Customers: register, browse, search, cart, checkout, verified payment through one provider, order history, delivery tracking.
- Admin: catalogue, stock, orders, refunds, manual dispatch, staff roles, audit log.
- Vendor portal: registration and business verification only.
- Double-entry ledger from the first payment.

## Deferred until after launch

Marketplace selling, vendor payouts and settlements, second payment provider, carrier API integrations, promotions, reviews, advanced analytics.

The data model already supports multiple sellers, seller orders and shipments, so these extend the design rather than replace it.

## Build order

Each step ends with tests passing before the next begins.

| # | Step | Depends on |
| --- | --- | --- |
| 1 | Persistence: apply migration, outbox, Prisma repositories (done 11 Nov) | Development database |
| 2 | Identity: accounts, sessions, audiences, permissions, audit (API done 11 Nov) | 1 |
| 3 | Portal sign-in (cookies), catalogue, listings, stock, admin screens (done 11 Nov) | 2 |
| 4 | Discovery: storefront pages and search on PostgreSQL (done 11 Nov) | 3 |
| 5 | Cart, checkout, stock reservation (done 11 Nov) | 3 |
| 6 | Payment: evaluate provider, build adapter, webhook, verification, ledger posting, staff MFA before refunds ship | 5, provider test keys |
| 7 | Orders: created from verified payment | 6 |
| 8 | Shipping: manual dispatch and customer tracking | 7 |
| 9 | Vendor registration and verification | 2 |
| 10 | Security review, end-to-end test, staging, go-live checklist | All |

## Critical path items outside the code

These can block launch regardless of engineering progress. Owner: project owner.

- Live payment provider account and business verification.
- Who physically delivers orders, and delivery zones and prices.
- Domain ownership and DNS.
- Production hosting. The current development machine is not suitable.
- Transactional email provider.
- Privacy policy, terms and returns policy, including Nigeria Data Protection Act obligations, reviewed by a qualified adviser.
- Real catalogue data, images and opening stock.

## After launch: marketplace extension

1. Open vendor product submission and `Listing` creation.
2. Allow carts to contain several sellers, producing several `SellerOrder`s.
3. Build vendor fulfilment on the existing `Shipment` model.
4. Add commission and vendor payables to the ledger, then `settlements`.
