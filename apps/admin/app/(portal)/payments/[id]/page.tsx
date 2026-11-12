import { ActionForm, Alert, Badge, Card, Field, Input, PageHeader, Select, SubmitButton, Table, Td, Textarea, type Tone } from '@vendra/ui';
import { formatMoney } from '@vendra/utils';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { can, session } from '../../../../lib/session';
import { checkRefund, requestRefund, resolveRefund } from '../actions';

export const metadata: Metadata = { title: 'Payment' };

const PAYMENT_LABEL: Record<string, string> = {
  initiated: 'Waiting for customer',
  succeeded: 'Paid',
  failed: 'Failed',
  requires_review: 'Needs review',
  partially_refunded: 'Part refunded',
  refunded: 'Refunded',
};
const REFUND: Record<string, { label: string; tone: Tone }> = {
  pending: { label: 'Sending', tone: 'neutral' },
  submitted: { label: 'Processing', tone: 'warning' },
  succeeded: { label: 'Refunded', tone: 'success' },
  failed: { label: 'Did not go through', tone: 'neutral' },
  unknown: { label: 'Check dashboard', tone: 'danger' },
};
const time = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' });

export default async function PaymentPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const payment = await session.find((api) => api.GET('/v1/admin/payments/{id}', { params: { path: { id } } }));
  if (!payment) notFound();
  const mayRefund = await can('orders.refund');
  const money = (minor: string) => formatMoney(minor, payment.currency);
  const refundable = payment.refundableMinor !== '0' && (payment.status === 'succeeded' || payment.status === 'partially_refunded');

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/payments" className="text-muted underline underline-offset-2">
          Payments
        </Link>
      </p>
      <PageHeader title={`Payment ${payment.reference}`} description={`Through ${payment.provider}. Gateway transaction ${payment.providerTransactionId ?? 'not yet created'}.`} />
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_24rem]">
        <div className="space-y-6">
          <Card className="p-6">
            <dl className="grid grid-cols-2 gap-4 text-sm sm:grid-cols-4">
              <div>
                <dt className="text-muted">Status</dt>
                <dd className="mt-1 font-medium">{PAYMENT_LABEL[payment.status] ?? payment.status}</dd>
              </div>
              <div>
                <dt className="text-muted">Paid</dt>
                <dd className="mt-1 font-medium tabular-nums">{money(payment.amountMinor)}</dd>
              </div>
              <div>
                <dt className="text-muted">Refunded</dt>
                <dd className="mt-1 font-medium tabular-nums">{money(payment.refundedMinor)}</dd>
              </div>
              <div>
                <dt className="text-muted">Being refunded</dt>
                <dd className="mt-1 font-medium tabular-nums">{money(payment.refundPendingMinor)}</dd>
              </div>
            </dl>
          </Card>

          <section aria-labelledby="refunds">
            <h2 id="refunds" className="mb-3 text-lg font-semibold">
              Refunds
            </h2>
            {payment.refunds.length === 0 ? (
              <p className="text-sm text-muted">No refunds yet.</p>
            ) : (
              <Table caption="Refunds" head={['Amount', 'Status', 'Reason', 'Requested', '']}>
                {payment.refunds.map((refund) => (
                  <tr key={refund.id}>
                    <Td className="tabular-nums">{money(refund.amountMinor)}</Td>
                    <Td>
                      <Badge tone={REFUND[refund.status]?.tone ?? 'neutral'}>{REFUND[refund.status]?.label ?? refund.status}</Badge>
                      {refund.gatewayStatus ? <p className="mt-1 text-xs text-muted">{refund.gatewayStatus}</p> : null}
                      {refund.failureReason && refund.status !== 'succeeded' ? <p className="mt-1 text-xs text-muted">{refund.failureReason}</p> : null}
                    </Td>
                    <Td className="max-w-xs">{refund.reason}</Td>
                    <Td className="whitespace-nowrap text-muted">{time.format(new Date(refund.createdAt))}</Td>
                    <Td>
                      {mayRefund && refund.status === 'submitted' ? (
                        <ActionForm action={checkRefund.bind(null, payment.id, refund.id)}>
                          <SubmitButton variant="outline" size="sm" pendingLabel="Asking…">
                            Check status
                          </SubmitButton>
                        </ActionForm>
                      ) : null}
                      {mayRefund && (refund.status === 'unknown' || refund.status === 'pending') ? (
                        <ActionForm action={resolveRefund.bind(null, payment.id, refund.id)} className="w-64 space-y-2">
                          <Select name="outcome" aria-label="What the gateway dashboard shows" defaultValue="failed">
                            <option value="failed">Not refunded</option>
                            <option value="succeeded">Refunded</option>
                          </Select>
                          <Input name="note" aria-label="What you saw" placeholder="What the dashboard shows" required minLength={3} maxLength={300} />
                          <SubmitButton variant="outline" size="sm">
                            Record
                          </SubmitButton>
                        </ActionForm>
                      ) : null}
                    </Td>
                  </tr>
                ))}
              </Table>
            )}
          </section>
        </div>

        {mayRefund ? (
          <Card className="h-fit p-6">
            <h2 className="text-lg font-semibold">Refund</h2>
            {refundable ? (
              <ActionForm action={requestRefund.bind(null, payment.id)} className="mt-4 space-y-4">
                <Field label="Amount in naira" hint={`Up to ${money(payment.refundableMinor)}.`}>
                  <Input name="amount" inputMode="decimal" defaultValue={formatMoney(payment.refundableMinor, payment.currency).replace(/^₦/, '')} required />
                </Field>
                <Field label="Reason" hint="Kept with the refund and sent to the gateway.">
                  <Textarea name="reason" rows={3} minLength={3} maxLength={500} required />
                </Field>
                <SubmitButton pendingLabel="Sending to gateway…">Refund through {payment.provider}</SubmitButton>
              </ActionForm>
            ) : (
              <div className="mt-4">
                <Alert tone="warning">
                  {payment.status === 'requires_review'
                    ? 'This payment needs review first: the gateway reported a different amount. Refund it from the gateway dashboard.'
                    : payment.refundableMinor === '0' && payment.status !== 'initiated' && payment.status !== 'failed'
                      ? 'Nothing is left to refund.'
                      : 'Only a successful payment can be refunded.'}
                </Alert>
              </div>
            )}
          </Card>
        ) : null}
      </div>
    </>
  );
}
