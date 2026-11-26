import { ActionForm, Alert, Badge, buttonVariants, Card, EmptyState, PageHeader, SubmitButton, Table, Td } from '@vendra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { isUuid } from '../../../../../lib/catalogue';
import { session } from '../../../../../lib/session';
import { cancelImport, startImport } from '../actions';
import { dateTime, type Issue, isActive, ITEM_STATUS, JOB_STATUS, MODE_LABEL } from '../shared';
import { AutoRefresh } from '../../../../../lib/auto-refresh';

export const metadata: Metadata = { title: 'Product import' };

const PAGE_SIZE = 100;
const ITEM_FILTERS = ['invalid', 'ready', 'skipped', 'imported', 'failed'] as const;
type ItemFilter = (typeof ITEM_FILTERS)[number];
const ACTION_LABEL: Record<string, string> = { create: 'New', update: 'Update', skip: 'Leave as is' };

function IssueList({ issues, tone }: { issues: readonly Issue[]; tone: 'danger' | 'warning' }) {
  return (
    <ul className={`space-y-1 text-sm ${tone === 'danger' ? 'text-[#9b1c1c]' : 'text-[#7a5200]'}`}>
      {issues.map((issue, index) => (
        <li key={index}>
          {issue.line ? <span className="font-medium">Line {issue.line}: </span> : null}
          {issue.field ? <code className="mr-1">{issue.field}</code> : null}
          {issue.message}
        </li>
      ))}
    </ul>
  );
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div>
      <div className="text-2xl font-semibold tabular-nums">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

export default async function ImportPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const { id } = await params;
  if (!isUuid(id)) notFound();
  const query = await searchParams;
  const status = ITEM_FILTERS.includes(query.status as ItemFilter) ? (query.status as ItemFilter) : undefined;
  const after = query.after && /^\d+$/.test(query.after) ? Number(query.after) : undefined;

  const job = await session.find((api) => api.GET('/v1/admin/product-imports/{id}', { params: { path: { id } } }));
  if (!job) notFound();
  const items = await session.read((api) =>
    api.GET('/v1/admin/product-imports/{id}/items', { params: { path: { id }, query: { status, limit: PAGE_SIZE, after } } }),
  );

  const jobStatus = JOB_STATUS[job.status] ?? { label: job.status, tone: 'neutral' as const };
  const fileRejected = job.issues.length > 0;
  const canStart = job.status === 'validated' && !fileRejected && job.counts.ready > 0;
  const active = isActive(job.status);
  const total = job.counts.ready + job.counts.imported + job.counts.failed + job.counts.skipped;
  const done = job.counts.imported + job.counts.failed;
  const last = items.at(-1);
  const filterHref = (option?: ItemFilter, afterPosition?: number) => {
    const search = new URLSearchParams();
    if (option) search.set('status', option);
    if (afterPosition !== undefined) search.set('after', String(afterPosition));
    const value = search.toString();
    return `/catalogue/imports/${id}${value ? `?${value}` : ''}`;
  };
  const hasProblems = fileRejected || job.warnings.length > 0 || job.counts.invalid + job.counts.failed > 0 || items.some((item) => item.warnings.length);

  return (
    <>
      {active ? <AutoRefresh /> : null}
      <p className="mb-2 text-sm">
        <Link href="/catalogue/imports" className="text-muted underline underline-offset-2">
          Product imports
        </Link>
      </p>
      <PageHeader
        title={job.fileName}
        description={`${MODE_LABEL[job.mode] ?? job.mode}. Uploaded ${dateTime.format(new Date(job.createdAt))}.`}
        actions={
          hasProblems ? (
            <a href={`/catalogue/imports/${id}/report`} className={buttonVariants({ size: 'sm', variant: 'outline' })} download>
              Download problems (CSV)
            </a>
          ) : undefined
        }
      />

      <Card className="mb-6">
        <div className="mb-4 flex flex-wrap items-center gap-3">
          <Badge tone={jobStatus.tone}>{jobStatus.label}</Badge>
          {job.startedAt ? <span className="text-sm text-muted">Started {dateTime.format(new Date(job.startedAt))}</span> : null}
          {job.finishedAt ? <span className="text-sm text-muted">Ended {dateTime.format(new Date(job.finishedAt))}</span> : null}
        </div>
        <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 lg:grid-cols-7">
          <Stat label="Rows" value={job.summary.rows} />
          <Stat label="Products" value={job.summary.products} />
          <Stat label="Variants" value={job.summary.variants} />
          <Stat label="New" value={job.summary.creates} />
          <Stat label="Updates" value={job.summary.updates} />
          <Stat label="Imported" value={job.counts.imported} />
          <Stat label="Problems" value={job.counts.invalid + job.counts.failed} />
        </div>
        {active && total > 0 ? (
          <div className="mt-4">
            <div className="h-2 overflow-hidden rounded-full bg-background" role="progressbar" aria-valuemin={0} aria-valuemax={total} aria-valuenow={done}>
              <div className="h-full bg-primary transition-all" style={{ width: `${Math.round((done / total) * 100)}%` }} />
            </div>
            <p className="mt-1 text-xs text-muted">
              {done} of {total} products done. You can leave this page; the import carries on.
            </p>
          </div>
        ) : null}

        {fileRejected ? (
          <div className="mt-5 space-y-2">
            <Alert>The file cannot be imported. Fix these problems and upload it again.</Alert>
            <IssueList issues={job.issues} tone="danger" />
          </div>
        ) : null}
        {job.warnings.length ? (
          <div className="mt-5 space-y-2">
            <h2 className="text-sm font-semibold">Warnings</h2>
            <IssueList issues={job.warnings} tone="warning" />
          </div>
        ) : null}

        {canStart ? (
          <div className="mt-5 border-t border-border pt-4">
            <p className="mb-3 text-sm text-muted">
              {job.counts.ready} {job.counts.ready === 1 ? 'product is' : 'products are'} ready.
              {job.counts.invalid ? ` ${job.counts.invalid} with problems will be left out; fix them in a new file.` : ''}
            </p>
            <ActionForm action={startImport.bind(null, id)}>
              <SubmitButton pendingLabel="Starting…">Import {job.counts.ready} {job.counts.ready === 1 ? 'product' : 'products'}</SubmitButton>
            </ActionForm>
          </div>
        ) : null}
        {job.status === 'validated' && !fileRejected && job.counts.ready === 0 ? (
          <div className="mt-5">
            <Alert tone="warning">No product in this file passed the checks. Fix the problems below and upload the file again.</Alert>
          </div>
        ) : null}
        {active ? (
          <div className="mt-5 border-t border-border pt-4">
            <ActionForm action={cancelImport.bind(null, id)}>
              <SubmitButton variant="outline" pendingLabel="Stopping…">
                Stop import
              </SubmitButton>
            </ActionForm>
          </div>
        ) : null}
      </Card>

      <nav aria-label="Filter products" className="mb-4 flex flex-wrap gap-2 text-sm">
        {[undefined, ...ITEM_FILTERS].map((option) => (
          <Link
            key={option ?? 'all'}
            href={filterHref(option)}
            aria-current={option === status ? 'page' : undefined}
            className={`rounded-full border px-3 py-1 ${option === status ? 'border-primary bg-primary text-primary-foreground' : 'border-border bg-surface'}`}
          >
            {option ? `${ITEM_STATUS[option]?.label ?? option} (${job.counts[option]})` : 'All'}
          </Link>
        ))}
      </nav>

      {items.length === 0 ? (
        <EmptyState title={after !== undefined ? 'No more products' : 'Nothing here'}>
          {fileRejected ? 'The file was rejected before its products were read.' : 'No product in this import has that status.'}
        </EmptyState>
      ) : (
        <Table caption="Products in the file" head={['Product', 'Lines', 'SKUs', 'Action', 'Status', 'Details']}>
          {items.map((item) => {
            const itemStatus = ITEM_STATUS[item.status] ?? { label: item.status, tone: 'neutral' as const };
            return (
              <tr key={item.id}>
                <Td className="align-top">
                  {item.productId ? (
                    <Link href={`/catalogue/products/${item.productId}`} className="font-medium text-primary underline-offset-2 hover:underline">
                      {item.name || item.handle}
                    </Link>
                  ) : (
                    <span className="font-medium">{item.name || item.handle}</span>
                  )}
                  <div className="text-xs text-muted">{item.handle}</div>
                </Td>
                <Td className="whitespace-nowrap align-top text-muted">{compactLines(item.lines)}</Td>
                <Td className="align-top text-xs">{item.skus.join(', ') || '—'}</Td>
                <Td className="align-top">{ACTION_LABEL[item.action] ?? item.action}</Td>
                <Td className="align-top">
                  <Badge tone={itemStatus.tone}>{itemStatus.label}</Badge>
                </Td>
                <Td className="align-top">
                  {item.errors.length ? <IssueList issues={item.errors} tone="danger" /> : null}
                  {item.warnings.length ? <IssueList issues={item.warnings} tone="warning" /> : null}
                  {!item.errors.length && !item.warnings.length ? <span className="text-muted">—</span> : null}
                </Td>
              </tr>
            );
          })}
        </Table>
      )}
      <div className="mt-4 flex gap-3 text-sm">
        {after !== undefined ? (
          <Link href={filterHref(status)} className="underline">
            First page
          </Link>
        ) : null}
        {last && items.length === PAGE_SIZE ? (
          <Link href={filterHref(status, last.position)} className="underline">
            Next page
          </Link>
        ) : null}
      </div>
    </>
  );
}

/** 2, 3, 4, 9 → "2–4, 9". */
function compactLines(lines: readonly number[]): string {
  const sorted = [...lines].sort((a, b) => a - b);
  const parts: string[] = [];
  let start: number | undefined;
  let end = 0;
  for (const line of sorted) {
    if (start !== undefined && line === end + 1) {
      end = line;
      continue;
    }
    if (start !== undefined) parts.push(start === end ? String(start) : `${start}–${end}`);
    start = line;
    end = line;
  }
  if (start !== undefined) parts.push(start === end ? String(start) : `${start}–${end}`);
  return parts.join(', ') || '—';
}
