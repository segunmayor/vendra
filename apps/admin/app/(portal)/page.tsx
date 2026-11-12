import { Card, PageHeader } from '@vendra/ui';
import Link from 'next/link';
import { can, session } from '../../lib/session';

function Tile({ href, count, label, note, urgent }: { href: string; count: number; label: string; note: string; urgent?: boolean }) {
  return (
    <Link href={href} className={`block rounded-lg border p-5 hover:bg-background ${urgent && count > 0 ? 'border-[#efc4c4] bg-[#fbe9e9]' : 'border-border bg-surface'}`}>
      <p className={`text-3xl font-bold tabular-nums ${urgent && count > 0 ? 'text-[#9b1c1c]' : ''}`}>{count}</p>
      <p className="mt-1 font-medium">{label}</p>
      <p className="mt-1 text-sm text-muted">{note}</p>
    </Link>
  );
}

export default async function DashboardPage() {
  const [catalogue, orders, payments] = await Promise.all([can('catalogue.manage'), can('orders.manage'), can('payments.read')]);
  const [counts, review] = await Promise.all([
    orders ? session.read((api) => api.GET('/v1/admin/orders/counts')) : null,
    payments ? session.read((api) => api.GET('/v1/admin/payments', { params: { query: { status: 'requires_review' } } })) : null,
  ]);

  return (
    <>
      <PageHeader title="Dashboard" />
      {counts || review ? (
        <section aria-labelledby="attention" className="mb-8">
          <h2 id="attention" className="mb-3 text-lg font-semibold">
            Needs attention
          </h2>
          <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {counts ? <Tile href="/orders?status=placed" count={counts.byStatus.placed ?? 0} label="Orders to send" note="Paid and waiting to be packed." /> : null}
            {counts ? (
              <Tile href="/orders?status=stock_issue" count={counts.byStatus.stock_issue ?? 0} label="Orders with a stock issue" note="Paid, but an item sold out. Refund and call the customer." urgent />
            ) : null}
            {review ? (
              <Tile href="/payments?status=requires_review" count={review.length} label="Payments to review" note="The gateway reported a different amount. No order was placed." urgent />
            ) : null}
          </div>
        </section>
      ) : null}
      {catalogue ? (
        <Card className="mb-6">
          <h2 className="font-semibold">Prepare the launch catalogue</h2>
          <ol className="mt-2 list-decimal space-y-1 pl-5 text-sm text-muted">
            <li>Create categories and the attributes each one needs.</li>
            <li>Add products with at least one variant (SKU and weight).</li>
            <li>Publish each product, set its price and activate the listing.</li>
            <li>Record opening stock in a warehouse.</li>
          </ol>
          <Link href="/catalogue/products" className="mt-3 inline-block text-sm font-semibold text-primary underline underline-offset-2">
            Go to products
          </Link>
        </Card>
      ) : null}
    </>
  );
}
