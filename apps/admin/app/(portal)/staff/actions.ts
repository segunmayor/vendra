'use server';

import type { FormState } from '@vendra/ui';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { toFormState } from '../../../lib/forms';
import { session } from '../../../lib/session';

const field = (data: FormData, key: string) => String(data.get(key) ?? '').trim();
const chosen = (data: FormData, key: string) => data.getAll(key).map(String).filter(Boolean);

export async function addStaff(_state: FormState, data: FormData): Promise<FormState> {
  const email = field(data, 'email');
  const password = String(data.get('password') ?? '');
  if (!email || !password) return { status: 'error', message: 'Enter an email and a starting password' };
  const result = await session.mutate((api) => api.POST('/v1/admin/staff', { body: { email, password, roleIds: chosen(data, 'roleIds') } }));
  if (!result.ok) return { status: 'error', message: result.message };
  revalidatePath('/staff');
  redirect(`/staff/${result.data.id}?added=1`);
}

export async function setRoles(id: string, _state: FormState, data: FormData): Promise<FormState> {
  const result = await session.mutate((api) => api.PUT('/v1/admin/staff/{id}/roles', { params: { path: { id } }, body: { roleIds: chosen(data, 'roleIds') } }));
  revalidatePath('/staff');
  revalidatePath(`/staff/${id}`);
  return toFormState(result, 'Roles saved. They apply at once.');
}

export async function suspend(id: string, _state: FormState, data: FormData): Promise<FormState> {
  if (data.get('confirm') !== 'on') return { status: 'error', message: 'Tick the box to confirm' };
  const result = await session.mutate((api) => api.POST('/v1/admin/staff/{id}/suspend', { params: { path: { id } } }));
  revalidatePath('/staff');
  revalidatePath(`/staff/${id}`);
  return toFormState(result, 'Suspended. They have been signed out everywhere.');
}

export async function resetMfa(id: string, _state: FormState, data: FormData): Promise<FormState> {
  if (data.get('confirm') !== 'on') return { status: 'error', message: 'Tick the box to confirm' };
  const result = await session.mutate((api) => api.POST('/v1/admin/staff/{id}/mfa/reset', { params: { path: { id } } }));
  revalidatePath(`/staff/${id}`);
  return toFormState(result, 'Two-step sign-in reset. They have been signed out, and will set it up again at their next sign-in.');
}

export async function addRole(_state: FormState, data: FormData): Promise<FormState> {
  const permissions = chosen(data, 'permissions');
  if (permissions.length === 0) return { status: 'error', message: 'Choose at least one permission' };
  const result = await session.mutate((api) => api.POST('/v1/admin/roles', { body: { name: field(data, 'name'), permissions } }));
  revalidatePath('/staff/roles');
  return toFormState(result, 'Role added.');
}
