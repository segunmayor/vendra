'use server';

import { safeNextPath } from '@vendra/portal-session/server';
import type { FormState } from '@vendra/ui';
import { redirect } from 'next/navigation';
import { text } from '../../lib/forms';
import { session } from '../../lib/session';

export async function signIn(_state: FormState, data: FormData): Promise<FormState> {
  const email = text(data, 'email');
  const password = typeof data.get('password') === 'string' ? (data.get('password') as string) : '';
  if (!email || !password) return { status: 'error', message: 'Enter your email and password' };
  const result = await session.signIn(email, password);
  if (!result.ok) return { status: 'error', message: result.message };
  const next = safeNextPath(text(data, 'next'));
  if (result.data.mfaRequired) redirect(`/login/verify?next=${encodeURIComponent(next)}`);
  redirect(next);
}

/** The second step: a code from the authenticator app, or a recovery code. */
export async function verifyCode(_state: FormState, data: FormData): Promise<FormState> {
  const code = text(data, 'code');
  if (!code) return { status: 'error', message: 'Enter the code from your authenticator app' };
  const result = await session.completeMfa(code);
  if (!result.ok) return { status: 'error', message: result.message };
  redirect(safeNextPath(text(data, 'next')));
}

export async function signOut(): Promise<void> {
  await session.signOut();
  redirect(session.loginPath);
}
