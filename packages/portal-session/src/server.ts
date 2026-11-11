import 'server-only';
import { createVendraClient, isProblem, type components, type VendraClient } from '@vendra/api-client';
import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { NextResponse } from 'next/server';
import { cache } from 'react';
import {
  type Audience,
  clientIpFrom,
  cookieNames,
  expiredCookies,
  type IssuedSession,
  safeNextPath,
  sessionCookies,
  sharedCoalescer,
} from './core.ts';
import { PATH_HEADER } from './proxy.ts';

export type Profile = components['schemas']['ProfileResponse'];
export type { Audience };
export { safeNextPath };

export type ActionResult<T = undefined> = { ok: true; data: T } | { ok: false; message: string };

/** Thrown when the API refuses a refresh token: the session is over and the user must sign in. */
class SessionEnded extends Error {}

interface Settings {
  readonly apiBaseUrl: string;
  readonly portalSecret: string | undefined;
  readonly trustedHops: number;
  readonly secure: boolean;
}

function settings(): Settings {
  const apiBaseUrl = process.env.API_BASE_URL;
  if (!apiBaseUrl) throw new Error('API_BASE_URL is not set');
  const hops = Number(process.env.PORTAL_TRUST_PROXY_HOPS ?? '0');
  return {
    apiBaseUrl: apiBaseUrl.replace(/\/+$/, ''),
    portalSecret: process.env.PORTAL_SHARED_SECRET || undefined,
    trustedHops: Number.isInteger(hops) && hops >= 0 ? hops : 0,
    secure: process.env.NODE_ENV === 'production',
  };
}

/** Lets the API rate-limit sign-in by the visitor's address instead of the portal server's. */
function portalHeaders(config: Settings, forwardedFor: string | null): Record<string, string> {
  const ip = clientIpFrom(forwardedFor, config.trustedHops);
  if (!config.portalSecret || !ip) return {};
  return { 'x-vendra-portal-key': config.portalSecret, 'x-vendra-client-ip': ip };
}

