'use server';

import type { FormState } from '@vendra/ui';
import { nairaToKobo } from '@vendra/utils';
import { revalidatePath } from 'next/cache';
import { toFormState } from '../../../lib/forms';
import { session } from '../../../lib/session';

const field = (data: FormData, key: string) => String(data.get(key) ?? '').trim();

export async function requestRefund(paymentId: string, _state: FormState, data: FormData): Promise<FormState> {
  const amountMinor = nairaToKobo(field(data, 'amount'));
  if (!amountMinor || amountMinor === '0') return { status: 'error', message: 'Enter the amount to refund in naira, for example 12,500' };
  const reason = field(data, 'reason');
  if (reason.length < 3) return { status: 'error', message: 'Say why this refund is being made' };
  const result = await session.mutate((api) => api.POST('/v1/admin/payments/{id}/refunds', { params: { path: { id: paymentId } }, body: { amountMinor, reason } }));
  revalidatePath(`/payments/${paymentId}`);
  if (!result.ok) return { status: 'error', message: result.message };
  const messages: Record<string, FormState> = {
    succeeded: { status: 'success', message: 'Refunded. The gateway confirmed the money is on its way back to the customer.' },
    submitted: { status: 'success', message: 'Sent. The gateway is processing the refund. Check back later for its result.' },
    failed: { status: 'error', message: `The refund did not go through: ${result.data.failureReason ?? 'the gateway refused it'}. Nothing was refunded.` },
    unknown: { status: 'error', message: 'We could not tell whether the gateway received this refund. Check the gateway dashboard, then record what it shows below.' },
  };
  return messages[result.data.status] ?? { status: 'success', message: 'Saved.' };
}

export async function checkRefund(paymentId: string, refundId: string, _state: FormState): Promise<FormState> {
  const result = await session.mutate((api) => api.POST('/v1/admin/refunds/{id}/check', { params: { path: { id: refundId } } }));
  revalidatePath(`/payments/${paymentId}`);
  return toFormState(result, result.ok ? `The gateway says: ${result.data.gatewayStatus ?? result.data.status}` : '');
}

export async function resolveRefund(paymentId: string, refundId: string, _state: FormState, data: FormData): Promise<FormState> {
  const outcome = field(data, 'outcome') === 'succeeded' ? ('succeeded' as const) : ('failed' as const);
  const result = await session.mutate((api) => api.POST('/v1/admin/refunds/{id}/resolve', { params: { path: { id: refundId } }, body: { outcome, note: field(data, 'note') } }));
  revalidatePath(`/payments/${paymentId}`);
  return toFormState(result, 'Recorded.');
}
