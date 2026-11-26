'use server';

import type { FormState } from '@vendra/ui';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { invalid, text } from '../../../../lib/forms';
import { session } from '../../../../lib/session';

const HOME = '/settings/storage';
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Reads "config.*" and "credential.*" fields. Checkboxes send "on" only when ticked. */
function readLocation(data: FormData, booleans: readonly string[]) {
  const pick = (prefix: string) =>
    Object.fromEntries([...data.keys()].filter((key) => key.startsWith(prefix) && !key.startsWith(`${prefix}__`)).map((key) => [key.slice(prefix.length), text(data, key)]));
  const config: Record<string, string> = pick('config.');
  for (const key of booleans) config[key] = data.get(`config.${key}`) === 'on' ? 'true' : 'false';
  return { name: text(data, 'name'), config, credentials: pick('credential.') };
}

const booleansOf = (data: FormData) => text(data, 'booleans').split(',').filter(Boolean);

export async function createLocation(type: string, _state: FormState, data: FormData): Promise<FormState> {
  const result = await session.mutate((api) => api.POST('/v1/admin/storage/locations', { body: { type, ...readLocation(data, booleansOf(data)) } }));
  if (!result.ok) return invalid(result.message);
  revalidatePath(HOME);
  redirect(`${HOME}/${result.data.id}?added=1`);
}

export async function updateLocation(id: string, _state: FormState, data: FormData): Promise<FormState> {
  if (!UUID.test(id)) return invalid('Storage location not found');
  const result = await session.mutate((api) => api.PUT('/v1/admin/storage/locations/{id}', { params: { path: { id } }, body: readLocation(data, booleansOf(data)) }));
  revalidatePath(HOME);
  revalidatePath(`${HOME}/${id}`);
  if (!result.ok) return invalid(result.message);
  return { status: 'success', message: result.data.active ? 'Saved. The new settings passed their check, and new files keep going here.' : 'Saved. Test the connection before making it active.' };
}

export async function testLocation(id: string, _state: FormState): Promise<FormState> {
  if (!UUID.test(id)) return invalid('Storage location not found');
  const result = await session.mutate((api) => api.POST('/v1/admin/storage/locations/{id}/test', { params: { path: { id } } }));
  revalidatePath(`${HOME}/${id}`);
  if (!result.ok) return invalid(result.message);
  const check = result.data.lastCheck;
  return check?.ok ? { status: 'success', message: 'It works: a test file was written, read back and deleted.' } : invalid(check?.message ?? 'The check failed.');
}

export async function activateLocation(id: string, _state: FormState): Promise<FormState> {
  if (!UUID.test(id)) return invalid('Storage location not found');
  const result = await session.mutate((api) => api.POST('/v1/admin/storage/locations/{id}/activate', { params: { path: { id } } }));
  revalidatePath(HOME);
  revalidatePath(`${HOME}/${id}`);
  if (!result.ok) return invalid(result.message);
  // The form that asked disappears once the location is active, so the page says it instead.
  redirect(`${HOME}/${id}?activated=1`);
}

export async function keepFilesInDatabase(_state: FormState): Promise<FormState> {
  const result = await session.mutate((api) => api.POST('/v1/admin/storage/database/activate'));
  revalidatePath(HOME);
  if (!result.ok) return invalid(result.message);
  redirect(`${HOME}?database=1`);
}

export async function removeLocation(id: string, _state: FormState): Promise<FormState> {
  if (!UUID.test(id)) return invalid('Storage location not found');
  const result = await session.mutate((api) => api.DELETE('/v1/admin/storage/locations/{id}', { params: { path: { id } } }));
  if (!result.ok) return invalid(result.message);
  revalidatePath(HOME);
  redirect(HOME);
}

export async function startMove(_state: FormState, data: FormData): Promise<FormState> {
  const result = await session.mutate((api) => api.POST('/v1/admin/storage/moves', { body: { deleteOld: data.get('deleteOld') === 'on' } }));
  revalidatePath(`${HOME}/move`);
  revalidatePath(HOME);
  if (!result.ok) return invalid(result.message);
  redirect(`${HOME}/move`);
}

export async function stopMove(id: string, _state: FormState): Promise<FormState> {
  if (!UUID.test(id)) return invalid('Move not found');
  const result = await session.mutate((api) => api.POST('/v1/admin/storage/moves/{id}/cancel', { params: { path: { id } } }));
  revalidatePath(`${HOME}/move`);
  if (!result.ok) return invalid(result.message);
  redirect(`${HOME}/move`);
}
