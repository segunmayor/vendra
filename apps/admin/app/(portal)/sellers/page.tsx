import { Badge, EmptyState, PageHeader, Table, Td } from '@vendra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { session } from '../../../lib/session';
import { dateTime } from '../orders/labels';
import { SELLER_LABEL, SELLER_STATUSES, SELLER_TONE, type SellerStatus } from './labels';

export const metadata: Metadata = { title: 'Sellers' };

export default async function SellersPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const params = await searchParams;
  const status = SELLER_STATUSES.includes(params.status as SellerStatus) ? (params.status as SellerStatus) : undefined;
  const sellers = await session.read((api) => api.GET('/v1/admin/sellers', { params: { query: { status } } }));
  const filters = [{ key: 'all', label: 'All', href: '/sellers' }, ...SELLER_STATUSES.map((value) => ({ key: value, label: SELLER_LABEL[value], href: `/sellers?status=${value}` }))];
  const current = status ?? 'all';

  return (
    <>
      <PageHeader title="Sellers" description="Businesses applying to sell. Check their details against CAC records and their documents before approving." />
      <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2 text-sm">
        {filters.map((filter) => (
          <Link
            key={filter.key}
            href={filter.href}
            aria-current={filter.key === current ? 'page' : undefined}
            className={`rounded-full border px-3 py-1 ${filter.key === current ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface'}`}
          >
            {filter.label}
          </Link>
        ))}
      </nav>
      {sellers.length === 0 ? (
        <EmptyState title="No applications">{status ? 'None with this status.' : 'Applications appear here when businesses apply on the seller portal.'}</EmptyState>
      ) : (
        <Table caption="Seller applications" head={['Shop', 'Registered name', 'CAC number', 'Location', 'Status', status ? 'Waiting since' : 'Sent']}>
          {sellers.map((seller) => (
            <tr key={seller.id}>
              <Td>
                <Link href={`/sellers/${seller.id}`} className="font-medium underline underline-offset-2">
                  {seller.profile.displayName}
                </Link>
              </Td>
              <Td>{seller.profile.legalName}</Td>
              <Td className="font-mono">{seller.profile.registrationNumber}</Td>
              <Td>
                {seller.profile.address.city}, {seller.profile.address.state}
              </Td>
              <Td>
                <Badge tone={SELLER_TONE[seller.status]}>{SELLER_LABEL[seller.status]}</Badge>
              </Td>
              <Td className="whitespace-nowrap text-muted">{seller.submittedAt ? dateTime.format(new Date(seller.submittedAt)) : 'Not sent'}</Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
