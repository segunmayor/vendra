import { Badge, EmptyState, PageHeader, Table, Td, type Tone } from '@vendra/ui';
import { formatMoney } from '@vendra/utils';
import type { Metadata } from 'next';
import Link from 'next/link';
import { session } from '../../../lib/session';

export const metadata: Metadata = { title: 'Payments' };

const STATUSES = ['initiated', 'succeeded', 'failed', 'requires_review', 'partially_refunded', 'refunded'] as const;
type Status = (typeof STATUSES)[number];
const TONE: Record<Status, Tone> = { initiated: 'neutral', succeeded: 'success', failed: 'neutral', requires_review: 'danger', partially_refunded: 'warning', refunded: 'warning' };
const LABEL: Record<Status, string> = {
  initiated: 'Waiting for customer',
  succeeded: 'Paid',
  failed: 'Failed',
  requires_review: 'Needs review',
  partially_refunded: 'Part refunded',
  refunded: 'Refunded',
};
const time = new Intl.DateTimeFormat('en-NG', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Africa/Lagos' });

export default async function PaymentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { status: raw } = await searchParams;
  const status = STATUSES.includes(raw as Status) ? (raw as Status) : undefined;
  const payments = await session.read((api) => api.GET('/v1/admin/payments', { params: { query: { status } } }));
  return (
    <>
      <PageHeader title="Payments" description="Latest 100. A payment needs review when the gateway reports a different amount than expected." />
      <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2 text-sm">
        {[undefined, ...STATUSES].map((option) => (
          <Link
            key={option ?? 'all'}
            href={`/payments${option ? `?status=${option}` : ''}`}
            aria-current={option === status ? 'page' : undefined}
            className={`rounded-full border px-3 py-1 ${option === status ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface'}`}
          >
            {option ? LABEL[option] : 'All'}
          </Link>
        ))}
      </nav>
      {payments.length === 0 ? (
        <EmptyState title="No payments">Payments appear here as customers pay.</EmptyState>
      ) : (
        <Table caption="Payments" head={['Reference', 'Amount', 'Gateway', 'Status', 'Started']}>
          {payments.map((payment) => (
            <tr key={payment.id}>
              <Td className="font-mono text-xs">
                <Link href={`/payments/${payment.id}`} className="underline underline-offset-2">
                  {payment.reference}
                </Link>
              </Td>
              <Td className="tabular-nums">{formatMoney(payment.amountMinor, payment.currency)}</Td>
              <Td className="capitalize">{payment.provider}</Td>
              <Td>
                <Badge tone={TONE[payment.status as Status] ?? 'neutral'}>{LABEL[payment.status as Status] ?? payment.status}</Badge>
              </Td>
              <Td className="whitespace-nowrap text-muted">{time.format(new Date(payment.createdAt))}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
