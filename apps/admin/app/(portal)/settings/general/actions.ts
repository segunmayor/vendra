'use server';

import type { FormState } from '@vendra/ui';
import { revalidatePath } from 'next/cache';
import { toFormState } from '../../../../lib/forms';
import { session } from '../../../../lib/session';

/** Saves one group. The form lists its keys and kinds, so unchecked boxes still count as "off". */
export async function saveSettings(_state: FormState, data: FormData): Promise<FormState> {
  const values: Record<string, string | number | boolean> = {};
  for (const entry of String(data.get('fields') ?? '').split(',').filter(Boolean)) {
    const [key, kind] = entry.split(':');
    if (!key || !kind) continue;
    const raw = data.get(`s:${key}`);
    if (kind === 'boolean') values[key] = raw === 'on';
    else if (kind === 'integer' || kind === 'decimal') values[key] = String(raw ?? '').trim() === '' ? NaN : Number(raw);
    else values[key] = String(raw ?? '');
  }
  const result = await session.mutate((api) => api.PUT('/v1/admin/settings', { body: { values } }));
  revalidatePath('/', 'layout');
  return toFormState(result, 'Saved. Changes apply within a few seconds.');
}
