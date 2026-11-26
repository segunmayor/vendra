import { Prisma, type PrismaClient } from '@prisma/client';
import { createHash } from 'node:crypto';
import { appendAudit } from '../../../platform/audit/audit';
import { AuditEntry } from '../../../shared-kernel';
import { Hasher, MoveCursor, MoveJob, MoveProblem, MoveProgress, MoveRepository, MoveStatus } from '../application/ports';

const MAX_PROBLEMS = 20;
type Row = Prisma.StorageMoveJobGetPayload<object>;

const toJob = (row: Row): MoveJob => ({
  id: row.id,
  targetLocationId: row.targetLocationId,
  status: row.status as MoveStatus,
  deleteOld: row.deleteOld,
  total: row.total,
  moved: row.moved,
  skipped: row.skipped,
  failed: row.failed,
  movedBytes: Number(row.movedBytes),
  cursor: { holder: 0, after: null, ...(row.cursor as Partial<MoveCursor>) },
  problems: (row.problems as (Omit<MoveProblem, 'at'> & { at: string })[]).map((problem) => ({ ...problem, at: new Date(problem.at) })),
  message: row.message,
  createdBy: row.createdBy,
  createdAt: row.createdAt,
  startedAt: row.startedAt,
  finishedAt: row.finishedAt,
});

export class PrismaMoveRepository implements MoveRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(job: Pick<MoveJob, 'id' | 'targetLocationId' | 'deleteOld' | 'total' | 'createdBy'>, audit: AuditEntry): Promise<boolean> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.storageMoveJob.create({ data: { ...job, status: 'queued' } });
        await appendAudit(tx, audit);
      });
      return true;
    } catch (error) {
      // move_jobs_one_open: another move is queued or running.
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
      throw error;
    }
  }

  async find(id: string): Promise<MoveJob | null> {
    const row = await this.prisma.storageMoveJob.findUnique({ where: { id } });
    return row ? toJob(row) : null;
  }

  async recent(limit: number): Promise<MoveJob[]> {
    return (await this.prisma.storageMoveJob.findMany({ orderBy: { createdAt: 'desc' }, take: limit })).map(toJob);
  }

  /** SKIP LOCKED lets several API instances poll without taking the same job. */
  async claim(now: Date, leaseMs: number): Promise<MoveJob | null> {
    const until = new Date(now.getTime() + leaseMs);
    const rows = await this.prisma.$queryRaw<{ id: string }[]>`
      UPDATE "storage"."move_jobs" SET "status" = 'running', "leaseUntil" = ${until},
        "startedAt" = COALESCE("startedAt", ${now}), "version" = "version" + 1
      WHERE "id" = (
        SELECT "id" FROM "storage"."move_jobs"
        WHERE "status" = 'queued' OR ("status" = 'running' AND "leaseUntil" < ${now})
        ORDER BY "createdAt" LIMIT 1 FOR UPDATE SKIP LOCKED
      )
      RETURNING "id"`;
    return rows[0] ? this.find(rows[0].id) : null;
  }

  async progress(id: string, progress: MoveProgress, leaseUntil: Date): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.storageMoveJob.findUnique({ where: { id }, select: { status: true, problems: true } });
      if (!row || row.status !== 'running') return false;
      const problems = progress.problem ? [{ ...progress.problem, at: progress.problem.at.toISOString() }, ...(row.problems as unknown[])].slice(0, MAX_PROBLEMS) : undefined;
      const { count } = await tx.storageMoveJob.updateMany({
        where: { id, status: 'running' },
        data: {
          moved: progress.moved,
          skipped: progress.skipped,
          failed: progress.failed,
          movedBytes: BigInt(progress.movedBytes),
          cursor: progress.cursor as unknown as Prisma.InputJsonValue,
          ...(problems ? { problems: problems as Prisma.InputJsonValue } : {}),
          leaseUntil,
        },
      });
      return count === 1;
    });
  }

  async finish(id: string, status: Exclude<MoveStatus, 'queued' | 'running'>, message: string | null, now: Date): Promise<void> {
    await this.prisma.storageMoveJob.updateMany({ where: { id, status: 'running' }, data: { status, message, finishedAt: now, leaseUntil: null } });
  }

  async cancel(id: string, now: Date, audit: AuditEntry): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.storageMoveJob.updateMany({
        where: { id, status: { in: ['queued', 'running'] } },
        data: { status: 'cancelled', message: 'Stopped by staff. Files already moved stay moved; the rest still work where they are.', finishedAt: now, leaseUntil: null },
      });
      if (count === 1) await appendAudit(tx, audit);
      return count === 1;
    });
  }
}

export const sha256Hasher: Hasher = { sha256: (bytes) => createHash('sha256').update(bytes).digest('hex') };
