import { createSessionProxy } from '@vendra/portal-session/proxy';

/** The shop and basket are public. The account area and checkout need a session. */
export const proxy = createSessionProxy({ audience: 'store', protect: ['/account', '/checkout'], open: ['/register'] });

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt)$).*)'],
};
