import { createSessionProxy } from '@vendra/portal-session/proxy';

export const proxy = createSessionProxy({ audience: 'admin', protect: 'all' });

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt)$).*)'],
};
