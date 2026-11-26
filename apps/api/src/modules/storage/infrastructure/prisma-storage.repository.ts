import { Prisma, type PrismaClient } from '@prisma/client';
import { appendAudit } from '../../../platform/audit/audit';
import { AuditEntry, ConcurrencyConflict } from '../../../shared-kernel';
import { FilePurpose, LocationCheck, LocationRepository, LocationState, LocationUsage, ObjectRepository, StoredObject } from '../application/ports';

type Row = Prisma.StorageLocationGetPayload<object>;

const toState = (row: Row): LocationState => ({
  id: row.id,
  type: row.type,
  name: row.name,
  config: row.config as Record<string, string>,
  secretHints: row.secretHints as Record<string, string>,
  active: row.active,
  lastCheck: row.lastCheckedAt ? { at: row.lastCheckedAt, ok: row.lastCheckOk === true, message: row.lastCheckError } : null,
  version: row.version,
});

export class PrismaLocationRepository implements LocationRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<LocationState[]> {
    return (await this.prisma.storageLocation.findMany({ orderBy: [{ active: 'desc' }, { createdAt: 'asc' }] })).map(toState);
  }

  async find(id: string): Promise<LocationState | null> {
    const row = await this.prisma.storageLocation.findUnique({ where: { id } });
    return row ? toState(row) : null;
  }

  async active(): Promise<LocationState | null> {
    const row = await this.prisma.storageLocation.findFirst({ where: { active: true } });
    return row ? toState(row) : null;
  }

  async sealedSecrets(id: string): Promise<string | null> {
    return (await this.prisma.storageLocation.findUnique({ where: { id }, select: { secrets: true } }))?.secrets ?? null;
  }

  async usage(): Promise<Map<string, LocationUsage>> {
    const rows = await this.prisma.storageObject.groupBy({ by: ['locationId'], where: { supersededAt: null }, _count: { _all: true }, _sum: { sizeBytes: true } });
    return new Map(rows.map((row) => [row.locationId, { files: row._count._all, bytes: row._sum.sizeBytes ?? 0 }]));
  }

  async save(state: LocationState, sealedSecrets: string | null, isNew: boolean, audit: AuditEntry): Promise<void> {
    const data = {
      type: state.type,
      name: state.name,
      config: state.config as Prisma.InputJsonValue,
      secrets: sealedSecrets,
      secretHints: state.secretHints as Prisma.InputJsonValue,
    };
    await this.prisma.$transaction(async (tx) => {
      if (isNew) {
        await tx.storageLocation.create({ data: { id: state.id, ...data, version: 1 } });
      } else {
        const { count } = await tx.storageLocation.updateMany({ where: { id: state.id, version: state.version }, data: { ...data, version: { increment: 1 } } });
        if (count !== 1) throw new ConcurrencyConflict('StorageLocation', state.id);
      }
      await appendAudit(tx, audit);
    });
  }

  async recordCheck(id: string, check: LocationCheck): Promise<void> {
    // Not a settings change, so the version stays: an edit form open elsewhere still saves.
    await this.prisma.storageLocation.updateMany({ where: { id }, data: { lastCheckedAt: check.at, lastCheckOk: check.ok, lastCheckError: check.message } });
  }

  async activate(id: string | null, audit: AuditEntry): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.storageLocation.updateMany({ where: { active: true }, data: { active: false } });
      if (id) await tx.storageLocation.update({ where: { id }, data: { active: true } });
      await appendAudit(tx, audit);
    });
  }

  async remove(id: string, audit: AuditEntry): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const files = await tx.storageObject.count({ where: { locationId: id, supersededAt: null } });
      if (files > 0) return false;
      // Copies kept there after a move: nothing uses them, and the files stay in the bucket.
      await tx.storageObject.deleteMany({ where: { locationId: id } });
      const { count } = await tx.storageLocation.deleteMany({ where: { id, active: false } });
      if (count !== 1) return false;
      await appendAudit(tx, audit);
      return true;
    });
  }
}

export class PrismaObjectRepository implements ObjectRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async add(object: StoredObject & { sha256: string; purpose: FilePurpose }): Promise<void> {
    await this.prisma.storageObject.create({ data: object });
  }

  async find(id: string): Promise<StoredObject | null> {
    return this.prisma.storageObject.findUnique({ where: { id }, select: { id: true, locationId: true, key: true, contentType: true, sizeBytes: true } });
  }

  async remove(id: string): Promise<void> {
    await this.prisma.storageObject.deleteMany({ where: { id } });
  }

  async supersede(id: string, at: Date): Promise<void> {
    await this.prisma.storageObject.updateMany({ where: { id, supersededAt: null }, data: { supersededAt: at } });
  }

  async countOutside(locationId: string): Promise<{ files: number; bytes: number }> {
    const row = await this.prisma.storageObject.aggregate({ where: { locationId: { not: locationId }, supersededAt: null }, _count: { _all: true }, _sum: { sizeBytes: true } });
    return { files: row._count._all, bytes: row._sum.sizeBytes ?? 0 };
  }
}
