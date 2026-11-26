import { ActionForm, Alert, Badge, Card, PageHeader, SubmitButton } from '@vendra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { session } from '../../../../../lib/session';
import { activateLocation, removeLocation, testLocation, updateLocation } from '../actions';
import { dateTime, LocationFields, size } from '../shared';

export const metadata: Metadata = { title: 'Storage location' };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function LocationPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<Record<string, string | undefined>> }) {
  const { id } = await params;
  const { added, activated } = await searchParams;
  if (!UUID.test(id)) notFound();
  const [location, types] = await Promise.all([
    session.find((api) => api.GET('/v1/admin/storage/locations/{id}', { params: { path: { id } } })),
    session.read((api) => api.GET('/v1/admin/storage/types')),
  ]);
  const type = location && types.find((entry) => entry.type === location.type);
  if (!location || !type) notFound();
  const files = location.usage?.files ?? 0;

  return (
    <>
      <p className="mb-2 text-sm">
        <Link href="/settings/storage" className="text-muted underline underline-offset-2">
          File storage
        </Link>
      </p>
      <PageHeader
        title={location.name}
        description={
          <>
            {type.label} {location.active ? <Badge tone="success">New files go here</Badge> : <Badge>Not used for new files</Badge>}
          </>
        }
      />
      {activated && location.active ? (
        <div className="mb-6 max-w-3xl">
          <Alert tone="success">It passed its check. New files now go here; files already stored stay where they are and keep working.</Alert>
        </div>
      ) : null}
      {added ? (
        <div className="mb-6 max-w-3xl">
          <Alert tone="success">Saved. Next, test the connection, then make it the place new files go.</Alert>
        </div>
      ) : null}

      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_22rem]">
        <Card>
          {location.config.publicDelivery === 'true' ? (
            <div className="mb-4">
              {location.lastCheck?.ok ? (
                <Alert tone="success">
                  Shoppers load product photos kept here from <span className="font-medium break-all">{location.config.publicBaseUrl}</span>. Seller documents still go through Vendra.
                </Alert>
              ) : (
                <Alert tone="warning">
                  The last check failed, so product photos kept here are served through Vendra until a check passes. Fix the public address or the CDN, then test again.
                </Alert>
              )}
            </div>
          ) : null}
          {location.active || location.config.publicDelivery === 'true' ? (
            <p className="mb-4 text-sm text-muted">
              {location.active ? 'New files are going here now' : 'Photos are served from its public address'}, so changed settings are tested before they are saved. If the test fails,
              nothing changes.
            </p>
          ) : null}
          <ActionForm action={updateLocation.bind(null, location.id)} className="space-y-5">
            <LocationFields type={type} location={location} />
            <SubmitButton pendingLabel={location.active ? 'Testing and saving…' : 'Saving…'}>Save settings</SubmitButton>
          </ActionForm>
        </Card>

        <div className="space-y-4">
          <Card>
            <h2 className="font-semibold">Check the connection</h2>
            <p className="mt-1 mb-3 text-sm text-muted">
              Writes a small test file with the saved settings, reads it back and deletes it.
              {location.config.publicDelivery === 'true' ? ' Also checks that a test photo opens at the public address and a test seller document does not.' : ''}
            </p>
            {location.lastCheck ? (
              <div className="mb-3 text-sm">
                <Badge tone={location.lastCheck.ok ? 'success' : 'danger'}>{location.lastCheck.ok ? 'Working' : 'Failed'}</Badge>{' '}
                <span className="text-muted">{dateTime.format(new Date(location.lastCheck.at))}</span>
                {location.lastCheck.message ? <p className="mt-2 text-[#9b1c1c]">{location.lastCheck.message}</p> : null}
              </div>
            ) : null}
            <ActionForm action={testLocation.bind(null, location.id)}>
              <SubmitButton variant="outline" pendingLabel="Checking…">
                Test connection
              </SubmitButton>
            </ActionForm>
          </Card>

          {!location.active ? (
            <Card>
              <h2 className="font-semibold">Use for new files</h2>
              <p className="mt-1 mb-3 text-sm text-muted">Runs the check first. New uploads then go here; files already stored stay where they are and keep working.</p>
              <ActionForm action={activateLocation.bind(null, location.id)}>
                <SubmitButton pendingLabel="Checking…">Make active</SubmitButton>
              </ActionForm>
            </Card>
          ) : null}

          <Card>
            <h2 className="font-semibold">Files stored here</h2>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{files}</p>
            <p className="text-sm text-muted">{size(location.usage?.bytes ?? 0)}</p>
            {!location.active && files === 0 ? (
              <ActionForm action={removeLocation.bind(null, location.id)} className="mt-4">
                <SubmitButton variant="outline" size="sm" pendingLabel="Removing…">
                  Remove location
                </SubmitButton>
              </ActionForm>
            ) : (
              <p className="mt-3 text-xs text-muted">
                {files > 0 ? (
                  <>
                    Files are read from here, so it cannot be removed yet. Make another location active, then{' '}
                    <Link href="/settings/storage/move" className="underline">
                      move the files
                    </Link>{' '}
                    there.
                  </>
                ) : (
                  'Make another location active before removing this one.'
                )}
              </p>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}
