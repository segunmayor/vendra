'use server';

import type { components } from '@vendra/api-client';
import type { FormState } from '@vendra/ui';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { session } from '../../../../lib/session';

const field = (data: FormData, key: string) => String(data.get(key) ?? '').trim();

function readGateway(data: FormData) {
  const pick = (prefix: string) =>
    Object.fromEntries([...data.keys()].filter((key) => key.startsWith(prefix)).map((key) => [key.slice(prefix.length), field(data, key)]));
  return {
    name: field(data, 'name'),
    enabled: data.get('enabled') === 'on',
    mode: field(data, 'mode') === 'live' ? ('live' as const) : ('test' as const),
    position: Number(field(data, 'position') || '0'),
    config: pick('config.'),
    credentials: pick('credential.'),
  };
}

export async function createGateway(_state: FormState, data: FormData): Promise<FormState> {
  const result = await session.mutate((api) =>
    api.POST('/v1/admin/payment-gateways', {
      // The API checks the type against the gateways it supports.
      body: { type: field(data, 'type') as components['schemas']['CreateGatewayDto']['type'], name: field(data, 'name'), enabled: false, mode: 'test', position: 0, config: {}, credentials: {} },
    }),
  );
  if (!result.ok) return { status: 'error', message: result.message };
  revalidatePath('/settings/payments');
  redirect(`/settings/payments/${result.data.id}`);
}

export async function updateGateway(id: string, _state: FormState, data: FormData): Promise<FormState> {
  const result = await session.mutate((api) => api.PUT('/v1/admin/payment-gateways/{id}', { params: { path: { id } }, body: readGateway(data) }));
  revalidatePath('/settings/payments');
  revalidatePath(`/settings/payments/${id}`);
  return result.ok ? { status: 'success', message: result.data.enabled ? 'Saved. Customers can now pay with this gateway.' : 'Saved. This gateway is off.' } : { status: 'error', message: result.message };
}

export async function testGateway(id: string, _state: FormState): Promise<FormState> {
  const result = await session.mutate((api) => api.POST('/v1/admin/payment-gateways/{id}/test', { params: { path: { id } } }));
  if (!result.ok) return { status: 'error', message: result.message };
  return { status: result.data.ok ? 'success' : 'error', message: result.data.message };
}
