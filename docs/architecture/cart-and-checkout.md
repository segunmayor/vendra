# Cart and checkout

## Cart

- **Guests and customers** share the same endpoints, `/v1/store/cart`, which are marked `@GuestAllowed`. A request without a token is a guest. A request that sends a token must send a valid customer token.
- **Guest carts** are identified by a random 256-bit token. The API returns it once, when the cart is created. The customer portal keeps it in an httpOnly cookie, `__Host-vendra_cart`, for 30 days. The database stores only its SHA-256 hash.
- **Signing in or registering** merges the guest cart into the customer's. Quantities add up and are capped at the per-order limit instead of failing. The guest cart is then deleted.
- **Limits:** 10 units of one item and 30 different items. The 10-unit cap matches inventory's per-checkout cap, so a full cart can always be reserved.
- **No stored prices.** Every view prices the cart live from the listing, product status and available stock. Each line is flagged `unavailable`, `out_of_stock` or `insufficient_stock` when it can no longer be bought as it is. `canCheckout` is true only when no line has a problem.
- Lowering a quantity or removing a line is always allowed. Raising a quantity is checked against stock.

## Delivery pricing

`logistics` owns delivery zones, stored in the `shipping` schema. A zone is a set of states with price bands by parcel weight. Staff edit zones in the admin portal under Delivery prices, which needs the `settings.manage` permission.

- A state belongs to at most one zone. This is checked under a table lock, so two edits cannot both claim a state.
- A quote uses the smallest band at or above the basket's packed weight.
- A state with no zone gets "We do not deliver to {state} yet". A basket heavier than the last band cannot be delivered.

## Checkout

A **checkout session** is a priced snapshot: lines, delivery address, delivery fee and total, with stock held for **15 minutes**. Prices are fixed in the session, so a later price change cannot alter what the customer agreed to pay. Checkout requires a signed-in customer.

`POST /v1/store/checkout` (requires an `Idempotency-Key` header):

1. A repeated key for the same customer returns the existing session. Nothing more is reserved.
2. The address is validated: a Nigerian mobile number (normalised to `+234…`) and one of the 37 states.
3. The cart is priced live, and any line with a problem stops checkout.
4. Delivery is quoted.
5. The customer's other open checkouts are cancelled and their stock released, so nobody can hold stock in several sessions at once.
6. Stock is reserved, all or nothing.
7. The session is saved. If saving fails, the reservation is released.

The session's status is read from the clock: after `expiresAt` it is `expired`, even before any background job runs. Other endpoints: `POST /quote` (fee only, nothing reserved), `GET /{id}`, `POST /{id}/cancel`, and `GET /last-address` (prefills the form). Other customers' sessions return 404.

## Stock reservations

`inventory` owns reservations. All methods lock stock rows first, in id order, so concurrent reservations, releases and the sweep cannot deadlock or oversell. The database also refuses `reserved > onHand`.

- **Allocation:** the fullest warehouse first, splitting across warehouses only when needed.
- **Lapsed holds** are treated as free at once. Availability reads subtract only unexpired holds, and reserving releases lapsed holds on the rows it locks. A background sweep is therefore never needed for correctness.
- **The sweep** (`RESERVATION_SWEEP_SECONDS`, default 60, 0 turns it off) releases lapsed holds in batches of 500, so stock rows stay tidy. It runs in the API process. A PostgreSQL advisory lock makes only one instance sweep at a time. It does not need Redis.
- Staff cannot remove stock that checkouts are holding.

Tested on 11 November 2026: of 6 customers racing for 3 units, exactly 3 succeeded and the other 3 were refused cleanly. Five simultaneous retries with one key produced one session and one reservation.

## Left for later steps

- **Step 6:** payment starts from an `awaiting_payment` session and must check that it has not expired. A payment verified after expiry must re-reserve stock or be refunded.
- **Step 7:** turning a paid session into an order commits the reservation, which reduces on-hand stock, and empties the cart.
- Abandoned guest carts are not yet cleaned up.
