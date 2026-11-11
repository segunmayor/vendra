import { type NavItem, PortalShell, Wordmark } from '@vendra/ui';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { session } from '../../lib/session';
import { signOut } from '../login/actions';

/** Each item appears only for staff holding its permission. Later steps add orders, payments and the rest. */
const NAVIGATION: readonly (NavItem & { permission?: string })[] = [
  { label: 'Dashboard', href: '/' },
  { label: 'Products', href: '/catalogue/products', permission: 'catalogue.manage' },
  { label: 'Categories', href: '/catalogue/categories', permission: 'catalogue.manage' },
  { label: 'Brands', href: '/catalogue/brands', permission: 'catalogue.manage' },
  { label: 'Warehouses', href: '/inventory/warehouses', permission: 'inventory.manage' },
  { label: 'Delivery prices', href: '/settings/delivery', permission: 'settings.manage' },
];

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const profile = await session.requireProfile();
  const path = (await headers()).get('x-vendra-path')?.split('?')[0] ?? '/';
  const navigation = NAVIGATION.filter((item) => !item.permission || profile.permissions.includes(item.permission));

  return (
    <PortalShell
      brand={<Wordmark suffix="Admin" />}
      navigation={navigation}
      currentPath={path}
      renderLink={(item, props) => (
        <Link href={item.href} {...props}>
          {item.label}
        </Link>
      )}
      account={
        <div className="text-sm">
          <p className="truncate font-medium" title={profile.email}>
            {profile.email}
          </p>
          <form action={signOut} className="mt-2">
            <button type="submit" className="text-sm text-muted underline underline-offset-2 hover:text-foreground">
              Sign out
            </button>
          </form>
        </div>
      }
    >
      {children}
    </PortalShell>
  );
}
