# Staff two-step sign-in and refunds

Built 12 Nov 2026 (Step 6b).

## Two-step sign-in (MFA)

Staff sign in with a password and then a code from an authenticator app (TOTP, RFC 6238: SHA-1, 6 digits, 30 seconds). Google Authenticator, Microsoft Authenticator, 1Password and Authy all work.

### Setting it up

1. A new staff member signs in with their password. Their session is *unverified*.
2. While the setting **Staff must use two-step sign-in** is on (the default), an unverified session can only reach the set-up page (`/account/security`) and its API routes (marked `@AllowWithoutMfa`). Every other staff route answers `403 auth.mfa_setup_required`.
3. The page shows a setup key and an `otpauth://` link. The person adds it to their app and types the code it shows.
4. On a correct code the API turns MFA on in one transaction:
   - marks the current session verified, and ends every other session of that account;
   - records the time step used, so the same code cannot be used again;
   - replaces the recovery codes and writes `auth.mfa_enabled` to the audit log.
5. The page shows 10 recovery codes once. They are stored only as SHA-256 hashes.

### Signing in afterwards

1. `POST /v1/admin/auth/login` with a correct password returns `{ mfaRequired, challengeToken, challengeExpiresAt }` and no session.
2. The admin portal keeps the challenge in an httpOnly `SameSite=Strict` cookie for 5 minutes and shows the code page.
3. `POST /v1/admin/auth/mfa/verify` with the challenge and a code (or a recovery code) returns a verified session.

Safeguards:
- A challenge is single use and allows 5 wrong codes, then the password must be entered again.
- Wrong codes also count towards the per-account sign-in limit.
- A code is accepted for one 30-second step either side of the server clock, and each step only once.
- Each recovery code works once. Using one is audited.
- Refreshing a session keeps its verified flag. A new sign-in always needs the code.

### Always required

Whatever the setting says, these need a verified session (`@RequireMfa`), and the refund service checks again itself:
- refunds, and recording what the gateway dashboard shows for a refund in doubt;
- creating or changing a payment gateway (its keys);
- resetting another staff member's two-step sign-in.

### Lost phone

Another administrator with `staff.manage` and a verified session calls `POST /v1/admin/staff/{id}/mfa/reset`. This turns MFA off, deletes the recovery codes, ends all of that person's sessions and writes `auth.mfa_reset` to the audit log. Nobody can reset their own. There is no staff management page in Admin yet, so this is an API call for now.

The MFA secret is encrypted with `SETTINGS_ENCRYPTION_KEY`, like gateway keys. If that key changes, every staff member's two-step sign-in has to be reset.

**First administrator:** `admin:create` makes the account. They sign in, are sent to the set-up page, and set up their app before anything else.

## Refunds

Staff with `orders.refund` refund from **Admin → Payments → (a payment)**. The money goes back through the gateway the customer paid with.

1. The amount is **held** on the payment (`refundPendingMinor`) before the gateway is asked, in the same transaction that records the refund. Two staff refunding at once can never return more than was paid. A database check enforces it too.
2. The API asks the gateway. Its answer decides the refund status:

| Gateway answer | Refund status | Held money |
|---|---|---|
| Done (Paystack `processed`, Flutterwave `completed`) | `succeeded` | Counted as refunded |
| Accepted, still processing | `submitted` | Stays held |
| Refused (a 4xx answer) | `failed` | Released |
| No clear answer (timeout, 5xx) | `unknown` | Stays held |

3. **Check status** asks the gateway again for a `submitted` refund.
4. For an `unknown` refund the gateway may or may not have it, so it is never retried automatically. Staff look in the gateway dashboard and record what it shows (refunded or not, with a note). This is audited. A refund still `pending` after 5 minutes (the request was cut off) is handled the same way.
5. Once a refund succeeds, `PaymentRefunded` goes through the outbox and the ledger posts the reverse of the payment: debit customer prepayments (2100), credit gateway clearing (1100).

The payment becomes `partially_refunded` or `refunded` only once the money is confirmed returned.

Gateway details:
- **Paystack:** `POST /refund` with the transaction reference. The amount is in kobo and left out for a full refund. `GET /refund/{id}` reports progress. Taken from Paystack's published OpenAPI description.
- **Flutterwave:** `POST /transactions/{id}/refund`. Its reference documents the amount as an integer in naira, so a part refund must be whole naira; a full refund sends no amount. Progress is `GET /refunds/{id}`. That path is from memory of the v3 API, because its reference page could not be fetched on 12 Nov. Check it with a test-mode refund.

Not covered yet:
- Payments flagged `requires_review` (the wrong amount) cannot be refunded here. Refund them from the gateway dashboard.
- Refund webhooks from the gateways are not processed. Use **Check status**.
- No QR code on the set-up page, because the QR library could not be installed from this environment. The setup key and the "open in app" link work without it.
