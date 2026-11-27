import { createSessionProxy } from '@vendra/portal-session/proxy';

/** The shop and basket are public. The account area and checkout need a session. */
export const proxy = createSessionProxy({ audience: 'store', protect: ['/account', '/checkout'], open: ['/register'] });

export const config = {
  // Photos and videos (and, in Admin, large uploads) skip the session proxy: they need no page
  // session, and the proxy would buffer upload bodies.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|media/|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt)$).*)'],
};
