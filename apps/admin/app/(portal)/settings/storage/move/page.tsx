import { ActionForm, Alert, Badge, Card, EmptyState, Field, PageHeader, Select, SubmitButton, Table, Td, type Tone } from '@vendra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { AutoRefresh } from '../../../../../lib/auto-refresh';
import { session } from '../../../../../lib/session';
import { startMove, stopMove } from '../actions';
import { dateTime, size } from '../shared';

export const metadata: Metadata = { title: 'Move files' };

const STATUS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: 'Waiting to start', tone: 'warning' },
  running: { label: 'Moving', tone: 'warning' },
  completed: { label: 'Finished', tone: 'success' },
  cancelled: { label: 'Stopped', tone: 'neutral' },
  failed: { label: 'Stopped: too many failures', tone: 'danger' },
};
const KIND: Record<string, string> = { 'product-media': 'Product photo', 'seller-documents': 'Seller document' };

export default async function MoveFilesPage() {
  const [summary, overview, moves] = await Promise.all([
    session.read((api) => api.GET('/v1/admin/storage/moves/summary')),
    session.read((api) => api.GET('/v1/admin/storage/locations')),
    session.read((api) => api.GET('/v1/admin/storage/moves', { params: { query: { limit: 10 } } })),
  ]);
  const active = overview.locations.find((location) => location.id === summary.activeId);
  const name = new Map(overview.locations.map((location) => [location.id, location.name]));
  const toMove = summary.database.files + summary.otherLocations.files;
  const running = summary.running;
  const done = running ? running.moved + running.skipped + running.failed : 0;
  const latest = moves[0];

  return (
    <>
      {running ? <AutoRefresh /> : null}
      <p className="mb-2 text-sm">
        <Link href="/settings/storage" className="text-muted underline underline-offset-2">
          File storage
        </Link>
      </p>
      <PageHeader
        title="Move files"
        description="Moves files already stored into the place new files go. Files keep working throughout: each one is copied, checked, and only then switched over."
      />

      {!active ? (
        <Alert tone="warning">
          New files are kept in this server’s database, so there is nowhere to move them to. <Link href="/settings/storage" className="underline">Make a storage location active</Link> first.
        </Alert>
      ) : (
        <Card className="mb-8">
          <h2 className="text-sm font-semibold text-muted uppercase">Moving into</h2>
          <div className="mt-1 text-lg font-semibold">{active.name}</div>
          <dl className="mt-4 grid gap-4 sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted">Still in this server’s database</dt>
              <dd className="text-2xl font-semibold tabular-nums">{summary.database.files}</dd>
              <dd className="text-sm text-muted">{size(summary.database.bytes)}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">In other storage locations</dt>
              <dd className="text-2xl font-semibold tabular-nums">{summary.otherLocations.files}</dd>
              <dd className="text-sm text-muted">{size(summary.otherLocations.bytes)}</dd>
            </div>
          </dl>

          {running ? (
            <div className="mt-6 border-t border-border pt-4">
              <div className="mb-2 flex flex-wrap items-center gap-3">
                <Badge tone={STATUS[running.status]?.tone ?? 'neutral'}>{STATUS[running.status]?.label ?? running.status}</Badge>
                <span className="text-sm text-muted">
                  {done} of {running.total} files · {running.moved} moved · {size(running.movedBytes)} · {running.concurrency} at a time
                  {running.failed ? ` · ${running.failed} could not be moved` : ''}
                </span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-background" role="progressbar" aria-valuemin={0} aria-valuemax={running.total} aria-valuenow={done}>
                <div className="h-full bg-primary transition-all" style={{ width: `${running.total ? Math.min(100, Math.round((done / running.total) * 100)) : 0}%` }} />
              </div>
              <p className="mt-2 text-xs text-muted">This page updates itself. You can leave it; the move carries on.</p>
              <ActionForm action={stopMove.bind(null, running.id)} className="mt-4">
                <SubmitButton size="sm" variant="outline" pendingLabel="Stopping…">
                  Stop after the current file
                </SubmitButton>
              </ActionForm>
            </div>
          ) : toMove === 0 ? (
            <p className="mt-6 border-t border-border pt-4 text-sm text-muted">Every file is already in {active.name}.</p>
          ) : (
            <ActionForm action={startMove} className="mt-6 space-y-4 border-t border-border pt-4">
              <Field
                label="Files at a time"
                hint="More is faster, but uses more of the server’s memory and connection while it runs. MEGA always takes one at a time."
                className="max-w-xs"
              >
                <Select name="concurrency" defaultValue="4">
                  {[1, 2, 3, 4, 5, 6, 8, 10].map((count) => (
                    <option key={count} value={count}>
                      {count === 1 ? '1 (gentlest)' : count === 10 ? '10 (fastest)' : count}
                    </option>
                  ))}
                </Select>
              </Field>
              <label className="flex items-start gap-3 text-sm">
                <input type="checkbox" name="deleteOld" defaultChecked className="mt-0.5 size-5" />
                <span>
                  <span className="font-medium">Delete the old copies in other storage locations once each file is moved</span>
                  <span className="mt-0.5 block text-xs text-muted">
                    Untick to keep them as a backup; they are no longer used either way. Files moved out of the database are always cleared from it.
                  </span>
                </span>
              </label>
              <SubmitButton pendingLabel="Starting…">
                Move {toMove} {toMove === 1 ? 'file' : 'files'} to {active.name}
              </SubmitButton>
            </ActionForm>
          )}
        </Card>
      )}

      {latest && latest.status !== 'queued' && latest.status !== 'running' && latest.message ? (
        <div className="mb-6 max-w-3xl">
          <Alert tone={latest.status === 'completed' && latest.failed === 0 ? 'success' : 'warning'}>{latest.message}</Alert>
        </div>
      ) : null}

      <h2 className="mb-3 text-lg font-semibold">Recent moves</h2>
      {moves.length === 0 ? (
        <EmptyState title="No moves yet">Files moved here appear with what happened to them.</EmptyState>
      ) : (
        <Table caption="Recent moves" head={['Started', 'Into', 'Status', 'Moved', 'Skipped', 'Could not move', 'Old copies']}>
          {moves.map((move) => (
            <tr key={move.id}>
              <Td className="whitespace-nowrap">{dateTime.format(new Date(move.createdAt))}</Td>
              <Td>{name.get(move.targetLocationId) ?? 'Removed location'}</Td>
              <Td>
                <Badge tone={STATUS[move.status]?.tone ?? 'neutral'}>{STATUS[move.status]?.label ?? move.status}</Badge>
              </Td>
              <Td className="tabular-nums">
                {move.moved} of {move.total}
                <div className="text-xs text-muted">{size(move.movedBytes)}</div>
              </Td>
              <Td className="tabular-nums">{move.skipped}</Td>
              <Td>
                {move.failed}
                {move.problems.length ? (
                  <details className="mt-1">
                    <summary className="cursor-pointer text-xs text-primary">Why</summary>
                    <ul className="mt-1 space-y-1 text-xs text-[#9b1c1c]">
                      {move.problems.map((problem, index) => (
                        <li key={index}>
                          {KIND[problem.purpose] ?? problem.purpose} {problem.rowId.slice(0, 8)}: {problem.message}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </Td>
              <Td className="text-sm">
                {move.deleteOld ? 'Deleted' : 'Kept'}
                <div className="text-xs text-muted">{move.concurrency} at a time</div>
              </Td>
            </tr>
          ))}
        </Table>
      )}
    </>
  );
}
