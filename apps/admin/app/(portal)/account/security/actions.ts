'use server';

import { session } from '../../../../lib/session';

export type SetupState =
  | { readonly step: 'start'; readonly message?: string }
  | { readonly step: 'scan'; readonly secret: string; readonly uri: string; readonly message?: string }
  | { readonly step: 'done'; readonly recoveryCodes: readonly string[] };

/** One action for the whole set-up, so the form keeps its place between steps. */
export async function setupStep(state: SetupState, data: FormData): Promise<SetupState> {
  return data.get('intent') === 'confirm' ? confirmSetup(state, data) : beginSetup();
}

/** Step 1: a new secret for the authenticator app. */
async function beginSetup(): Promise<SetupState> {
  const result = await session.mutate((api) => api.POST('/v1/admin/auth/mfa/setup'));
  if (!result.ok) return { step: 'start', message: result.message };
  return { step: 'scan', secret: result.data.secret, uri: result.data.uri };
}

/** Step 2: the code proves the app is set up. Returns recovery codes, shown once. */
async function confirmSetup(state: SetupState, data: FormData): Promise<SetupState> {
  if (state.step !== 'scan') return state;
  const code = String(data.get('code') ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return { ...state, message: 'Enter the 6-digit code from the app' };
  const result = await session.mutate((api) => api.POST('/v1/admin/auth/mfa/confirm', { body: { code } }));
  if (!result.ok) return { ...state, message: result.message };
  return { step: 'done', recoveryCodes: result.data.recoveryCodes };
}

export type CodesState = { readonly codes?: readonly string[]; readonly message?: string };

export async function replaceRecoveryCodes(_state: CodesState, data: FormData): Promise<CodesState> {
  const code = String(data.get('code') ?? '').replace(/\s/g, '');
  if (!/^\d{6}$/.test(code)) return { message: 'Enter the 6-digit code from the app' };
  const result = await session.mutate((api) => api.POST('/v1/admin/auth/mfa/recovery-codes', { body: { code } }));
  if (!result.ok) return { message: result.message };
  return { codes: result.data.recoveryCodes };
}
