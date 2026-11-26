import { Prisma, type PrismaClient } from '@prisma/client';
import { appendAudit } from '../../../platform/audit/audit';
import { AuditEntry } from '../../../shared-kernel';
import {
  ClaimedJob,
  ImportItemView,
  ImportJobView,
  ImportMode,
  ImportRepository,
  ITEM_STATUSES,
  ItemAction,
  ItemCounts,
  ItemStatus,
  Issue,
  JobStatus,
  NewImportItem,
  NewImportJob,
  PlannedProduct,
} from '../application/ports';

const json = (value: unknown) => value as Prisma.InputJsonValue;
const INSERT_BATCH = 500;

interface StoredPayload {
  readonly planned: PlannedProduct | null;
  readonly skus: readonly string[];
}

type JobRow = Prisma.ImportJobGetPayload<object>;

export class PrismaImportRepository implements ImportRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(job: NewImportJob, items: readonly NewImportItem[], audit: AuditEntry): Promise<void> {
    await this.prisma.$transaction(
      async (tx) => {
        await tx.importJob.create({
          data: {
            id: job.id,
            format: job.format,
            fileName: job.fileName,
            sha256: job.sha256,
            sizeBytes: job.sizeBytes,
            mode: job.mode,
            status: 'validated',
            issues: json(job.issues),
            summary: json({ ...job.summary, warnings: job.warnings }),
            createdBy: job.createdBy,
          },
        });
        for (let index = 0; index < items.length; index += INSERT_BATCH) {
          await tx.importItem.createMany({
            data: items.slice(index, index + INSERT_BATCH).map((item) => ({
              id: item.id,
              jobId: job.id,
              position: item.position,
              handle: item.handle,
              name: item.name.slice(0, 200),
              rowNumbers: json(item.lines),
              payload: json({ planned: item.payload, skus: item.skus } satisfies StoredPayload),
              action: item.action,
              status: item.status,
              errors: json(item.errors),
              warnings: json(item.warnings),
              productId: item.productId,
            })),
          });
        }
        await appendAudit(tx, audit);
      },
      { timeout: 60_000 },
    );
  }

  async findJob(id: string): Promise<ImportJobView | null> {
    const row = await this.prisma.importJob.findUnique({ where: { id } });
    if (!row) return null;
    return this.toView(row, (await this.counts([id])).get(id));
  }

  async listJobs(query: { limit: number; before?: Date }): Promise<ImportJobView[]> {
    const rows = await this.prisma.importJob.findMany({
      where: query.before ? { createdAt: { lt: query.before } } : {},
      orderBy: { createdAt: 'desc' },
      take: query.limit,
    });
    const counts = await this.counts(rows.map((row) => row.id));
    return rows.map((row) => this.toView(row, counts.get(row.id)));
  }

  async listItems(jobId: string, query: { status?: ItemStatus; limit: number; afterPosition?: number }): Promise<ImportItemView[]> {
    const rows = await this.prisma.importItem.findMany({
      where: { jobId, ...(query.status ? { status: query.status } : {}), ...(query.afterPosition !== undefined ? { position: { gt: query.afterPosition } } : {}) },
      orderBy: { position: 'asc' },
      take: query.limit,
    });
    return rows.map((row) => ({
      id: row.id,
      position: row.position,
      handle: row.handle,
      name: row.name,
      lines: row.rowNumbers as number[],
      skus: (row.payload as unknown as StoredPayload).skus ?? [],
      action: row.action as ItemAction,
      status: row.status as ItemStatus,
      errors: row.errors as unknown as Issue[],
      warnings: row.warnings as unknown as Issue[],
      productId: row.productId,
      processedAt: row.processedAt,
    }));
  }

  async transition(id: string, from: readonly JobStatus[], to: JobStatus, now: Date, audit: AuditEntry): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.importJob.updateMany({
        where: { id, status: { in: [...from] } },
        data: { status: to, version: { increment: 1 }, ...(to === 'cancelled' ? { finishedAt: now, leaseUntil: null } : {}) },
      });
      if (count === 1) await appendAudit(tx, audit);
      return count === 1;
    });
  }

  /** SKIP LOCKED lets several API instances poll without taking the same job. */
  async claim(now: Date, leaseMs: number): Promise<ClaimedJob | null> {
    const until = new Date(now.getTime() + leaseMs);
    const rows = await this.prisma.$queryRaw<{ id: string; mode: string; createdBy: string }[]>`
      UPDATE "catalogue"."import_jobs" SET "status" = 'running', "leaseUntil" = ${until},
        "startedAt" = COALESCE("startedAt", ${now}), "version" = "version" + 1
      WHERE "id" = (
        SELECT "id" FROM "catalogue"."import_jobs"
        WHERE "status" = 'queued' OR ("status" = 'running' AND "leaseUntil" < ${now})
        ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING "id", "mode", "createdBy"`;
    const row = rows[0];
    return row ? { id: row.id, mode: row.mode as ImportMode, createdBy: row.createdBy } : null;
  }

  async renewLease(id: string, until: Date): Promise<boolean> {
    const { count } = await this.prisma.importJob.updateMany({ where: { id, status: 'running' }, data: { leaseUntil: until } });
    return count === 1;
  }

  async nextReady(jobId: string): Promise<{ id: string; payload: PlannedProduct } | null> {
    const row = await this.prisma.importItem.findFirst({ where: { jobId, status: 'ready' }, orderBy: { position: 'asc' }, select: { id: true, payload: true } });
    const planned = row ? (row.payload as unknown as StoredPayload).planned : null;
    if (row && !planned) {
      await this.prisma.importItem.update({ where: { id: row.id }, data: { status: 'failed', errors: json([{ line: null, field: null, message: 'Nothing to import' }]) } });
      return this.nextReady(jobId);
    }
    return row && planned ? { id: row.id, payload: planned } : null;
  }

  async recordItem(id: string, result: { status: ItemStatus; errors: readonly Issue[]; warnings: readonly Issue[]; productId: string | null }, now: Date): Promise<void> {
    const current = await this.prisma.importItem.findUniqueOrThrow({ where: { id }, select: { warnings: true } });
    await this.prisma.importItem.update({
      where: { id },
      data: {
        status: result.status,
        errors: json(result.errors),
        // Keep the warnings from checking the file, and add those from importing.
        warnings: json([...(current.warnings as unknown as Issue[]), ...result.warnings]),
        productId: result.productId,
        processedAt: now,
      },
    });
  }

  async complete(id: string, now: Date): Promise<void> {
    await this.prisma.importJob.updateMany({ where: { id, status: 'running' }, data: { status: 'completed', finishedAt: now, leaseUntil: null, version: { increment: 1 } } });
  }

  private async counts(jobIds: readonly string[]): Promise<Map<string, ItemCounts>> {
    if (jobIds.length === 0) return new Map();
    const rows = await this.prisma.importItem.groupBy({ by: ['jobId', 'status'], where: { jobId: { in: [...jobIds] } }, _count: { _all: true } });
    const result = new Map<string, Record<ItemStatus, number>>();
    for (const row of rows) {
      const counts = result.get(row.jobId) ?? (Object.fromEntries(ITEM_STATUSES.map((status) => [status, 0])) as Record<ItemStatus, number>);
      counts[row.status as ItemStatus] = row._count._all;
      result.set(row.jobId, counts);
    }
    return result;
  }

  private toView(row: JobRow, counts: ItemCounts | undefined): ImportJobView {
    const { warnings, ...summary } = row.summary as unknown as ImportJobView['summary'] & { warnings?: Issue[] };
    return {
      id: row.id,
      format: row.format as 'csv',
      fileName: row.fileName,
      sizeBytes: row.sizeBytes,
      mode: row.mode as ImportMode,
      status: row.status as JobStatus,
      issues: row.issues as unknown as Issue[],
      warnings: warnings ?? [],
      summary,
      counts: counts ?? (Object.fromEntries(ITEM_STATUSES.map((status) => [status, 0])) as ItemCounts),
      createdBy: row.createdBy,
      createdAt: row.createdAt,
      startedAt: row.startedAt,
      finishedAt: row.finishedAt,
    };
  }
}
