import 'server-only';
import { type components, createVendraClient, isProblem } from '@vendra/api-client';
import { SessionUnavailable } from '@vendra/portal-session/server';
import { cookies } from 'next/headers';
import { apiBase, GUEST_CART_COOKIE, setGuestToken } from './cart-cookie';
import { session } from './session';

export type Cart = components['schemas']['CartResponse'];
export type CartLine = components['schemas']['CartLineResponse'];

const EMPTY: Cart = { lines: [], itemCount: 0, subtotal: { amountMinor: '0', currency: 'NGN' }, canCheckout: false };

function client(accessToken: string | null, guest: string | undefined) {
  const headers: Record<string, string> = {};
  if (accessToken) headers.authorization = `Bearer ${accessToken}`;
  else if (guest) headers['x-cart-token'] = guest;
  return createVendraClient(apiBase(), { headers, fetch: (request) => fetch(request, { cache: 'no-store' }) });
}

/** For pages: the visitor's basket, signed in or not. Never cached, since it is personal and changes often. */
export async function readCart(): Promise<Cart> {
  const token = await session.currentAccessToken();
  const guest = (await cookies()).get(GUEST_CART_COOKIE)?.value;
  if (!token && !guest) return EMPTY;
  const { data } = await client(token, guest).GET('/v1/store/cart');
  return data ?? EMPTY;
}

export type CartActionResult = { ok: true; cart: Cart } | { ok: false; message: string };

type Call = (api: ReturnType<typeof client>) => Promise<{ data?: Cart; error?: unknown; response: Response }>;

/** For Server Actions: refreshes the session if needed, and keeps the guest token the API hands back. */
async function change(call: Call): Promise<CartActionResult> {
  let token: string | null;
  try {
    token = await session.actionAccessToken();
  } catch (error) {
    if (error instanceof SessionUnavailable) return { ok: false, message: 'We could not reach Vendra. Please try again in a moment.' };
    throw error;
  }
  const guest = (await cookies()).get(GUEST_CART_COOKIE)?.value;
  let result: Awaited<ReturnType<Call>>;
  try {
    result = await call(client(token, guest));
  } catch {
    return { ok: false, message: 'We could not reach Vendra. Please try again in a moment.' };
  }
  const { data, error, response } = result;
  if (!response.ok || !data) {
    return { ok: false, message: isProblem(error) && response.status < 500 ? error.detail : 'Something went wrong. Please try again.' };
  }
  if (data.guestToken) await setGuestToken(data.guestToken);
  return { ok: true, cart: data };
}

export const addToCart = (listingId: string, quantity: number) => change((api) => api.POST('/v1/store/cart/items', { body: { listingId, quantity } }));
export const setCartQuantity = (listingId: string, quantity: number) =>
  change((api) => api.PUT('/v1/store/cart/items/{listingId}', { params: { path: { listingId } }, body: { quantity } }));
