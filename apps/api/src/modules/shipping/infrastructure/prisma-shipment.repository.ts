import type { PrismaClient } from '@prisma/client';
import { appendToOutbox } from '../../../platform/outbox/outbox';
import { ConcurrencyConflict } from '../../../shared-kernel';
import { ShipmentRepository } from '../application/ports';
import { Shipment } from '../domain/shipment';

export class PrismaShipmentRepository implements ShipmentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Shipment | null> {
    const row = await this.prisma.shipment.findUnique({
      where: { id },
      include: {
        items: true,
        history: { orderBy: { sequence: 'asc' } },
        attempts: { orderBy: { attemptNumber: 'asc' } },
      },
    });
    if (!row) return null;
    return Shipment.rehydrate({
      id: row.id,
      sellerOrderId: row.sellerOrderId,
      mode: row.mode,
      provider: row.provider,
      trackingReference: row.trackingReference,
      status: row.status,
      version: row.version,
      items: row.items.map(({ orderLineId, quantity }) => ({ orderLineId, quantity })),
      history: row.history.map(({ status, at, note }) => ({ status, at, note })),
      attempts: row.attempts.map(({ attemptNumber, at, successful, reason }) => ({
        attemptNumber,
        at,
        successful,
        reason,
      })),
    });
  }

  async save(shipment: Shipment): Promise<void> {
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
      await appendToOutbox(tx, events);
    });
    shipment.markSaved();
  }
}
