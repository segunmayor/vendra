import { Prisma, type PrismaClient } from '@prisma/client';
import { appendAudit } from '../../../platform/audit/audit';
import type { AuditEntry } from '../../../shared-kernel';
import type { SettingKey, SettingsStore } from '../application/settings';

export class PrismaSettingsStore implements SettingsStore {
  constructor(private readonly prisma: PrismaClient) {}

  async all(): Promise<Map<string, unknown>> {
    return new Map((await this.prisma.setting.findMany()).map((row) => [row.key, row.value]));
  }

  async save(changes: ReadonlyMap<SettingKey, unknown>, actorId: string, audit: AuditEntry): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      for (const [key, value] of changes) {
        const json = value as Prisma.InputJsonValue;
        await tx.setting.upsert({
          where: { key },
          create: { key, value: json, updatedBy: actorId },
          update: { value: json, updatedBy: actorId, updatedAt: new Date() },
        });
      }
      await appendAudit(tx, audit);
    });
  }
}
