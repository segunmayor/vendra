import 'server-only';
import { createVendraClient } from '@vendra/api-client';
import { cookies } from 'next/headers';

/** The guest basket's token. httpOnly, so page scripts never see it; Lax, so it survives arriving from a link. */
export const GUEST_CART_COOKIE = process.env.NODE_ENV === 'production' ? '__Host-vendra_cart' : 'vendra_cart';
const THIRTY_DAYS = 30 * 24 * 60 * 60;

export function apiBase(): string {
  const base = process.env.API_BASE_URL;
  if (!base) throw new Error('API_BASE_URL is not set');
  return base;
}

export async function setGuestToken(token: string): Promise<void> {
  (await cookies()).set({
    name: GUEST_CART_COOKIE,
    value: token,
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: THIRTY_DAYS,
  });
}

export async function clearGuestToken(): Promise<void> {
  (await cookies()).set({ name: GUEST_CART_COOKIE, value: '', httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/', maxAge: 0 });
}

/** Moves the guest basket into the customer's after sign-in. Kept apart from lib/cart to avoid an import cycle with the session. */
export async function mergeGuestCart(accessToken: string): Promise<void> {
  const guest = (await cookies()).get(GUEST_CART_COOKIE)?.value;
  if (!guest) return;
  const { response } = await createVendraClient(apiBase(), {
    headers: { authorization: `Bearer ${accessToken}`, 'x-cart-token': guest },
  }).POST('/v1/store/cart/merge');
  if (response.ok) await clearGuestToken();
}
