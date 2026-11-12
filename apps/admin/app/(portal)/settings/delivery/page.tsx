import { Card, EmptyState, PageHeader, Table, Td } from '@vendra/ui';
import { formatMoney } from '@vendra/utils';
import type { Metadata } from 'next';
import Link from 'next/link';
import { STATES } from '../../../../lib/delivery';
import { session } from '../../../../lib/session';
import { createZone } from './actions';
import { ZoneForm } from './zone-form';

export const metadata: Metadata = { title: 'Delivery prices' };

export default async function DeliveryPage() {
  const zones = await session.read((api) => api.GET('/v1/admin/delivery-zones'));
  const taken = new Map(zones.flatMap((zone) => zone.states.map((state) => [state, zone.name] as const)));
  const uncovered = STATES.filter((state) => !taken.has(state));
  return (
    <>
      <PageHeader title="Delivery prices" description="Checkout charges these fees. Customers in a state with no zone cannot check out." />
      {zones.length === 0 ? (
        <EmptyState title="No delivery zones yet">Nobody can check out until at least one zone exists.</EmptyState>
      ) : (
        <Table caption="Delivery zones" head={['Zone', 'States', 'Prices']}>
          {zones.map((zone) => (
            <tr key={zone.id}>
              <Td>
                <Link href={`/settings/delivery/${zone.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                  {zone.name}
                </Link>
              </Td>
              <Td>{zone.states.join(', ')}</Td>
              <Td className="whitespace-nowrap">
                {zone.rates.map((rate) => (
                  <div key={rate.maxWeightGrams}>
                    Up to {rate.maxWeightGrams / 1000} kg: {formatMoney(rate.priceMinor, 'NGN')}
                  </div>
                ))}
              </Td>
            </tr>
          ))}
        </Table>
      )}
      <p className="mt-3 text-sm text-muted">{uncovered.length === 0 ? 'Every state is covered.' : `Not delivered to: ${uncovered.join(', ')}.`}</p>
      <Card className="mt-8">
        <h2 className="mb-4 text-lg font-semibold">New zone</h2>
        <ZoneForm action={createZone} taken={taken} submit="Create zone" />
      </Card>
    </>
  );
}