async function postJson(config: Settings, path: string, body: unknown, extra: Record<string, string> = {}): Promise<Response> {
  return fetch(`${config.apiBaseUrl}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json', ...extra },
    body: JSON.stringify(body),
    cache: 'no-store',
  });
}

async function problemMessage(response: Response, fallback: string): Promise<string> {
  const body: unknown = await response.json().catch(() => null);
  return isProblem(body) ? body.detail : fallback;
}

export function createPortalSession(audience: Audience, options: { loginPath?: string; homePath?: string } = {}) {
  const loginPath = options.loginPath ?? '/login';
  const homePath = options.homePath ?? '/';
  const coalescer = sharedCoalescer<IssuedSession>(audience);
  const names = () => cookieNames(audience, settings().secure);

  async function writeSession(session: IssuedSession): Promise<void> {
    const store = await cookies();
    for (const cookie of sessionCookies(names(), session, settings().secure)) store.set(cookie);
  }

  async function clearSession(): Promise<void> {
    const store = await cookies();
    for (const cookie of expiredCookies(names(), settings().secure)) store.set(cookie);
  }

  async function refreshWith(config: Settings, refreshToken: string): Promise<IssuedSession> {
    return coalescer.run(refreshToken, async () => {
      const response = await postJson(config, `/v1/${audience}/auth/refresh`, { refreshToken });
      if (response.status === 401) throw new SessionEnded();
      if (!response.ok) throw new Error(`Session refresh failed with status ${response.status}`);
      return (await response.json()) as IssuedSession;
    });
  }

  function client(config: Settings, accessToken: string): VendraClient {
    return createVendraClient(config.apiBaseUrl, { headers: { authorization: `Bearer ${accessToken}` } });
  }

  /** The page being rendered, as recorded by the portal proxy, so sign-in can return to it. */
  async function currentPath(): Promise<string> {
    return safeNextPath((await headers()).get(PATH_HEADER), homePath);
  }

  async function toLogin(): Promise<never> {
    redirect(`${loginPath}?next=${encodeURIComponent(await currentPath())}`);
  }

  async function authenticate(email: string, password: string, kind: 'login' | 'register'): Promise<ActionResult> {
    const config = settings();
    const forwardedFor = (await headers()).get('x-forwarded-for');
    let response: Response;
    try {
      response = await postJson(config, `/v1/${audience}/auth/${kind}`, { email, password }, portalHeaders(config, forwardedFor));
    } catch {
      return { ok: false, message: 'We could not reach Vendra. Please try again in a moment.' };
    }
    if (!response.ok) {
      const fallback = kind === 'login' ? 'Incorrect email or password' : 'We could not create your account';
      return { ok: false, message: response.status >= 500 ? 'Something went wrong. Please try again.' : await problemMessage(response, fallback) };
    }
    await writeSession((await response.json()) as IssuedSession);
    return { ok: true, data: undefined };
  }

  /** Reads the signed-in profile once per render. Returns null when there is no valid session. */
  const getProfile = cache(async (): Promise<Profile | null> => {
    const accessToken = (await cookies()).get(names().access)?.value;
    if (!accessToken) return null;
    const config = settings();
    const { data, response } = await client(config, accessToken).GET(`/v1/${audience}/auth/me` as '/v1/admin/auth/me');
    if (response.status === 401) return null;
    if (!data) throw new Error(`Profile request failed with status ${response.status}`);
    return data;
  });

  return {
    audience,
    loginPath,

    signIn: (email: string, password: string) => authenticate(email, password, 'login'),
    register: (email: string, password: string) => authenticate(email, password, 'register'),

    /** Ends the session in the API as well as in the browser. */
    async signOut(): Promise<void> {
      const refreshToken = (await cookies()).get(names().refresh)?.value;
      if (refreshToken) {
        await postJson(settings(), `/v1/${audience}/auth/logout`, { refreshToken }).catch(() => undefined);
      }
      await clearSession();
    },

    getProfile,

    /** For pages: the signed-in profile, or a redirect to sign-in. */
    async requireProfile(): Promise<Profile> {
      return (await getProfile()) ?? toLogin();
    },

    /**
     * For Server Components. Rendering cannot set cookies, so this never refreshes.
     * The proxy has already sent a visitor with an expired access token through /auth/refresh.
     */
    async read<T>(call: (api: VendraClient) => Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
      const found = await this.find(call);
      if (found === null) throw new Error('API returned 404');
      return found;
    },

    /** Like `read`, but returns null when the record does not exist, for the page to call notFound(). */
    async find<T>(call: (api: VendraClient) => Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T | null> {
      const accessToken = (await cookies()).get(names().access)?.value;
      if (!accessToken) return toLogin();
      const { data, error, response } = await call(client(settings(), accessToken));
      if (response.status === 401) return toLogin();
      if (response.status === 404) return null;
      if (data === undefined || error !== undefined) {
        throw new Error(isProblem(error) ? `${error.status} ${error.code}: ${error.detail}` : `API returned ${response.status}`);
      }
      return data;
    },

    /** For Server Actions, which may set cookies and so refresh an expired access token first. */
    async mutate<T>(
      call: (api: VendraClient) => Promise<{ data?: T; error?: unknown; response: Response }>,
    ): Promise<ActionResult<T>> {
      const store = await cookies();
      const config = settings();
      let accessToken = store.get(names().access)?.value;
      if (!accessToken) {
        const refreshToken = store.get(names().refresh)?.value;
        if (!refreshToken) return toLogin();
        try {
          const session = await refreshWith(config, refreshToken);
          await writeSession(session);
          accessToken = session.accessToken;
        } catch (error) {
          if (error instanceof SessionEnded) {
            await clearSession();
            return toLogin();
          }
          return { ok: false, message: 'We could not reach Vendra. Please try again in a moment.' };
        }
      }
      let result: { data?: T; error?: unknown; response: Response };
      try {
        result = await call(client(config, accessToken));
      } catch {
        return { ok: false, message: 'We could not reach Vendra. Please try again in a moment.' };
      }
      const { data, error, response } = result;
      if (response.status === 401) return toLogin();
      if (response.ok) return { ok: true, data: data as T };
      if (response.status === 403) return { ok: false, message: 'You do not have permission to do this.' };
      if (response.status >= 500) return { ok: false, message: 'Something went wrong. Please try again.' };
      return { ok: false, message: isProblem(error) ? error.detail : `The request failed (${response.status})` };
    },

    /** GET handler for app/auth/refresh/route.ts. */
    async refreshRoute(request: Request): Promise<Response> {
      const config = settings();
      const url = new URL(request.url);
      const next = safeNextPath(url.searchParams.get('next'), homePath);
      const refreshToken = (await cookies()).get(names().refresh)?.value;
      const toLoginPage = (reason?: string) => {
        const target = new URL(loginPath, url);
        target.searchParams.set('next', next);
        if (reason) target.searchParams.set('reason', reason);
        return NextResponse.redirect(target, 303);
      };
      if (!refreshToken) return toLoginPage();
      try {
        const session = await refreshWith(config, refreshToken);
        const response = NextResponse.redirect(new URL(next, url), 303);
        for (const cookie of sessionCookies(names(), session, config.secure)) response.cookies.set(cookie);
        response.headers.set('cache-control', 'no-store');
        return response;
      } catch (error) {
        if (!(error instanceof SessionEnded)) return toLoginPage('unavailable');
        const response = toLoginPage('expired');
        for (const cookie of expiredCookies(names(), config.secure)) response.cookies.set(cookie);
        return response;
      }
    },
  };
}

export type PortalSession = ReturnType<typeof createPortalSession>;
