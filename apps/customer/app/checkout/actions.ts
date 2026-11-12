'use server';

import type { FormState } from '@vendra/ui';
import { formatMoney } from '@vendra/utils';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { session } from '../../lib/session';
import { isState } from '../../lib/states';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const field = (data: FormData, key: string) => String(data.get(key) ?? '').trim();

export async function startCheckout(_state: FormState, data: FormData): Promise<FormState> {
  const key = field(data, 'idempotencyKey');
  if (!UUID.test(key)) return { status: 'error', message: 'Please reload the page and try again' };
  const result = await session.mutate((api) =>
    api.POST('/v1/store/checkout', {
      params: { header: { 'Idempotency-Key': key } },
      body: {
        address: {
          recipient: field(data, 'recipient'),
          phone: field(data, 'phone'),
          line1: field(data, 'line1'),
          line2: field(data, 'line2') || null,
          city: field(data, 'city'),
          state: field(data, 'state'),
        },
      },
    }),
  );
  if (!result.ok) return { status: 'error', message: result.message };
  redirect(`/checkout/${result.data.id}`);
}

const isUuid = (value: string) => UUID.test(value);

/** Starts payment with the chosen gateway and sends the customer to its payment page. */
export async function payWith(checkoutId: string, gatewayId: string, _state: FormState): Promise<FormState> {
  if (!isUuid(checkoutId) || !isUuid(gatewayId)) return { status: 'error', message: 'Please reload the page and try again' };
  const result = await session.mutate((api) => api.POST('/v1/store/checkout/{id}/payments', { params: { path: { id: checkoutId } }, body: { gatewayId } }));
  if (!result.ok) return { status: 'error', message: result.message };
  // Only gateway payment pages over HTTPS, as returned by the API.
  if (!/^https:\/\//.test(result.data.redirectUrl)) return { status: 'error', message: 'The payment page could not be opened. Please try again.' };
  redirect(result.data.redirectUrl);
}

export async function cancelCheckout(checkoutId: string, _state: FormState): Promise<FormState> {
  const result = await session.mutate((api) => api.POST('/v1/store/checkout/{id}/cancel', { params: { path: { id: checkoutId } } }));
  revalidatePath(`/checkout/${checkoutId}`);
  return result.ok ? { status: 'success', message: 'Checkout cancelled. Your items are back on sale.' } : { status: 'error', message: result.message };
}

export async function checkDelivery(_state: FormState, data: FormData): Promise<FormState> {
  const state = field(data, 'state');
  if (!isState(state)) return { status: 'error', message: 'Choose a state' };
  const result = await session.mutate((api) => api.POST('/v1/store/checkout/quote', { body: { state } }));
  if (!result.ok) return { status: 'error', message: result.message };
  if (result.data.problem || !result.data.delivery || !result.data.total) return { status: 'error', message: result.data.problem ?? 'We cannot deliver there yet' };
  const { delivery, total } = result.data;
  return {
    status: 'success',
    message: `Delivery to ${state}: ${formatMoney(delivery.amountMinor, delivery.currency)}. Total ${formatMoney(total.amountMinor, total.currency)}.`,
  };
}
