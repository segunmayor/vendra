import { Card, EmptyState, PageHeader } from '@vendra/ui';
import Link from 'next/link';
import { can } from '../../lib/session';

export default async function DashboardPage() {
  const catalogue = await can('catalogue.manage');
  return (
    <>
      <PageHeader title="Dashboard" />
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
      <EmptyState title="No activity yet">Business metrics will appear here once orders are being placed.</EmptyState>
    </>
  );
}
