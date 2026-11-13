import { Badge, EmptyState, PageHeader, Table, Td } from '@vendra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { session } from '../../../lib/session';
import { dateTime, SHIPMENT_LABEL, SHIPMENT_TONE, type ShipmentStatus } from '../orders/labels';

export const metadata: Metadata = { title: 'Deliveries' };

/** The statuses of a shipment still on its way, in the order they happen. */
const OPEN: readonly ShipmentStatus[] = ['allocated', 'picked_up', 'in_transit', 'out_for_delivery', 'delivery_failed', 'returning'];

export default async function ShipmentsPage({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const params = await searchParams;
  const status = OPEN.includes(params.status as ShipmentStatus) ? (params.status as ShipmentStatus) : undefined;
  const shipments = await session.read((api) => api.GET('/v1/admin/shipments', { params: { query: { status } } }));

  return (
    <>
      <PageHeader title="Deliveries" description="Parcels with a courier and not yet delivered or back at Vendra. Longest without news first." />
      <nav aria-label="Filter by status" className="mb-4 flex flex-wrap gap-2 text-sm">
        {[undefined, ...OPEN].map((option) => (
          <Link
            key={option ?? 'all'}
            href={`/shipments${option ? `?status=${option}` : ''}`}
            aria-current={option === status ? 'page' : undefined}
            className={`rounded-full border px-3 py-1 ${option === status ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface'}`}
          >
            {option ? SHIPMENT_LABEL[option] : 'All on their way'}
          </Link>
        ))}
      </nav>
      {shipments.length === 0 ? (
        <EmptyState title="Nothing on its way">Orders waiting to be sent are under Orders → To send.</EmptyState>
      ) : (
        <Table caption="Deliveries" head={['Order', 'Deliver to', 'Courier', 'Status', 'Last update']}>
          {shipments.map((shipment) => {
            const last = shipment.history[shipment.history.length - 1];
            return (
              <tr key={shipment.id}>
                <Td className="font-mono">
                  <Link href={`/orders/${shipment.order.orderId}`} className="underline underline-offset-2">
                    {shipment.order.orderNumber}
                  </Link>
                </Td>
                <Td>
                  {shipment.order.recipient}, {shipment.order.city}
                  <a href={`tel:${shipment.order.phone}`} className="block text-xs text-muted underline underline-offset-2">
                    {shipment.order.phone}
                  </a>
                </Td>
                <Td>
                  {shipment.courier}
                  <span className="block font-mono text-xs text-muted">{shipment.trackingReference}</span>
                </Td>
                <Td>
                  <Badge tone={SHIPMENT_TONE[shipment.status as ShipmentStatus] ?? 'neutral'}>{SHIPMENT_LABEL[shipment.status as ShipmentStatus] ?? shipment.status}</Badge>
                </Td>
                <Td className="whitespace-nowrap text-muted">{last ? dateTime.format(new Date(last.at)) : ''}</Td>
              </tr>
            );
          })}
        </Table>
      )}
    </>
  );
}
