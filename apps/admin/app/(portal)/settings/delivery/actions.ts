'use server';

import type { FormState } from '@vendra/ui';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { readZone } from '../../../../lib/delivery';
import { toFormState } from '../../../../lib/forms';
import { session } from '../../../../lib/session';

export async function createZone(_state: FormState, data: FormData): Promise<FormState> {
  const parsed = readZone(data);
  if (!parsed.ok) return { status: 'error', message: parsed.message };
  const result = await session.mutate((api) => api.POST('/v1/admin/delivery-zones', { body: parsed.zone }));
  if (!result.ok) return { status: 'error', message: result.message };
  revalidatePath('/settings/delivery');
  redirect('/settings/delivery');
}

export async function updateZone(zoneId: string, _state: FormState, data: FormData): Promise<FormState> {
  const parsed = readZone(data);
  if (!parsed.ok) return { status: 'error', message: parsed.message };
  const result = await session.mutate((api) => api.PUT('/v1/admin/delivery-zones/{id}', { params: { path: { id: zoneId } }, body: parsed.zone }));
  revalidatePath('/settings/delivery');
  return toFormState(result, 'Zone saved');
}
