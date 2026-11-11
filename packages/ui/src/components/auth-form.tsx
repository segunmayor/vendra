import type { ReactNode } from 'react';
import { ActionForm, type FormState, SubmitButton } from './action-form';
import { Field, Input } from './fields';

/** Email and password form for sign-in and registration on every portal. */
export function AuthForm({
  action,
  next,
  mode,
  footer,
}: {
  action: (state: FormState, data: FormData) => Promise<FormState>;
  next: string;
  mode: 'sign-in' | 'register';
  footer?: ReactNode;
}) {
  const registering = mode === 'register';
  return (
    <ActionForm action={action} className="space-y-4">
      <input type="hidden" name="next" value={next} />
      <Field label="Email">
        <Input type="email" name="email" autoComplete={registering ? 'email' : 'username'} required autoFocus />
      </Field>
      <Field label="Password" hint={registering ? 'At least 12 characters. A short phrase is easiest to remember.' : undefined}>
        <Input
          type="password"
          name="password"
          autoComplete={registering ? 'new-password' : 'current-password'}
          minLength={registering ? 12 : undefined}
          maxLength={128}
          required
        />
      </Field>
      <SubmitButton className="w-full" pendingLabel={registering ? 'Creating account…' : 'Signing in…'}>
        {registering ? 'Create account' : 'Sign in'}
      </SubmitButton>
      {footer ? <p className="text-center text-sm text-muted">{footer}</p> : null}
    </ActionForm>
  );
}
