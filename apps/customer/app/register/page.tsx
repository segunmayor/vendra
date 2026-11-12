import { getPublicSettings, safeNextPath, text } from '@vendra/portal-session/server';
import { AuthForm, Card, Wordmark } from '@vendra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { register } from '../login/actions';
import { session } from '../../lib/session';

export const metadata: Metadata = { title: 'Create account' };

export default async function RegisterPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const next = safeNextPath((await searchParams).next, '/account');
  if (await session.getProfile()) redirect(next);
  return (
    <main className="grid min-h-screen place-items-center p-4">
      <Card className="w-full max-w-sm p-6">
        <Link href="/"><Wordmark name={text(await getPublicSettings(), 'store.name')} /></Link>
        <h1 className="mt-6 text-xl font-bold">Create an account</h1>
        <p className="mt-1 mb-6 text-sm text-muted">Save your details for a faster checkout and follow your orders.</p>
        <AuthForm
          action={register}
          next={next}
          mode="register"
          footer={<>Already registered? <Link className="font-semibold text-primary underline" href={`/login?next=${encodeURIComponent(next)}`}>Sign in</Link></>}
        />
      </Card>
    </main>
  );
}
