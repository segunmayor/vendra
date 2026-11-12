import { Badge, EmptyState, Input, PageHeader, Table, Td } from '@vendra/ui';
import { formatMoney } from '@vendra/utils';
import type { Metadata } from 'next';
import Link from 'next/link';
import { session } from '../../../lib/session';
import { dateTime, ORDER_LABEL, ORDER_STATUSES, ORDER_TONE, type OrderStatus } from './labels';

export const metadata: Metadata = { title: 'Orders' };

export default async function OrdersPage({ searchParams }: { searchParams: Promise<{ status?: string; number?: string }> }) {
  const params = await searchParams;
  const status = ORDER_STATUSES.includes(params.status as OrderStatus) ? (params.status as OrderStatus) : undefined;
  const number = params.number && /^\d{1,12}$/.test(params.number.trim()) ? params.number.trim() : undefined;
  const orders = await session.read((api) => api.GET('/v1/admin/orders', { params: { query: { status, number } } }));

  return (
    <>
      <PageHeader title="Orders" description="Latest 100. An order is placed once its payment is confirmed by the gateway." />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <nav aria-label="Filter by status" className="flex flex-wrap gap-2 text-sm">
          {[undefined, ...ORDER_STATUSES].map((option) => (
            <Link
              key={option ?? 'all'}
              href={`/orders${option ? `?status=${option}` : ''}`}
              aria-current={option === status && !number ? 'page' : undefined}
              className={`rounded-full border px-3 py-1 ${option === status && !number ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface'}`}
            >
              {option ? ORDER_LABEL[option] : 'All'}
            </Link>
          ))}
        </nav>
        <form action="/orders" className="ml-auto flex gap-2">
          <Input name="number" aria-label="Order number" placeholder="Order number" inputMode="numeric" defaultValue={number ?? ''} className="w-40" />
          <button type="submit" className="rounded-md border border-border bg-surface px-3 text-sm">
            Find
          </button>
        </form>
      </div>
      {orders.length === 0 ? (
        <EmptyState title={number ? `No order ${number}` : 'No orders'}>{number ? 'Check the number and try again.' : 'Orders appear here as customers pay.'}</EmptyState>
      ) : (
        <Table caption="Orders" head={['Order', 'Items', 'Total', 'Deliver to', 'Status', 'Placed']}>
          {orders.map((order) => (
            <tr key={order.id}>
              <Td className="font-mono">
                <Link href={`/orders/${order.id}`} className="underline underline-offset-2">
                  {order.number}
                </Link>
              </Td>
              <Td>
                {order.firstItem}
                {order.lineCount > 1 ? <span className="text-muted"> and {order.lineCount - 1} other item{order.lineCount > 2 ? 's' : ''}</span> : null}
              </Td>
              <Td className="tabular-nums">{formatMoney(order.total.amountMinor, order.total.currency)}</Td>
              <Td>
                {order.city}, {order.state}
              </Td>
              <Td>
                <Badge tone={ORDER_TONE[order.status as OrderStatus] ?? 'neutral'}>{ORDER_LABEL[order.status as OrderStatus] ?? order.status}</Badge>
              </Td>
              <Td className="whitespace-nowrap text-muted">{dateTime.format(new Date(order.placedAt))}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
