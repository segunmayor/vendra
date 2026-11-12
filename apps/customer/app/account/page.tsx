import { Card, EmptyState } from '@vendra/ui';
import { formatMoney } from '@vendra/utils';
import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '../../components/site-header';
import { ORDER_STATUS, orderDate } from '../../lib/orders';
import { session } from '../../lib/session';
import { signOut } from '../login/actions';

export const metadata: Metadata = { title: 'My account' };

export default async function AccountPage() {
  const profile = await session.requireProfile();
  const orders = await session.read((api) => api.GET('/v1/store/orders'));
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
        <h2 className="mt-10 text-lg font-semibold">My orders</h2>
        {orders.length === 0 ? (
          <div className="mt-4">
            <EmptyState title="No orders yet">Your orders and their delivery progress will appear here.</EmptyState>
          </div>
        ) : (
          <ul className="mt-4 space-y-3">
            {orders.map((order) => (
              <li key={order.id}>
                <Link href={`/account/orders/${order.id}`} className="block rounded-brand border border-border bg-surface p-4 hover:border-primary">
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-semibold">Order {order.number}</span>
                    <span className="text-sm">{ORDER_STATUS[order.status]?.label ?? order.status}</span>
                  </div>
                  <p className="mt-1 text-sm text-muted">
                    {orderDate.format(new Date(order.placedAt))} · {order.firstItem}
                    {order.lineCount > 1 ? ` and ${order.lineCount - 1} other item${order.lineCount > 2 ? 's' : ''}` : ''} · {formatMoney(order.total.amountMinor, order.total.currency)}
                  </p>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
    </>
  );
}
