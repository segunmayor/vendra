import { Prisma, type PrismaClient } from '@prisma/client';
import { appendAudit } from '../../../platform/audit/audit';
import { ApplicationError, AuditEntry, Money } from '../../../shared-kernel';
import type { DeliveryZoneRepository } from '../application/logistics';
import type { DeliveryZoneState } from '../domain/delivery-zone';

export class PrismaDeliveryZoneRepository implements DeliveryZoneRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<DeliveryZoneState[]> {
    const rows = await this.prisma.deliveryZone.findMany({ include: { rates: { orderBy: { maxWeightGrams: 'asc' } } }, orderBy: { name: 'asc' } });
    return rows.map((row) => ({
      id: row.id,
      code: row.code,
      name: row.name,
      states: row.states,
      rates: row.rates.map((rate) => ({ maxWeightGrams: rate.maxWeightGrams, price: Money.of(rate.priceMinor, rate.currency) })),
    }));
  }

  async save(zone: DeliveryZoneState, isNew: boolean, audit: AuditEntry): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        // Zone edits are rare; a table lock makes the one-state-one-zone check race free.
        await tx.$executeRaw`LOCK TABLE "shipping"."delivery_zones" IN SHARE ROW EXCLUSIVE MODE`;
        const clash = await tx.deliveryZone.findFirst({
          where: { id: { not: zone.id }, states: { hasSome: [...zone.states] } },
          select: { name: true, states: true },
        });
        if (clash) {
          const shared = clash.states.filter((state) => zone.states.includes(state));
          throw new ApplicationError('conflict', 'delivery.state_taken', `${shared.join(', ')} already ${shared.length === 1 ? 'belongs' : 'belong'} to the ${clash.name} zone`);
        }
        const data = { code: zone.code, name: zone.name, states: [...zone.states] };
        if (isNew) {
          await tx.deliveryZone.create({ data: { id: zone.id, ...data } });
        } else {
          await tx.deliveryZone.update({ where: { id: zone.id }, data });
          await tx.deliveryRate.deleteMany({ where: { zoneId: zone.id } });
        }
        await tx.deliveryRate.createMany({
          data: zone.rates.map((rate) => ({ zoneId: zone.id, maxWeightGrams: rate.maxWeightGrams, priceMinor: rate.price.minor, currency: rate.price.currency })),
        });
        await appendAudit(tx, audit);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ApplicationError('conflict', 'delivery.code_taken', 'Another zone already uses this code');
      }
      throw error;
    }
  }
}
