import { PortalShell, Wordmark } from '@vendra/ui';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { session } from '../../lib/session';
import { signOut } from '../login/actions';

export default async function VendorLayout({ children }: { children: ReactNode }) {
  const profile = await session.requireProfile();
  return (
    <PortalShell
      brand={<Wordmark suffix="Sellers" />}
      navigation={[{ label: 'Application', href: '/' }]}
      currentPath="/"
      renderLink={(item, props) => (
        <Link href={item.href} {...props}>
          {item.label}
        </Link>
      )}
      account={
        <div className="text-sm">
          <p className="truncate font-medium" title={profile.email}>{profile.email}</p>
          <form action={signOut} className="mt-2">
            <button type="submit" className="text-sm text-muted underline underline-offset-2 hover:text-foreground">Sign out</button>
          </form>
        </div>
      }
    >
      {children}
    </PortalShell>
  );
}
