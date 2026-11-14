import { Alert, Card } from '@vendra/ui';
import { formatMoney } from '@vendra/utils';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '../../../../components/site-header';
import { ORDER_STATUS, orderDate, SHIPMENT_STEP, STAGES, stageOf, stepTime } from '../../../../lib/orders';
import { session } from '../../../../lib/session';

export const metadata: Metadata = { title: 'Order', robots: { index: false } };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  await session.requireProfile();
  const order = await session.find((api) => api.GET('/v1/store/orders/{id}', { params: { path: { id } } }));
  if (!order) notFound();
  const shipments = order.status === 'stock_issue' || order.status === 'cancelled' ? [] : await session.read((api) => api.GET('/v1/store/orders/{id}/shipments', { params: { path: { id } } }));
  const latest = shipments[shipments.length - 1];
  const stage = stageOf(order.status, latest?.status);
  const status = ORDER_STATUS[order.status] ?? { label: order.status, note: '' };
  const note = order.status === 'placed' && latest && stage > 0 ? `${SHIPMENT_STEP[latest.status] ?? latest.status}.` : status.note;
  const money = (value: { amountMinor: string; currency: string }) => formatMoney(value.amountMinor, value.currency);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-10">
        <p className="text-sm">
          <Link href="/account" className="text-muted underline underline-offset-2">
            My account
          </Link>
        </p>
        <h1 className="mt-2 text-2xl font-bold tracking-tight">Order {order.number}</h1>
        <p className="mt-1 text-muted">Placed {orderDate.format(new Date(order.placedAt))}. Quote this number if you contact us.</p>
        <div className="mt-6">
          <Alert tone={order.status === 'stock_issue' || order.status === 'cancelled' ? 'warning' : 'success'}>
            <strong>{status.label}.</strong> {note}
          </Alert>
        </div>
        {order.status === 'placed' || order.status === 'fulfilled' ? (
          <Card className="mt-6">
            <h2 className="font-semibold">Delivery</h2>
            <ol className="mt-4 grid grid-cols-4 gap-2 text-center text-xs sm:text-sm" aria-label="Progress">
              {STAGES.map((name, index) => (
                <li key={name} aria-current={index === stage ? 'step' : undefined}>
                  <span className={`block h-1.5 rounded-full ${index <= stage ? 'bg-primary' : 'bg-border'}`} />
                  <span className={`mt-2 block ${index <= stage ? 'font-medium' : 'text-muted'}`}>{name}</span>
                </li>
              ))}
            </ol>
            {latest && latest.status !== 'cancelled' ? (
              <div className="mt-6 text-sm">
                <p>
                  With <strong>{latest.courier}</strong>
                  {latest.trackingReference ? (
                    <>
                      , tracking number <span className="font-mono">{latest.trackingReference}</span>
                    </>
                  ) : null}
                  .
                </p>
                <ol className="mt-3 space-y-2 border-l-2 border-border pl-4">
                  {latest.history
                    .filter((change) => change.status !== 'created')
                    .slice()
                    .reverse()
                    .map((change, index) => (
                      <li key={index}>
                        <span className="block">{SHIPMENT_STEP[change.status] ?? change.status}</span>
                        <span className="text-muted">{stepTime.format(new Date(change.at))}</span>
                      </li>
                    ))}
                </ol>
              </div>
            ) : (
              <p className="mt-4 text-sm text-muted">We will show the courier and tracking number here once your order is on its way.</p>
            )}
          </Card>
        ) : null}
        <Card className="mt-6">
          <ul className="divide-y divide-border">
            {order.sellerOrders.flatMap((seller) =>
              seller.lines.map((line) => (
                <li key={line.listingId} className="flex justify-between gap-4 py-3 text-sm">
                  <span>
                    {line.quantity} × {line.productName}
                    {Object.keys(line.options).length > 0 ? <span className="block text-muted">{Object.values(line.options).join(', ')}</span> : null}
                  </span>
                  <span className="tabular-nums">{money(line.lineTotal)}</span>
                </li>
              )),
            )}
          </ul>
          <dl className="mt-4 space-y-1 border-t border-border pt-4 text-sm">
            <div className="flex justify-between">
              <dt className="text-muted">Items</dt>
              <dd className="tabular-nums">{money(order.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt className="text-muted">Delivery</dt>
              <dd className="tabular-nums">{money(order.delivery)}</dd>
            </div>
            <div className="flex justify-between font-semibold">
              <dt>Paid</dt>
              <dd className="tabular-nums">{money(order.total)}</dd>
            </div>
          </dl>
        </Card>
        <Card className="mt-6 text-sm">
          <h2 className="font-semibold">Delivering to</h2>
          <address className="mt-2 not-italic leading-6">
            {order.address.recipient}, {order.address.phone}
            <br />
            {order.address.line1}
            {order.address.line2 ? `, ${order.address.line2}` : ''}
            <br />
            {order.address.city}, {order.address.state}
          </address>
        </Card>
      </main>
    </>
  );
}
