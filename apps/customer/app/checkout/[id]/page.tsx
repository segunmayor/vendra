import { ActionForm, Alert, Card, SubmitButton } from '@vendra/ui';
import { formatMoney } from '@vendra/utils';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '../../../components/site-header';
import { session } from '../../../lib/session';
import { cancelCheckout } from '../actions';

export const metadata: Metadata = { title: 'Your order · Vendra', robots: { index: false } };

const time = new Intl.DateTimeFormat('en-NG', { timeStyle: 'short', timeZone: 'Africa/Lagos' });

export default async function CheckoutSessionPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const checkout = await session.find((api) => api.GET('/v1/store/checkout/{id}', { params: { path: { id } } }));
  if (!checkout) notFound();
  const money = (value: { amountMinor: string; currency: string }) => formatMoney(value.amountMinor, value.currency);
  const open = checkout.status === 'awaiting_payment';

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-3xl px-4 py-8">
        <h1 className="text-2xl font-bold tracking-tight">{open ? 'Review and pay' : 'Checkout'}</h1>

        <div className="mt-4">
          {open ? (
            <Alert tone="success">Your items are held for you until {time.format(new Date(checkout.expiresAt))}.</Alert>
          ) : checkout.status === 'expired' ? (
            <Alert tone="warning">The 15-minute hold has ended and the items are back on sale. Your basket is unchanged, so you can check out again.</Alert>
          ) : checkout.status === 'cancelled' ? (
            <Alert tone="warning">This checkout was cancelled. Your basket is unchanged.</Alert>
          ) : null}
        </div>

        <Card className="mt-6">
          <ul className="divide-y divide-border text-sm">
            {checkout.lines.map((line) => (
              <li key={line.listingId} className="flex justify-between gap-4 py-2">
                <span>
                  {line.quantity} × {line.productName}
                  {Object.values(line.options).length ? <span className="text-muted"> · {Object.values(line.options).join(' · ')}</span> : null}
                </span>
                <span className="tabular-nums">{money(line.lineTotal)}</span>
              </li>
            ))}
          </ul>
          <dl className="mt-3 space-y-1 border-t border-border pt-3 text-sm">
            <div className="flex justify-between">
              <dt>Items</dt>
              <dd className="tabular-nums">{money(checkout.subtotal)}</dd>
            </div>
            <div className="flex justify-between">
              <dt>Delivery to {checkout.address.state}</dt>
              <dd className="tabular-nums">{money(checkout.delivery)}</dd>
            </div>
            <div className="flex justify-between text-base font-bold">
              <dt>Total to pay</dt>
              <dd className="tabular-nums">{money(checkout.total)}</dd>
            </div>
          </dl>
        </Card>

        <Card className="mt-4 text-sm">
          <h2 className="font-semibold">Delivering to</h2>
          <p className="mt-1">
            {checkout.address.recipient}, {checkout.address.phone}
            <br />
            {checkout.address.line1}
            {checkout.address.line2 ? `, ${checkout.address.line2}` : ''}
            <br />
            {checkout.address.city}, {checkout.address.state}
          </p>
        </Card>

        {open ? (
          <div className="mt-6 space-y-3">
            {/* Step 6 connects the payment provider here. */}
            <p className="rounded-brand border border-border bg-surface px-4 py-3 text-sm">Online payment is being connected. Your order will not be placed until payment is confirmed.</p>
            <ActionForm action={cancelCheckout.bind(null, checkout.id)}>
              <SubmitButton variant="outline" pendingLabel="Cancelling…">
                Cancel and release items
              </SubmitButton>
            </ActionForm>
          </div>
        ) : (
          <Link href="/cart" className="mt-6 inline-block font-semibold text-primary underline">
            Back to basket
          </Link>
        )}
      </main>
    </>
  );
}
