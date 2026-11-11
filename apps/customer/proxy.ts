import { createSessionProxy } from '@vendra/portal-session/proxy';

/** The shop is public. Only the account area needs a session. Checkout joins it in Step 5. */
export const proxy = createSessionProxy({ audience: 'store', protect: ['/account'], open: ['/register'] });

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt)$).*)'],
};
