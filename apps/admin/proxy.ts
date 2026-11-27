import { createSessionProxy } from '@vendra/portal-session/proxy';

export const proxy = createSessionProxy({ audience: 'admin', protect: 'all' });

export const config = {
  // Photos and videos (and, in Admin, large uploads) skip the session proxy: they need no page
  // session, and the proxy would buffer upload bodies.
  matcher: ['/((?!_next/static|_next/image|favicon.ico|media/|uploads/|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt)$).*)'],
};
