import { Card, PageHeader } from '@vendra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { session } from '../../../../../lib/session';
import { updateZone } from '../actions';
import { ZoneForm } from '../zone-form';

export const metadata: Metadata = { title: 'Delivery zone' };

export default async function ZonePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const zones = await session.read((api) => api.GET('/v1/admin/delivery-zones'));
  const zone = zones.find((entry) => entry.id === id);
  if (!zone) notFound();
  const taken = new Map(zones.filter((entry) => entry.id !== id).flatMap((entry) => entry.states.map((state) => [state, entry.name] as const)));
  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/settings/delivery" className="text-muted underline underline-offset-2">
          Delivery prices
        </Link>
      </p>
      <PageHeader title={zone.name} />
      <Card>
        <ZoneForm action={updateZone.bind(null, zone.id)} zone={zone} taken={taken} submit="Save zone" />
      </Card>
    </>
  );
}
