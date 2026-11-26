import { ActionForm, Badge, buttonVariants, Card, EmptyState, Field, PageHeader, Select, SubmitButton, Table, Td } from '@vendra/ui';
import type { Metadata } from 'next';
import Link from 'next/link';
import { session } from '../../../../lib/session';
import { uploadImport } from './actions';
import { dateTime, JOB_STATUS, MODE_LABEL } from './shared';

export const metadata: Metadata = { title: 'Product imports' };

/** The most the API accepts whatever the setting says. The setting itself is checked there. */
const UPLOAD_LIMIT_BYTES = 20 * 1024 * 1024;
const PAGE_SIZE = 20;

export default async function ImportsPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const params = await searchParams;
  const before = params.before && !Number.isNaN(Date.parse(params.before)) ? new Date(params.before).toISOString() : undefined;
  const [jobs, columns] = await Promise.all([
    session.read((api) => api.GET('/v1/admin/product-imports', { params: { query: { limit: PAGE_SIZE, before } } })),
    session.read((api) => api.GET('/v1/admin/product-imports/columns')),
  ]);
  const last = jobs.at(-1);

  return (
    <>
      <PageHeader
        title="Product imports"
        description="Add or update many products at once from a CSV file. Each file is checked first; nothing changes until you start the import."
        actions={
          <a href="/catalogue/imports/template" className={buttonVariants({ size: 'sm', variant: 'outline' })} download>
            Download template
          </a>
        }
      />

      <div className="grid gap-6 lg:grid-cols-[2fr_3fr]">
        <Card>
          <h2 className="text-lg font-semibold">Upload a file</h2>
          <p className="mb-4 text-sm text-muted">
            One row per variant. Rows with the same <code>handle</code> are one product. In Excel or Google Sheets, save as “CSV UTF-8”.
          </p>
          <ActionForm action={uploadImport.bind(null, UPLOAD_LIMIT_BYTES)} className="space-y-4">
            <Field label="CSV file">
              <input name="file" type="file" required accept=".csv,text/csv" className="block w-full text-sm file:mr-3 file:rounded-brand file:border file:border-border file:bg-surface file:px-3 file:py-1.5" />
            </Field>
            <Field label="Products that already exist" hint="A product exists when its handle or one of its SKUs is already in the catalogue.">
              <Select name="mode" defaultValue="create_and_update">
                {Object.entries(MODE_LABEL).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </Select>
            </Field>
            <SubmitButton pendingLabel="Checking file…">Check file</SubmitButton>
          </ActionForm>
        </Card>

        <Card>
          <h2 className="text-lg font-semibold">Columns</h2>
          <p className="mb-3 text-sm text-muted">
            Only the columns marked required must be present. Column names are not case-sensitive. Product columns can be left blank on a product’s second and later rows.
          </p>
          <details>
            <summary className="cursor-pointer text-sm font-medium text-primary">Show all {columns.length} columns</summary>
            <div className="mt-3 max-h-[28rem] overflow-y-auto">
              <Table caption="Import columns" head={['Column', 'Applies to', 'What to put', 'Example']}>
                {columns.map((column) => (
                  <tr key={column.name}>
                    <Td className="whitespace-nowrap align-top">
                      <code className="font-medium">{column.name}</code>
                      {column.required ? (
                        <div>
                          <Badge tone="warning">required</Badge>
                        </div>
                      ) : null}
                      {column.aliases.length ? <div className="text-xs text-muted">also: {column.aliases.join(', ')}</div> : null}
                    </Td>
                    <Td className="align-top capitalize">{column.level}</Td>
                    <Td className="align-top">{column.description}</Td>
                    <Td className="align-top text-muted">
                      <code className="break-all">{column.example}</code>
                    </Td>
                  </tr>
                ))}
              </Table>
            </div>
          </details>
        </Card>
      </div>

      <h2 className="mb-3 mt-8 text-lg font-semibold">Recent imports</h2>
      {jobs.length === 0 ? (
        <EmptyState title={before ? 'No older imports' : 'No imports yet'}>Download the template, fill it in, and upload it above.</EmptyState>
      ) : (
        <Table caption="Recent imports" head={['File', 'Status', 'Products', 'Imported', 'Problems', 'Uploaded']}>
          {jobs.map((job) => {
            const status = JOB_STATUS[job.status] ?? { label: job.status, tone: 'neutral' as const };
            return (
              <tr key={job.id}>
                <Td>
                  <Link href={`/catalogue/imports/${job.id}`} className="font-medium text-primary underline-offset-2 hover:underline">
                    {job.fileName}
                  </Link>
                  <div className="text-xs text-muted">{MODE_LABEL[job.mode] ?? job.mode}</div>
                </Td>
                <Td>
                  <Badge tone={status.tone}>{status.label}</Badge>
                </Td>
                <Td>{job.summary.products}</Td>
                <Td>{job.counts.imported}</Td>
                <Td>{job.issues.length ? 'File rejected' : job.counts.invalid + job.counts.failed}</Td>
                <Td className="whitespace-nowrap text-muted">{dateTime.format(new Date(job.createdAt))}</Td>
              </tr>
            );
          })}
        </Table>
      )}
      <div className="mt-4 flex gap-3 text-sm">
        {before ? (
          <Link href="/catalogue/imports" className="underline">
            Newest
          </Link>
        ) : null}
        {last && jobs.length === PAGE_SIZE ? (
          <Link href={`/catalogue/imports?before=${encodeURIComponent(new Date(last.createdAt).toISOString())}`} className="underline">
            Older
          </Link>
        ) : null}
      </div>
    </>
  );
}
