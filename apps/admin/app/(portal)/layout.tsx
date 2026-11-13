import { getPublicSettings, text } from '@vendra/portal-session/server';
import { type NavItem, PortalShell, Wordmark } from '@vendra/ui';
import { headers } from 'next/headers';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import type { ReactNode } from 'react';
import { session } from '../../lib/session';
import { signOut } from '../login/actions';

/** Each item appears only for staff holding its permission. */
const NAVIGATION: readonly (NavItem & { permission?: string })[] = [
  { label: 'Dashboard', href: '/' },
  { label: 'Orders', href: '/orders', permission: 'orders.manage' },
  { label: 'Deliveries', href: '/shipments', permission: 'shipments.manage' },
  { label: 'Products', href: '/catalogue/products', permission: 'catalogue.manage' },
  { label: 'Categories', href: '/catalogue/categories', permission: 'catalogue.manage' },
  { label: 'Brands', href: '/catalogue/brands', permission: 'catalogue.manage' },
  { label: 'Warehouses', href: '/inventory/warehouses', permission: 'inventory.manage' },
  { label: 'Payments', href: '/payments', permission: 'payments.read' },
  { label: 'Delivery prices', href: '/settings/delivery', permission: 'settings.manage' },
  { label: 'Payment gateways', href: '/settings/payments', permission: 'settings.manage' },
  { label: 'Settings', href: '/settings/general', permission: 'settings.manage' },
  { label: 'Staff', href: '/staff', permission: 'staff.manage' },
  { label: 'Two-step sign-in', href: '/account/security' },
];

const SECURITY_PATH = '/account/security';

export default async function PortalLayout({ children }: { children: ReactNode }) {
  const profile = await session.requireProfile();
  const path = (await headers()).get('x-vendra-path')?.split('?')[0] ?? '/';
  // Until two-step sign-in is set up (when the setting requires it), only its page is open.
  if (profile.mfa.setupRequired && path !== SECURITY_PATH) redirect(SECURITY_PATH);
  const navigation = profile.mfa.setupRequired
    ? NAVIGATION.filter((item) => item.href === SECURITY_PATH)
    : NAVIGATION.filter((item) => !item.permission || profile.permissions.includes(item.permission));

  return (
    <PortalShell
      brand={<Wordmark name={text(await getPublicSettings(), 'store.name')} suffix="Admin" />}
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
