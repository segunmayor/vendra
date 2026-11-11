import { safeNextPath } from '@vendra/portal-session/server';
import { Alert, AuthForm, Card, Wordmark } from '@vendra/ui';
import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { session } from '../../lib/session';
import { signIn } from './actions';

export const metadata: Metadata = { title: 'Sign in · Vendra Admin' };

const REASONS: Record<string, string> = {
  expired: 'Your session has ended. Please sign in again.',
  unavailable: 'We could not reach Vendra to keep you signed in. Please sign in again.',
};

export default async function LoginPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const next = safeNextPath(params.next);
  if (await session.getProfile()) redirect(next);
  const reason = params.reason ? REASONS[params.reason] : undefined;

  return (
    <main className="grid min-h-screen place-items-center p-4">
      <Card className="w-full max-w-sm p-6">
        <Wordmark suffix="Admin" />
        <h1 className="mt-6 text-xl font-bold">Sign in</h1>
        <p className="mt-1 text-sm text-muted">For Vendra staff only.</p>
        {reason ? <div className="mt-4"><Alert tone="warning">{reason}</Alert></div> : null}
        <div className="mt-6">
          <AuthForm action={signIn} next={next} mode="sign-in" />
        </div>
      </Card>
    </main>
  );
}
