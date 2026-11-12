import { Card, EmptyState } from '@vendra/ui';
import type { Metadata } from 'next';
import { SiteHeader } from '../../components/site-header';
import { session } from '../../lib/session';
import { signOut } from '../login/actions';

export const metadata: Metadata = { title: 'My account' };

export default async function AccountPage() {
  const profile = await session.requireProfile();
  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <h1 className="text-2xl font-bold tracking-tight">My account</h1>
        <Card className="mt-6 flex flex-wrap items-center justify-between gap-4">
          <div>
            <div className="text-sm text-muted">Signed in as</div>
            <div className="font-semibold">{profile.email}</div>
          </div>
          <form action={signOut}>
            <button type="submit" className="text-sm font-semibold text-primary underline underline-offset-2">
              Sign out
            </button>
          </form>
        </Card>
        <div className="mt-6">
          <EmptyState title="No orders yet">Your orders and their delivery progress will appear here.</EmptyState>
        </div>
      </main>
    </>
  );
}
