import { Alert, buttonVariants, Card } from '@vendra/ui';
import { formatMoney } from '@vendra/utils';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { SiteHeader } from '../../../../components/site-header';
import { session } from '../../../../lib/session';

export const metadata: Metadata = { title: 'Payment', robots: { index: false } };

/**
 * Customers land here from the gateway. Nothing in the address is trusted: the API asks the
 * gateway directly for the result before anything is confirmed.
 */
export default async function PaymentReturnPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ref?: string }> }) {
  const { id } = await params;
  const { ref } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id) || !ref || !/^[A-Za-z0-9]{6,40}$/.test(ref)) notFound();

  const verified = await session.find((api) => api.POST('/v1/store/payments/{reference}/verify', { params: { path: { reference: ref } } }));
  if (!verified || verified.checkoutId !== id) notFound();
  const checkout = await session.read((api) => api.GET('/v1/store/checkout/{id}', { params: { path: { id } } }));
  const total = formatMoney(checkout.total.amountMinor, checkout.total.currency);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto max-w-2xl px-4 py-10">
        {checkout.status === 'paid' ? (
          <>
            <h1 className="text-2xl font-bold tracking-tight">Thank you. Your payment is confirmed.</h1>
            {checkout.stockIssue ? (
              <div className="mt-4">
                <Alert tone="warning">
                  We received {total}, but an item sold out before your payment reached us. We will refund you in full, and our team will contact you on {checkout.address.phone}.
                </Alert>
              </div>
            ) : (
              <p className="mt-2 text-muted">We received {total}. We will deliver to {checkout.address.city}, {checkout.address.state}, and keep you updated.</p>
            )}
            <Card className="mt-6 text-sm">
              <ul className="space-y-1">
                {checkout.lines.map((line) => (
                  <li key={line.listingId}>
                    {line.quantity} × {line.productName}
                  </li>
                ))}
              </ul>
            </Card>
            <Link href="/products" className={buttonVariants({ className: 'mt-6' })}>
              Continue shopping
            </Link>
          </>
        ) : verified.status === 'succeeded' ? (
          <>
            <h1 className="text-2xl font-bold tracking-tight">Payment received. Finalising your order…</h1>
            <p className="mt-2 text-muted">This takes a moment. Please do not pay again.</p>
            <Link href={`/checkout/${id}/return?ref=${ref}`} className={buttonVariants({ className: 'mt-6' })}>
              Check again
            </Link>
          </>
        ) : verified.status === 'initiated' ? (
          <>
            <h1 className="text-2xl font-bold tracking-tight">We are confirming your payment</h1>
            <p className="mt-2 text-muted">This usually takes a few seconds. If you completed the payment, please do not pay again.</p>
            <Link href={`/checkout/${id}/return?ref=${ref}`} className={buttonVariants({ className: 'mt-6' })}>
              Check again
            </Link>
          </>
        ) : verified.status === 'requires_review' ? (
          <>
            <h1 className="text-2xl font-bold tracking-tight">We are checking your payment</h1>
            <p className="mt-2 text-muted">The amount received did not match the order. Our team will review it and contact you. Please do not pay again.</p>
          </>
        ) : (
          <>
            <h1 className="text-2xl font-bold tracking-tight">The payment did not go through</h1>
            <p className="mt-2 text-muted">No money was taken for this attempt. You can try again.</p>
            <Link href={`/checkout/${id}`} className={buttonVariants({ className: 'mt-6' })}>
              Try again
            </Link>
          </>
        )}
      </main>
    </>
  );
}
