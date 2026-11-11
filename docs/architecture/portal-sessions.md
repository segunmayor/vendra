# Portal sessions

All three portals use `@vendra/portal-session`, so sign-in behaves the same everywhere.

## Where tokens live

- The API issues a 15-minute access token and a rotating refresh token.
- The portal server stores both in `HttpOnly`, `SameSite=Lax`, `Path=/` cookies. Browser JavaScript never sees them.
- In production the cookies are `Secure` and carry the `__Host-` prefix, so no other subdomain can set or overwrite them.
- Each portal has its own cookie names (`vendra_store_*`, `vendra_admin_*`, `vendra_vendor_*`). The API also rejects a token from the wrong audience.
- The access cookie expires 30 seconds before its token, so a request never carries a token that dies in flight.

## Request flow

| Step | Where | What happens |
| --- | --- | --- |
| 1 | `proxy.ts` | Checks cookies only. No access cookie but a refresh cookie: redirect to `/auth/refresh?next=…`. Neither: redirect to sign-in. It makes no API call, as the Next.js guide advises. |
| 2 | `/auth/refresh` route | Rotates the refresh token, sets both cookies and returns to the page. A refused token clears the cookies. |
| 3 | Pages (`session.read`, `session.find`) | Call the API with the access token. A 401 sends the user to sign in. |
| 4 | Server Actions (`session.mutate`) | Refresh inline if the access token has expired, then call the API. They never rely on the proxy, because a matcher change could silently skip them. |

The API checks every permission. Portals only hide what a user cannot use.

## Refresh coalescing

The API treats a second use of a refresh token as theft and ends the whole session. Browsers often send several requests at once with the same cookie, such as link prefetches. The portal therefore makes all concurrent refreshes of one token share a single API call, and reuses the result for 10 seconds.

Tested on 11 November 2026: 8 simultaneous refreshes produced one rotation, and the session stayed valid. Sent straight to the API, the same duplicate ended the session.

**Limit:** coalescing works within one portal process. Running several instances of a portal needs sticky sessions or a shared store (Redis) first.

## Forms

`ActionForm` in `@vendra/ui` binds a form to a Server Action:

- It works without JavaScript.
- With JavaScript, it keeps typed values when an action fails and resets only on success.
- The submit button is disabled while the form is pending.

Stock adjustments render a fresh idempotency key into each form, so a double submit applies once.

## Visitor IP address

Sign-in is rate limited by IP address. To make the API see the visitor's address rather than the portal's, the portal sends `x-vendra-client-ip` with the shared `PORTAL_SHARED_SECRET`. The address comes from `X-Forwarded-For`, counting `PORTAL_TRUST_PROXY_HOPS` entries from the right.

With the default of 0 the header is ignored, because Next.js passes on a client-supplied value unchanged. **Production must set it to the number of reverse proxies in front of the portal.** Otherwise every visitor shares the portal's address, and 100 failed sign-ins in 15 minutes from anyone would block sign-in for everyone.
