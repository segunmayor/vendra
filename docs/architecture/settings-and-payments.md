# Settings and payment gateways

**Rule (owner, 11 November 2026):** nothing about how the business runs is hardcoded. Staff with the `settings.manage` permission change it in the admin portal, and the change applies without a release.

## Settings

The admin portal's **Settings** page shows every setting, grouped. Each one has a type, a safe range and a default. A value outside its range is refused with a plain message, and a save is all or nothing. Every change is audited with its before and after values.

| Group | Settings |
| --- | --- |
| Store | Name, home page headline and subheading, payment safety message, support email and phone, low-stock warning level |
| Basket and checkout | Most of one item per order, most different items in a basket, stock hold while paying |
| Search | Spelling strictness (typo tolerance) |
| Sign-in and security | Minimum password length, failed sign-ins per account and per IP address, sign-in pause, access token lifetime, how long customers, sellers and staff stay signed in |
| Payments and accounting | Customer site address, API address, ledger accounts for payments |

Other staff screens configure delivery zones and prices, payment gateways and the catalogue.

- **Defaults** are defined once, in `apps/api/src/modules/settings/domain/definitions.ts`, and used until someone changes them. A stored value that no longer passes validation, for example after a range is tightened, falls back to its default rather than breaking the shop.
- **Speed:** each API process caches settings for 10 seconds. A change shows at once on the instance that saved it, and within 10 seconds everywhere else.
- **The storefront** reads only settings marked public (store name, headline, support contacts), from `GET /v1/store/settings`.

### What stays outside Settings, and why

- **Infrastructure needed before the database is reachable:** `DATABASE_URL`, `JWT_SECRET`, `SETTINGS_ENCRYPTION_KEY`, `PORT`, `CORS_ORIGINS`, `TRUST_PROXY_HOPS`, the portals' `API_BASE_URL`, and the worker toggles `RESERVATION_SWEEP_SECONDS` and `OUTBOX_POLL_MS`.
- **Hard safety caps** that protect the system rather than express a business choice: the 128-character password maximum and 8-character floor, 1,000 search results, 50 attributes per category, and 1,000,000 units per stock adjustment.
- **Reference data:** the list of Nigeria's 37 states.
- **The currency (NGN).** Changing currency means migrating every price, not flipping a setting.

## Payment gateways

The admin portal's **Payment gateways** page lets staff add as many gateways as they like, of any supported type, and choose which are on and in what order. Customers see the enabled ones as "Pay with …" buttons.

| For each gateway | Notes |
| --- | --- |
| Name customers see | For example "Paystack" or "Pay by card". |
| Mode: test or live | Keys must match the mode (`sk_test_` or `sk_live_` for Paystack, `FLWSECK_TEST-` or `FLWSECK-` for Flutterwave). A live key can never be saved under test, or the reverse. |
| Credentials | Write-only. Encrypted with AES-256-GCM using `SETTINGS_ENCRYPTION_KEY`, stored as ciphertext, and shown only as their last four characters. Leaving a field blank keeps the saved value. |
| API address | Defaults to the gateway's own. Must be `https://` (plain http is allowed only for `localhost`, for test doubles). |
| On or off, and order | A gateway cannot be turned on until all its credentials are entered. |
| Webhook address | Shown on the page, built from Settings, API address, to paste into the gateway's dashboard. |
| Test connection | Makes a harmless authenticated call and reports the result in plain words. |

**Supported types:** Paystack and Flutterwave. Another gateway, such as Monnify or OPay, needs one adapter file (`apps/api/src/modules/payments/infrastructure/*.provider.ts`) and one entry in `GATEWAY_TYPES`. After that, staff configure it like the others.

### How the integrations were checked (11 November 2026)

- **Paystack:** from its official OpenAPI description (`PaystackOSS/openapi`). Initialization uses an integer `amount` in kobo, plus `reference` and `callback_url`, and returns `data.authorization_url`. Verification is `GET /transaction/verify/{reference}`, where `data.status` is `success` for a successful payment. Refunds are `POST /refund`.
- **Paystack webhook signature:** HMAC-SHA512 of the raw body, keyed with the secret key, in `x-paystack-signature`. This is **not** in the OpenAPI file. It comes from several consistent third-party guides, because paystack.com refused automated requests. **Confirm it with a real test-mode webhook before going live.**
- **Flutterwave:** from developer.flutterwave.com. Payments use `POST /payments` with `amount` in naira (major units) and return `data.link`. Verification is `GET /transactions/verify_by_reference?tx_ref=`, where `data.status` is `successful`. Webhooks carry the merchant's secret hash in a `verif-hash` header (a plain comparison). Refunds are `POST /transactions/{id}/refund`.

## Payment flow

1. On the review page the customer picks a gateway. The API checks that the checkout is open and unexpired, creates a `Payment` with a unique reference (`VND…`, letters and digits only) and the exact total, and asks the gateway for its payment page. Choosing the same gateway again reuses that payment, so a double click never starts two charges.
2. The customer pays on the gateway's page and is sent back to `{customer site address}/checkout/{id}/return?ref=…`.
3. **Neither the return address nor the webhook body is ever trusted.** Both only prompt the API to ask the gateway directly. The gateway's answer is the evidence:
   - A success with the expected amount and currency becomes `succeeded`.
   - A different amount becomes `requires_review`, and the order is not completed.
   - A pending answer stays pending.
4. Each webhook is checked with the credentials of the gateway it was sent to, and can only touch payments made through that gateway. Repeats are de-duplicated per gateway.
5. `PaymentSucceeded` is committed with the payment, through the outbox, and two modules react to it. Both reactions are safe to repeat.
   - **checkout** marks the session paid, commits the held stock as a sale, and removes the bought items from the basket.
     - If the hold lapsed while the customer was paying, the stock is re-reserved first.
     - If the items have sold out by then, the session is still marked paid and flagged `stockIssue` for a refund.
   - **ledger** posts a balanced entry: debit "Payment gateway clearing" (1100), credit "Customer prepayments" (2100). The account codes are settings.
6. After verifying, the API delivers pending events at once, so the customer's next page already shows the order as paid. A background poll (`OUTBOX_POLL_MS`) delivers anything left over.

## Not built yet

- Refunds are built: see [staff-mfa-and-refunds.md](staff-mfa-and-refunds.md).
- Reconciliation against gateway records.
- Delivery tracking is built: see [dispatch-and-tracking.md](dispatch-and-tracking.md).
