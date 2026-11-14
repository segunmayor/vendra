# Go-live checklist: 18 November 2026

Tick each line on launch day, and note who checked it. Items marked **Owner** depend on decisions or accounts outside the code.

## Before launch day

### Accounts and decisions (Owner)

- [ ] Hosting chosen and the production host provisioned (see `infrastructure/staging/README.md` for a single-host setup).
- [ ] Domains bought, and DNS for the store, admin, sellers and API domains pointing at the host.
- [ ] Paystack live account approved, with business verification complete. Two-step sign-in on the Paystack dashboard for every team member.
- [ ] Who delivers orders, and to which states. Delivery zones and prices entered in Admin, Delivery prices.
- [ ] Privacy policy, terms and returns policy reviewed by a qualified adviser (Nigeria Data Protection Act), and published.
- [ ] Email provider chosen. Until then customers and sellers get no emails: they check order and application status by signing in. Support must know this.
- [ ] Real catalogue: categories, products, prices, images and opening stock.

### Environment

- [ ] Fresh secrets generated for production, never copied from staging: database password, `JWT_SECRET`, `SETTINGS_ENCRYPTION_KEY`, `PORTAL_SHARED_SECRET`.
- [ ] `SETTINGS_ENCRYPTION_KEY` stored in the password manager by two people.
- [ ] `docker compose ps` shows migrate exited 0, and the API, portals and Caddy healthy.
- [ ] `node infrastructure/scripts/smoke.mjs …` against the production domains passes every check.
- [ ] A backup taken and restored into a scratch database successfully.
- [ ] Daily backups scheduled, and kept off the host.
- [ ] Optional: Admin limited to office or VPN addresses (`ADMIN_ALLOWED_IPS`).

### Admin setup (first administrator)

- [ ] First administrator created, two-step sign-in set up, recovery codes stored safely.
- [ ] Roles created with only the permissions each job needs (orders, deliveries, catalogue, refunds, sellers). Staff accounts created. Nobody shares an account.
- [ ] Settings, Store: store name, support email and phone, payment safety message.
- [ ] Settings, Payments: customer site address and API address set to the production `https://` addresses.
- [ ] Payment gateways: Paystack added in **live** mode with the live secret key, "Test connection" passes, and the webhook address shown is entered in the Paystack dashboard.
- [ ] Settings, Seller applications: required documents and whether applications are open.
- [ ] Ledger account codes in Settings match the chart of accounts (1100, 2100, 4000, 4100, 4900 by default). Codes are not checked when saved, so a typo stops ledger posting.

## Launch rehearsal (on production, before announcing)

Use a real card and a small real amount, then refund it.

- [ ] Customer: register, search, add to cart, check out to a Lagos address, pay with Paystack.
- [ ] The order appears in Admin as "To send". The payment shows as succeeded, and the webhook arrived (Payments page).
- [ ] Staff hand it to a courier with a tracking number, then record collected, on the way, out for delivery and delivered. The customer sees each step.
- [ ] The ledger shows the payment in prepayments, then moved to sales and delivery charges.
- [ ] Refund the rehearsal order in full from Admin (this needs two-step sign-in). Paystack confirms the refund, and the ledger debits "Refunds after delivery" (4900), since the sale was already recorded.
- [ ] Seller: apply with test documents; staff ask for changes, then reject. Remove the test application's account afterwards if wanted.
- [ ] Place a second small order, hand it to a courier, then cancel it before collection. The stock goes back, the shipment shows cancelled, and the order page shows the amount still to refund. Refund it: the ledger debits prepayments (2100), not 4900.
- [ ] Staff without a permission cannot open that page. A signed-out visitor to Admin is sent to sign in.

## Launch day watch list

There is no monitoring service yet (Sentry and alerts are planned), so check these by hand at least twice a day in the first week:

- [ ] Dashboard: payments to review, orders with a stock issue, failed deliveries, orders to send, seller applications to review.
- [ ] `docker compose logs api | grep -i error` shows nothing new.
- [ ] Disk space on the host (`df -h`): the database and seller documents grow here.
- [ ] Payments page: no payments stuck as "initiated" from more than an hour ago.

## Known limits at launch

Tell support and staff about these:
- customers cannot cancel orders themselves: staff cancel from the order page before a courier collects the items, then refund from the payment;
- no emails or SMS;
- approved sellers cannot list products yet;
- staff cannot unsuspend a staff account;
- no carrier integration: delivery steps are recorded by hand.
