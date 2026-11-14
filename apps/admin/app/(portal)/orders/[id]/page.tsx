import { Alert, Badge, Card, PageHeader, Table, Td } from '@vendra/ui';
import { formatMoney } from '@vendra/utils';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can, session } from '../../../../lib/session';
import { dateTime, orderBadge, SELLER_LABEL } from '../labels';
import { CancelOrder } from './cancel';
import { Delivery } from './delivery';

export const metadata: Metadata = { title: 'Order' };

export default async function OrderPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const order = await session.find((api) => api.GET('/v1/admin/orders/{id}', { params: { path: { id } } }));
  if (!order) notFound();
  const [seePayment, mayShip, shipments] = await Promise.all([
    can('payments.read'),
    can('shipments.manage'),
    session.read((api) => api.GET('/v1/admin/orders/{id}/shipments', { params: { path: { id } } })),
  ]);
  // Cancelled and stock issue orders are owed a refund: show how much is still to go back.
  const owed = order.status === 'cancelled' || order.status === 'stock_issue';
  const payment = owed && seePayment ? await session.find((api) => api.GET('/v1/admin/payments/{id}', { params: { path: { id: order.paymentId } } })) : null;
  const badge = orderBadge(order);
  const money = (value: { amountMinor: string; currency: string }) => formatMoney(value.amountMinor, value.currency);
  const options = (values: Record<string, string>) => Object.entries(values).map(([key, value]) => `${key}: ${value}`).join(', ');

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/orders" className="text-muted underline underline-offset-2">
          Orders
        </Link>
      </p>
      <PageHeader
        title={`Order ${order.number}`}
        description={`Placed ${dateTime.format(new Date(order.placedAt))}.`}
        actions={<Badge tone={badge.tone}>{badge.label}</Badge>}
      />
      {order.cancellation ? (
        <div className="mb-6">
          <Alert tone="warning">
            Cancelled {dateTime.format(new Date(order.cancellation.at))}: {order.cancellation.reason}
          </Alert>
        </div>
      ) : null}
      {payment && ['succeeded', 'partially_refunded', 'refunded'].includes(payment.status) ? (
        <div className="mb-6">
          {BigInt(payment.refundableMinor) > 0n ? (
            <Alert>
              {formatMoney(payment.refundableMinor, payment.currency)} of the payment has not been refunded.{' '}
              <Link href={`/payments/${order.paymentId}`} className="font-semibold underline underline-offset-2">
                Refund the customer
              </Link>
              {BigInt(payment.refundPendingMinor) > 0n ? ` (${formatMoney(payment.refundPendingMinor, payment.currency)} is already on its way).` : '.'}
            </Alert>
          ) : (
            <Alert tone="success">Refunded in full.</Alert>
          )}
        </div>
      ) : null}
      {order.status === 'stock_issue' ? (
        <div className="mb-6">
          <Alert>
            The customer paid, but an item sold out before the payment arrived. Refund them in full
            {seePayment ? (
              <>
                {' '}
                from the{' '}
                <Link href={`/payments/${order.paymentId}`} className="font-semibold underline underline-offset-2">
                  payment page
                </Link>
              </>
            ) : null}
            , call them on {order.address.phone}, then cancel the order to close it.
          </Alert>
        </div>
      ) : null}
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <div className="space-y-6">
          {order.sellerOrders.map((seller) => (
            <section key={seller.id} aria-label="Items">
              <p className="mb-2 text-sm text-muted">{SELLER_LABEL[seller.status] ?? seller.status}</p>
              <Table caption="Items" head={['Item', 'SKU', 'Quantity', 'Price', 'Total']}>
                {seller.lines.map((line) => (
                  <tr key={line.listingId}>
                    <Td>
                      {line.productName}
                      {Object.keys(line.options).length > 0 ? <p className="text-xs text-muted">{options(line.options)}</p> : null}
                    </Td>
                    <Td className="font-mono text-xs">{line.sku}</Td>
                    <Td className="tabular-nums">{line.quantity}</Td>
                    <Td className="tabular-nums">{money(line.unitPrice)}</Td>
                    <Td className="tabular-nums">{money(line.lineTotal)}</Td>
                  </tr>
                ))}
              </Table>
              <div className="mt-4">
                <Delivery
                  orderId={order.id}
                  orderStatus={order.status}
                  sellerOrder={seller}
                  shipments={shipments.filter((shipment) => shipment.sellerOrderId === seller.id)}
                  mayShip={mayShip}
                />
              </div>
            </section>
          ))}
          <Card className="p-6">
            <dl className="ml-auto max-w-xs space-y-1 text-sm">
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
        </div>
        <div className="space-y-6">
          {order.cannotCancelBecause === null ? <CancelOrder orderId={order.id} version={order.version} stockIssue={order.status === 'stock_issue'} /> : null}
          <Card className="p-6 text-sm">
            <h2 className="font-semibold">Deliver to</h2>
            <address className="mt-2 not-italic leading-6">
              {order.address.recipient}
              <br />
              {order.address.line1}
              {order.address.line2 ? (
                <>
                  <br />
                  {order.address.line2}
                </>
              ) : null}
              <br />
              {order.address.city}, {order.address.state}
              <br />
              <a href={`tel:${order.address.phone}`} className="underline underline-offset-2">
                {order.address.phone}
              </a>
            </address>
          </Card>
          <Card className="p-6 text-sm">
            <h2 className="font-semibold">Customer</h2>
            <p className="mt-2 break-all">{order.customerEmail ?? 'Account not found'}</p>
            {seePayment ? (
              <p className="mt-4">
                <Link href={`/payments/${order.paymentId}`} className="underline underline-offset-2">
                  View payment and refunds
                </Link>
              </p>
            ) : null}
          </Card>
        </div>
      </div>
    </>
  );
}
