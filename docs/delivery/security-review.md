# Pre-launch security review

Reviewed 13–14 November 2026, before the 18 November launch. This is the engineering review of the code and configuration. It is not a substitute for an independent penetration test, which we recommend before the marketplace opens.

## What was checked, and the result

| Area | Result |
| --- | --- |
| Route access | Every route is denied unless it declares a policy. A new test (`test/route-policy.spec.ts`) checks the whole route table on every run. It verifies that every route has a policy, the public routes match a reviewed list of 19, every staff route except the signed-in person's own security settings needs a permission, each audience only answers under its own path, and refunds and gateway keys need two-step sign-in. |
| Tokens and sessions | HS256 only, with audience and issuer checked. Each request re-reads the session, so revocation, suspension and permission changes apply at once. Refresh tokens rotate, and reusing one revokes the whole family. Portal cookies are httpOnly, SameSite=Lax and `__Host-` prefixed in production. Browser JavaScript never sees a token. |
| Passwords and sign-in | Argon2id. The same response time whether or not the account exists. Per-account and per-address failure limits, set in Settings. Staff use two-step sign-in, with recovery codes. |
| Redirects after sign-in | Only same-site paths. Protocol-relative paths, backslashes and control characters are refused. |
| Payments | Webhook signatures are compared in constant time. Payments are verified with the gateway before an order is placed, and a different amount goes to review instead of placing an order. Checkout and stock changes use idempotency keys. Gateway keys are encrypted at rest. |
| Customer and seller isolation | Integration tests prove customers see only their own orders and tracking, and sellers only their own application and files. |
| Seller documents | The type is checked from the file's content. Files are always sent as downloads with `nosniff` and a sandboxing CSP. There are size caps per file, per kind and per application. |
| Errors | Unexpected errors return a generic message. Details go to the server log only. |
| Ledger | A new test checks that every journal entry written in a full test run balances in each currency. |

## Fixed in this review

1. **Unlimited sign-ups.** Anyone could script customer or seller account creation. Each seller account could then store up to 120 MB of documents in the database, which is a cheap way to fill the disk. Fixed with:
   - a per-address limit on new accounts ("New accounts per IP address each hour", default 100, kept generous because mobile networks share addresses);
   - a 50 MB cap on everything stored for one application;
   - deleting a removed document outright if it was never sent for review. Before, removing and re-uploading kept every copy.
2. **Missing security headers.**
   - The API now sends `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`, a `default-src 'none'` CSP and `Cache-Control: no-store`. It sends HSTS in production, and no longer sends `X-Powered-By`.
   - The portals now send a CSP (no framing, no plugins, no outside scripts or connections), `nosniff`, `X-Frame-Options`, a referrer policy and a permissions policy. They send HSTS in production. The rules are shared in `@vendra/config/security-headers`.
3. **Production could start without critical secrets.** The API now refuses to start in production without these:
   - `SETTINGS_ENCRYPTION_KEY`;
   - `PORTAL_SHARED_SECRET`, without which every visitor appears to come from the portal server, so per-address limits would block everyone together;
   - https-only `CORS_ORIGINS`.
4. **IP addresses kept forever.** Sign-in and sign-up records hold IP addresses (personal data under the Nigeria Data Protection Act) and were never deleted. They are now deleted hourly once older than 25 hours, the longest window any limit uses.
5. **Ledger after refunds (found while preparing the launch rehearsal).** A refund always came out of customer prepayments, even after delivery, when that money had already moved to sales. Every return would have pushed prepayments below zero and overstated sales. Each journal entry now records its payment, so the ledger knows how much of a payment it still holds as a prepayment:
   - a refund takes what is still held from prepayments, and puts the rest on "Refunds after delivery" (account 4900, a setting);
   - a delivery recognises only what is still held, so a partial refund before delivery is handled too;
   - migration 0014 backfills the link for existing entries.
6. **API surface on the internet.** The staging proxy exposes only health checks and payment webhooks on the API domain. The portals reach every other route over the private network.

## Accepted risks (reviewed, not fixed)

| Risk | Why accepted | Revisit |
| --- | --- | --- |
| `deepmerge-ts` < 8 (high, stack exhaustion) through the Prisma command-line tool's config loader | Only merges our own config file at migration time, never request data. Forcing a major version inside Prisma is riskier. | Next Prisma upgrade |
| CSP allows `'unsafe-inline'` scripts | Next.js needs inline scripts for hydration without per-request nonces. Other directives still block outside scripts, framing and plugins. | When nonce-based CSP is added through the portal proxy |
| No rate limit on public reads (storefront, search) | Reads are bounded (search returns at most 1,000 results). An edge limit belongs at the host or CDN, which has not been chosen. | When hosting is chosen (go-live checklist) |
| Seller documents stored in PostgreSQL | Bounded by the caps above. Moving them to object storage changes one repository. | Before the marketplace opens |
| Staff have no "unsuspend" or session list | Suspension and revocation work. Only the reverse is missing. | After launch |

## Not covered by this review

- Hosting, network and operating-system hardening. The host has not been chosen. See the go-live checklist.
- Payment provider account security (2FA on the Paystack dashboard, team access). This is owned by the project owner.
- Legal review of the privacy policy and data processing under the NDPA.
