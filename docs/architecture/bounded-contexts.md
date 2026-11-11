# Bounded contexts

Each aggregate has exactly one owner. Other modules hold its ID and call the owner's contract.

"Launch" is the depth planned for 18 November 2026 (see [launch scope](../delivery/launch-scope.md)).

| Module | Owns | Key operations | Launch |
| --- | --- | --- | --- |
| `identity` | Account, Session, Role, Permission | Register, authenticate, authorize | Full |
| `customers` | CustomerProfile, Address | Manage profile and address book | Full |
| `vendors` | Seller, VerificationCase | Apply, verify, approve | Registration and verification |
| `catalogue` | Category, Brand, Product, ProductVariant, attributes | Define what can be sold | Full |
| `listings` | Listing | A seller's offer: price and status for a variant | Vendra seller only |
| `inventory` | StockItem, StockReservation, StockMovement | Reserve, release, commit, adjust | Full |
| `warehousing` | Warehouse | Manage stocking locations | Basic |
| `cart` | Cart | Add, change, merge guest cart | Full |
| `checkout` | CheckoutSession | Price, reserve, hand off to payment | Full |
| `orders` | Order, SellerOrder | Place, cancel, track lifecycle | Full |
| `payments` | Payment, PaymentAttempt, WebhookEvent, Refund | Initiate, verify, refund, reconcile | One provider |
| `ledger` | LedgerAccount, JournalEntry | Post balanced entries | Full |
| `settlements` | VendorPayable, Settlement | Commission, payouts | After launch |
| `shipping` | Shipment, DeliveryAttempt, return shipment | Create, allocate, track, return | Full lifecycle |
| `logistics` | LogisticsProvider, DeliveryZone, DeliveryRate | Quote, carrier integration | Manual dispatch, zone pricing |
| `promotions` | Promotion, Coupon | Evaluate discounts | After launch |
| `reviews` | Review | Submit, moderate | After launch |
| `notifications` | Template, Delivery | Send email and SMS | Transactional email |
| `support` | Ticket | Raise and resolve | Contact channel only |
| `cms` | Page, Banner | Publish content | Basic |
| `analytics` | Read models | Reports | Basic dashboard |
| `administration` | Staff workflows | Orchestrates other modules' contracts, owns no aggregate | Full for launch flows |
| `audit` | AuditLog | Record sensitive actions | Full |
| `settings` | Setting | Platform configuration | Basic |

## Ownership decisions

**Vendra is a seller.** Vendra-owned stock is listed under a seeded `Seller` of type `first_party`. The launch flow therefore runs through the same `Listing`, `SellerOrder` and `Shipment` path that marketplace vendors will use. Opening the marketplace adds sellers, not a second order model.

**Order structure.** `Order` (what the customer bought and paid for) contains one or more `SellerOrder`s (what one seller must fulfil). A `SellerOrder` can have many `Shipment`s, and a `Shipment` covers specific order lines.

**Payments and ledger are separate.** `payments` records what happened at the provider. `ledger` records what it means financially. `ledger` reacts to `payments` events, and journal entries are never edited, only reversed.

**Shipping and logistics are separate.** `shipping` owns the shipment lifecycle and is provider-independent. `logistics` owns carriers, zones and rates.

**`administration` owns no aggregates.** A staff action on an order goes through the `orders` contract, so admin screens cannot bypass business rules.

## Implementation status

Only `payments`, `ledger` and `shipping` have code so far: domain rules, ports and Prisma persistence. They have no HTTP endpoints yet. Modules are created when they are built, so the tree has no empty placeholders.
