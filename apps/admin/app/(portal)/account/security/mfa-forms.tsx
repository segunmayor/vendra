'use client';

import { Alert, Button, Field, Input } from '@vendra/ui';
import { useActionState } from 'react';
import { type CodesState, replaceRecoveryCodes, type SetupState, setupStep } from './actions';

/** "JBSWY3DPEHPK3PXP" as "JBSW Y3DP EHPK 3PXP", easier to type into a phone. */
const grouped = (secret: string) => secret.replace(/(.{4})/g, '$1 ').trim();

function RecoveryCodes({ codes }: { codes: readonly string[] }) {
  return (
    <div className="space-y-3">
      <Alert tone="warning">
        Save these recovery codes somewhere safe, such as a password manager. Each one signs you in once if you lose your phone. They will not be shown again.
      </Alert>
      <ol className="grid grid-cols-2 gap-2 font-mono text-sm" aria-label="Recovery codes">
        {codes.map((code) => (
          <li key={code} className="rounded-md border border-border bg-surface px-3 py-2 text-center">
            {code}
          </li>
        ))}
      </ol>
    </div>
  );
}

export function MfaSetup() {
  const [current, action, pending] = useActionState(setupStep, { step: 'start' } as SetupState);

  if (current.step === 'done') {
    return (
      <div className="space-y-4">
        <Alert tone="success">Two-step sign-in is on. Other devices signed in to this account have been signed out.</Alert>
        <RecoveryCodes codes={current.recoveryCodes} />
        <a href="/" className="inline-block text-sm font-medium underline underline-offset-2">
          I have saved my codes. Continue to Admin
        </a>
      </div>
    );
  }

  if (current.step === 'start') {
    return (
      <form action={action} className="space-y-4">
        <input type="hidden" name="intent" value="begin" />
        {current.message ? <Alert>{current.message}</Alert> : null}
        <p className="text-sm">
          You need an authenticator app on your phone, such as Google Authenticator, Microsoft Authenticator or 1Password.
        </p>
        <Button type="submit" disabled={pending}>
          {pending ? 'Starting…' : 'Set up authenticator app'}
        </Button>
      </form>
    );
  }

  return (
    <form action={action} className="space-y-5">
      <input type="hidden" name="intent" value="confirm" />
      {current.message ? <Alert>{current.message}</Alert> : null}
      <ol className="list-decimal space-y-4 pl-5 text-sm">
        <li>
          In the app, choose to add an account and enter this setup key. Choose &ldquo;time-based&rdquo; if asked.
          <p className="mt-2 select-all break-all rounded-md border border-border bg-surface px-3 py-2 font-mono text-base tracking-wider" aria-label="Setup key">
            {grouped(current.secret)}
          </p>
          <p className="mt-2 text-muted">
            On this phone?{' '}
            <a href={current.uri} className="underline underline-offset-2">
              Open in authenticator app
            </a>
          </p>
        </li>
        <li>
          <Field label="Type the 6-digit code the app shows">
            <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required className="w-40 font-mono tracking-widest" />
          </Field>
        </li>
      </ol>
      <div className="flex gap-3">
        <Button type="submit" disabled={pending}>
          {pending ? 'Checking…' : 'Turn on two-step sign-in'}
        </Button>
      </div>
    </form>
  );
}

export function ReplaceRecoveryCodes() {
  const [state, action, pending] = useActionState(replaceRecoveryCodes, {} as CodesState);
  if (state.codes) return <RecoveryCodes codes={state.codes} />;
  return (
    <form action={action} className="space-y-3">
      {state.message ? <Alert>{state.message}</Alert> : null}
      <Field label="Code from your authenticator app" hint="New codes replace all your old ones.">
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required className="w-40 font-mono tracking-widest" />
      </Field>
      <Button type="submit" variant="outline" disabled={pending}>
        {pending ? 'Making codes…' : 'Make new recovery codes'}
      </Button>
    </form>
  );
}
