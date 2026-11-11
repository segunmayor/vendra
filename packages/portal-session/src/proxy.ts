import { type NextRequest, NextResponse } from 'next/server.js';
import { type Audience, cookieNames } from './core.ts';

/** Set by the proxy so pages know their own path when sending someone to sign in. */
export const PATH_HEADER = 'x-vendra-path';

export interface SessionProxyOptions {
  readonly audience: Audience;
  /** Paths that need a session. Each entry matches itself and everything below it. */
  readonly protect: readonly string[] | 'all';
  /** Paths open to everyone even when `protect` is 'all', such as the sign-in page. */
  readonly open?: readonly string[];
  readonly loginPath?: string;
}

const under = (pathname: string, prefix: string) =>
  prefix === '/' || pathname === prefix || pathname.startsWith(`${prefix}/`);

/**
 * An optimistic check on cookies alone, as the Next.js guide recommends. It makes no API call.
 * Pages and Server Actions still verify the session with the API on every request.
 */
export function createSessionProxy(options: SessionProxyOptions) {
  const loginPath = options.loginPath ?? '/login';
  const open = ['/auth', loginPath, ...(options.open ?? [])];

  return function proxy(request: NextRequest): NextResponse {
    const { pathname, search } = request.nextUrl;
    const requestHeaders = new Headers(request.headers);
    requestHeaders.set(PATH_HEADER, `${pathname}${search}`);
    const pass = () => NextResponse.next({ request: { headers: requestHeaders } });

    const isProtected =
      !open.some((prefix) => under(pathname, prefix)) &&
      (options.protect === 'all' || options.protect.some((prefix) => under(pathname, prefix)));
    // Server Actions arrive as POST. They check and refresh the session themselves.
    if (!isProtected || (request.method !== 'GET' && request.method !== 'HEAD')) return pass();

    const names = cookieNames(options.audience, process.env.NODE_ENV === 'production');
    if (request.cookies.has(names.access)) return pass();

    const next = encodeURIComponent(`${pathname}${search}`);
    const target = request.cookies.has(names.refresh) ? `/auth/refresh?next=${next}` : `${loginPath}?next=${next}`;
    return NextResponse.redirect(new URL(target, request.url), 307);
  };
}
