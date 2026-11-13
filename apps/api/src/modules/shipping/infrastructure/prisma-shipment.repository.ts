import { Prisma, type PrismaClient } from '@prisma/client';
import { appendAudit } from '../../../platform/audit/audit';
import { appendToOutbox } from '../../../platform/outbox/outbox';
import { ApplicationError, AuditEntry, ConcurrencyConflict } from '../../../shared-kernel';
import { ShipmentRepository } from '../application/ports';
import { Shipment } from '../domain/shipment';

const include = {
  items: true,
  history: { orderBy: { sequence: 'asc' } },
  attempts: { orderBy: { attemptNumber: 'asc' } },
} satisfies Prisma.ShipmentInclude;

type Row = Prisma.ShipmentGetPayload<{ include: typeof include }>;

export class PrismaShipmentRepository implements ShipmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Shipment | null> {
    const row = await this.prisma.shipment.findUnique({ where: { id }, include });
    return row ? toShipment(row) : null;
  }

  async listForSellerOrders(sellerOrderIds: readonly string[]): Promise<Shipment[]> {
    if (sellerOrderIds.length === 0) return [];
    const rows = await this.prisma.shipment.findMany({ where: { sellerOrderId: { in: [...sellerOrderIds] } }, include, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
    return rows.map(toShipment);
  }

  async listByStatus(statuses: readonly string[], limit: number): Promise<Shipment[]> {
    const rows = await this.prisma.shipment.findMany({
      where: { status: { in: statuses as Row['status'][] } },
      include,
      orderBy: [{ updatedAt: 'asc' }, { id: 'asc' }],
      take: limit,
    });
    return rows.map(toShipment);
  }

  async save(shipment: Shipment, audit?: AuditEntry): Promise<void> {
    try {
      await this.write(shipment, audit);
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        if (/tracking/i.test(JSON.stringify(error.meta ?? {}))) {
          throw new ApplicationError('conflict', 'shipment.tracking_taken', 'Another shipment with this courier already has that tracking number');
        }
        throw new ApplicationError('conflict', 'shipment.already_open', 'These items already have a shipment on its way. Cancel it before sending again.');
      }
      throw error;
    }
  }

  private async write(shipment: Shipment, audit?: AuditEntry): Promise<void> {
    const events = shipment.pullEvents();
    const fields = { status: shipment.currentStatus, trackingReference: shipment.trackingReference };

    await this.prisma.$transaction(async (tx) => {
      if (shipment.version === 0) {
        await tx.shipment.create({
          data: {
            ...fields,
            id: shipment.id,
            sellerOrderId: shipment.sellerOrderId,
            mode: shipment.mode,
            provider: shipment.provider,
            courier: shipment.courier,
            version: 1,
            items: { create: [...shipment.items] },
          },
        });
      } else {
        const { count } = await tx.shipment.updateMany({
          where: { id: shipment.id, version: shipment.version },
          data: { ...fields, version: { increment: 1 } },
        });
        if (count !== 1) throw new ConcurrencyConflict('Shipment', shipment.id);
      }

      // History and attempts only grow, so write what the database does not have yet.
      const savedHistory = await tx.shipmentStatusEvent.count({ where: { shipmentId: shipment.id } });
      await tx.shipmentStatusEvent.createMany({
        data: shipment.history.slice(savedHistory).map((change, index) => ({
          ...change,
          shipmentId: shipment.id,
          sequence: savedHistory + index + 1,
        })),
      });
      const savedAttempts = await tx.deliveryAttempt.count({ where: { shipmentId: shipment.id } });
      await tx.deliveryAttempt.createMany({
        data: shipment.deliveryAttempts
          .slice(savedAttempts)
          .map((attempt) => ({ ...attempt, shipmentId: shipment.id })),
      });
      if (audit) await appendAudit(tx, audit);
      await appendToOutbox(tx, events);
    });
    shipment.markSaved();
  }
}

function toShipment(row: Row): Shipment {
  return Shipment.rehydrate({
    id: row.id,
    sellerOrderId: row.sellerOrderId,
    mode: row.mode,
    provider: row.provider,
    courier: row.courier,
    trackingReference: row.trackingReference,
    status: row.status,
    version: row.version,
    items: row.items.map(({ orderLineId, quantity }) => ({ orderLineId, quantity })),
    history: row.history.map(({ status, at, note }) => ({ status, at, note })),
    attempts: row.attempts.map(({ attemptNumber, at, successful, reason }) => ({ attemptNumber, at, successful, reason })),
  });
}
