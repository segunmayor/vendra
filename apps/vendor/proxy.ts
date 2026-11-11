import { createSessionProxy } from '@vendra/portal-session/proxy';

export const proxy = createSessionProxy({ audience: 'vendor', protect: 'all', open: ['/register'] });

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|svg|webp|ico|txt)$).*)'],
};
