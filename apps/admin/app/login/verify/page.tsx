import { getPublicSettings, safeNextPath, text } from '@vendra/portal-session/server';
import { ActionForm, Card, Field, Input, SubmitButton, Wordmark } from '@vendra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { session } from '../../../lib/session';
import { verifyCode } from '../actions';

export const metadata: Metadata = { title: 'Enter your code' };

export default async function VerifyPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const next = safeNextPath((await searchParams).next);
  if (await session.getProfile()) redirect(next);
  if (!(await session.hasMfaChallenge())) redirect(`/login?next=${encodeURIComponent(next)}`);
  const store = await getPublicSettings();

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <Card className="w-full max-w-sm p-6">
        <Wordmark name={text(store, 'store.name')} suffix="Admin" />
        <h1 className="mt-6 text-xl font-bold">Enter your code</h1>
        <p className="mt-1 text-sm text-muted">Open your authenticator app and type the 6-digit code it shows for {text(store, 'store.name')} Admin.</p>
        <div className="mt-6">
          <ActionForm action={verifyCode} className="space-y-4">
            <input type="hidden" name="next" value={next} />
            <Field label="Code" hint="Lost your phone? Enter one of your recovery codes instead.">
              <Input name="code" inputMode="text" autoComplete="one-time-code" autoCapitalize="characters" spellCheck={false} maxLength={20} required autoFocus className="font-mono tracking-widest" />
            </Field>
            <SubmitButton className="w-full" pendingLabel="Checking…">
              Continue
            </SubmitButton>
          </ActionForm>
        </div>
        <p className="mt-4 text-center text-sm text-muted">
          <Link href={`/login?next=${encodeURIComponent(next)}`} className="underline underline-offset-2">
            Start again
          </Link>
        </p>
      </Card>
    </main>
  );
}
