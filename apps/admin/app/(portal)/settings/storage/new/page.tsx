import { ActionForm, Card, PageHeader, SubmitButton } from '@vendra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { session } from '../../../../../lib/session';
import { createLocation } from '../actions';
import { LocationFields } from '../shared';

export const metadata: Metadata = { title: 'Add storage' };

export default async function NewLocationPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { type: chosen } = await searchParams;
  const types = await session.read((api) => api.GET('/v1/admin/storage/types'));
  const type = types.find((entry) => entry.type === chosen);
  if (!type) notFound();

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/settings/storage" className="text-muted underline underline-offset-2">
          File storage
        </Link>
      </p>
      <PageHeader title={`Add ${type.label}`} description={type.description} />
      <Card className="max-w-2xl">
        <ActionForm action={createLocation.bind(null, type.type)} className="space-y-5">
          <LocationFields type={type} />
          <SubmitButton pendingLabel="Saving…">Save location</SubmitButton>
        </ActionForm>
      </Card>
    </>
  );
}
