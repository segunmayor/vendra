'use server';

import { safeNextPath } from '@vendra/portal-session/server';
import type { FormState } from '@vendra/ui';
import { redirect } from 'next/navigation';
import { session } from '../../lib/session';

function credentials(data: FormData) {
  const email = data.get('email');
  const password = data.get('password');
  return { email: typeof email === 'string' ? email.trim() : '', password: typeof password === 'string' ? password : '' };
}

const nextPath = (data: FormData) => safeNextPath(typeof data.get('next') === 'string' ? (data.get('next') as string) : null, HOME);

const HOME = '/';
const SIGNED_OUT = '/login';

export async function signIn(_state: FormState, data: FormData): Promise<FormState> {
  const { email, password } = credentials(data);
  if (!email || !password) return { status: 'error', message: 'Enter your email and password' };
  const result = await session.signIn(email, password);
  if (!result.ok) return { status: 'error', message: result.message };
  redirect(nextPath(data));
}

export async function register(_state: FormState, data: FormData): Promise<FormState> {
  const { email, password } = credentials(data);
  if (!email || !password) return { status: 'error', message: 'Enter your email and a password' };
  if (password.length < 12) return { status: 'error', message: 'Use a password of at least 12 characters' };
  const result = await session.register(email, password);
  if (!result.ok) return { status: 'error', message: result.message };
  redirect(nextPath(data));
}

export async function signOut(): Promise<void> {
  await session.signOut();
  redirect(SIGNED_OUT);
}
