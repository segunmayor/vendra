import { createHash } from 'node:crypto';

/** Framework-free session rules, kept apart from Next.js so they can be unit tested. */

export type Audience = 'store' | 'admin' | 'vendor';

export interface IssuedSession {
  readonly accessToken: string;
  readonly accessTokenExpiresAt: string;
  readonly refreshToken: string;
  readonly refreshTokenExpiresAt: string;
}

/** Drop the access cookie this long before the token expires, so a request never carries a token that dies in flight. */
export const ACCESS_EXPIRY_SKEW_MS = 30_000;

export interface CookieNames {
  readonly access: string;
  readonly refresh: string;
}

/**
 * In production the `__Host-` prefix makes the browser reject the cookie unless it is
 * Secure, has no Domain and uses Path=/, so no sibling subdomain can set or overwrite it.
 */
export function cookieNames(audience: Audience, secure: boolean): CookieNames {
  const prefix = secure ? '__Host-' : '';
  return { access: `${prefix}vendra_${audience}_at`, refresh: `${prefix}vendra_${audience}_rt` };
}

/** Holds the second-step ticket between the password page and the code page. */
export function challengeCookieName(audience: Audience, secure: boolean): string {
  return `${secure ? '__Host-' : ''}vendra_${audience}_mfa`;
}

export interface CookieSpec {
  readonly name: string;
  readonly value: string;
  readonly httpOnly: true;
  readonly secure: boolean;
  readonly sameSite: 'lax';
  readonly path: '/';
  readonly expires: Date;
}

/** Both tokens live only in httpOnly cookies. Browser JavaScript never sees them. */
export function sessionCookies(names: CookieNames, session: IssuedSession, secure: boolean): [CookieSpec, CookieSpec] {
  const base = { httpOnly: true, secure, sameSite: 'lax', path: '/' } as const;
  const accessExpires = new Date(Date.parse(session.accessTokenExpiresAt) - ACCESS_EXPIRY_SKEW_MS);
  return [
    { ...base, name: names.access, value: session.accessToken, expires: accessExpires },
    { ...base, name: names.refresh, value: session.refreshToken, expires: new Date(session.refreshTokenExpiresAt) },
  ];
}

/** Accepts only a path on this site, so `?next=` cannot send a signed-in user elsewhere. */
export function safeNextPath(raw: string | null | undefined, fallback = '/'): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback;
  // Reject control characters, which some browsers strip to turn "/\t/evil.com" into "//evil.com".
  if (/[\u0000-\u001f\u007f]/.test(raw)) return fallback;
  try {
    const url = new URL(raw, 'http://portal.invalid');
    if (url.origin !== 'http://portal.invalid') return fallback;
    return `${url.pathname}${url.search}`;
  } catch {
    return fallback;
  }
}

/**
 * Picks the visitor's address from X-Forwarded-For. With `trustedHops` reverse proxies in
 * front of the portal, the entry they appended is `trustedHops` from the right; anything
 * further left came from the client and may be forged. With no trusted proxy the header is
 * entirely client controlled, so nothing is returned.
 */
export function clientIpFrom(forwardedFor: string | null, trustedHops: number): string | null {
  if (!forwardedFor || trustedHops < 1) return null;
  const entries = forwardedFor.split(',').map((entry) => entry.trim()).filter(Boolean);
  const candidate = entries[entries.length - trustedHops];
  return candidate ?? null;
}

interface Settled<T> {
  readonly value: T;
  readonly until: number;
}

/**
 * The API rotates refresh tokens and treats any reuse as theft, revoking the whole session.
 * A browser often sends several requests at once with the same cookie, so this makes every
 * concurrent refresh of one token share a single API call. The result is also kept for a
 * short grace period for requests that left the browser just before the new cookie arrived.
 *
 * It works within one portal process. Running several instances of a portal needs sticky
 * sessions or a shared store.
 */
export class RefreshCoalescer<T> {
  private readonly inFlight = new Map<string, Promise<T>>();
  private readonly settled = new Map<string, Settled<T>>();

  private readonly graceMs: number;
  private readonly maxEntries: number;
  private readonly now: () => number;

  constructor(graceMs = 10_000, maxEntries = 10_000, now: () => number = Date.now) {
    this.graceMs = graceMs;
    this.maxEntries = maxEntries;
    this.now = now;
  }

  run(refreshToken: string, refresh: () => Promise<T>): Promise<T> {
    const key = createHash('sha256').update(refreshToken).digest('base64url');
    this.prune();
    const recent = this.settled.get(key);
    if (recent) return Promise.resolve(recent.value);
    const pending = this.inFlight.get(key);
    if (pending) return pending;

    const task = refresh().then(
      (value) => {
        this.inFlight.delete(key);
        if (this.settled.size >= this.maxEntries) this.settled.clear();
        this.settled.set(key, { value, until: this.now() + this.graceMs });
        return value;
      },
      (error: unknown) => {
        // Failures are not kept: the token is dead, and the next caller should find out from the API.
        this.inFlight.delete(key);
        throw error;
      },
    );
    this.inFlight.set(key, task);
    return task;
  }

  private prune(): void {
    const now = this.now();
    for (const [key, entry] of this.settled) {
      if (entry.until <= now) this.settled.delete(key);
    }
  }
}

/** Shares one coalescer per audience across every bundle in the process. Next.js bundles route handlers and pages separately. */
export function sharedCoalescer<T>(audience: Audience): RefreshCoalescer<T> {
  const registry = globalThis as typeof globalThis & { [key: symbol]: RefreshCoalescer<T> | undefined };
  const key = Symbol.for(`vendra.portal-session.refresh.${audience}`);
  registry[key] ??= new RefreshCoalescer<T>();
  return registry[key];
}

/** Deleting a cookie means setting it again, expired, with the same attributes. Browsers ignore a `__Host-` deletion that is not Secure. */
export function expiredCookies(names: CookieNames, secure: boolean): [CookieSpec, CookieSpec] {
  const base = { value: '', httpOnly: true, secure, sameSite: 'lax', path: '/', expires: new Date(0) } as const;
  return [
    { ...base, name: names.access },
    { ...base, name: names.refresh },
  ];
}
