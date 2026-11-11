import { Wordmark } from '@vendra/ui';
import Link from 'next/link';
import { session } from '../lib/session';

export async function SiteHeader() {
  const profile = await session.getProfile();
  return (
    <header className="border-b border-border bg-surface">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
        <Link href="/" aria-label="Vendra home">
          <Wordmark />
        </Link>
        <Link href={profile ? '/account' : '/login'} className="text-sm font-semibold text-primary">
          {profile ? 'My account' : 'Sign in'}
        </Link>
      </div>
    </header>
  );
}
