import { ActionForm, Alert, Badge, Card, PageHeader, SubmitButton, Table, Td } from '@vendra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { session } from '../../../../lib/session';
import { keepFilesInDatabase } from './actions';
import { dateTime, size } from './shared';

export const metadata: Metadata = { title: 'File storage' };

export default async function StoragePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const { database } = await searchParams;
  const [overview, types] = await Promise.all([
    session.read((api) => api.GET('/v1/admin/storage/locations')),
    session.read((api) => api.GET('/v1/admin/storage/types')),
  ]);
  const label = new Map(types.map((type) => [type.type, type.label]));
  const active = overview.locations.find((location) => location.id === overview.activeId);

  return (
    <>
      <PageHeader
        title="File storage"
        description="Where uploaded files are kept: product photos and seller documents. Files are always served through Vendra, so buckets and containers stay private."
      />

      {database && !active ? (
        <div className="mb-4 max-w-3xl">
          <Alert tone="success">New files are kept in the database again. Files in storage services stay there and keep working.</Alert>
        </div>
      ) : null}
      <Card className="mb-6">
        <h2 className="text-sm font-semibold text-muted uppercase">New files go to</h2>
        {active ? (
          <div className="mt-2">
            <div className="text-lg font-semibold">
              {active.name} <span className="font-normal text-muted">· {label.get(active.type) ?? active.type}</span>
            </div>
            <p className="mt-1 text-sm text-muted">Files stored earlier stay where they were saved and keep working.</p>
          </div>
        ) : (
          <div className="mt-2">
            <div className="text-lg font-semibold">This server’s database</div>
            <p className="mt-1 text-sm text-muted">Fine to start with. As the catalogue grows, choose a storage service below so files do not fill the database and its backups.</p>
          </div>
        )}
      </Card>

      <div className="mb-6 flex flex-wrap items-center justify-between gap-3 rounded-brand border border-border bg-surface px-5 py-4">
        <div className="text-sm">
          <span className="font-semibold">Files stored before a change stay where they were.</span>{' '}
          <span className="text-muted">Move them into the active location in one go, checked file by file.</span>
        </div>
        <Link href="/settings/storage/move" className="text-sm font-medium text-primary underline underline-offset-2">
          Move existing files
        </Link>
      </div>

      <Table caption="Storage locations" head={['Location', 'Service', 'Status', 'Last check', 'Files stored', '']}>
        <tr>
          <Td>
            <span className="font-medium">This server’s database</span>
            <div className="text-xs text-muted">Built in</div>
          </Td>
          <Td>Database</Td>
          <Td>{active ? <Badge>Not used for new files</Badge> : <Badge tone="success">New files go here</Badge>}</Td>
          <Td className="text-muted">—</Td>
          <Td className="text-muted">Files saved before a service was chosen</Td>
          <Td>
            {active ? (
              <ActionForm action={keepFilesInDatabase}>
                <SubmitButton size="sm" variant="outline" pendingLabel="Switching…">
                  Use for new files
                </SubmitButton>
              </ActionForm>
            ) : null}
          </Td>
        </tr>
        {overview.locations.map((location) => (
          <tr key={location.id}>
            <Td>
              <Link href={`/settings/storage/${location.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                {location.name}
              </Link>
            </Td>
            <Td>{label.get(location.type) ?? location.type}</Td>
            <Td>{location.active ? <Badge tone="success">New files go here</Badge> : <Badge>Not used for new files</Badge>}</Td>
            <Td>
              {location.lastCheck ? (
                <>
                  <Badge tone={location.lastCheck.ok ? 'success' : 'danger'}>{location.lastCheck.ok ? 'Working' : 'Failed'}</Badge>
                  <div className="text-xs text-muted">{dateTime.format(new Date(location.lastCheck.at))}</div>
                </>
              ) : (
                <span className="text-muted">Not tested</span>
              )}
            </Td>
            <Td className="tabular-nums">{location.usage ? `${location.usage.files} · ${size(location.usage.bytes)}` : '—'}</Td>
            <Td>
              <Link href={`/settings/storage/${location.id}`} className="text-sm underline">
                Manage
              </Link>
            </Td>
          </tr>
        ))}
      </Table>

      <h2 className="mt-10 mb-1 text-lg font-semibold">Add a storage location</h2>
      <p className="mb-4 text-sm text-muted">Adding one does not change anything yet. Test it, then make it the place new files go.</p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {types.map((type) => (
          <Link
            key={type.type}
            href={`/settings/storage/new?type=${type.type}`}
            className="block rounded-brand border border-border bg-surface p-4 transition-colors hover:border-primary focus-visible:outline-2 focus-visible:outline-primary"
          >
            <div className="font-semibold">{type.label}</div>
            <p className="mt-1 text-sm text-muted">{type.description}</p>
          </Link>
        ))}
      </div>
      {types.some((type) => type.type === 'mega') ? (
        <div className="mt-6 max-w-3xl">
          <Alert tone="warning">
            MEGA is a personal cloud drive, not built for serving a shop’s files. It limits daily downloads, so photos can stop loading on a busy day. Prefer an object storage service for product photos.
          </Alert>
        </div>
      ) : null}
    </>
  );
}
