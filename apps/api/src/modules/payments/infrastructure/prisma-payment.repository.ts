import type { Payment as PaymentRow, PrismaClient } from '@prisma/client';
import { appendToOutbox } from '../../../platform/outbox/outbox';
import { ConcurrencyConflict, Money } from '../../../shared-kernel';
import { PaymentRepository } from '../application/ports';
import { Payment } from '../domain/payment';

function toDomain(row: PaymentRow): Payment {
  return Payment.rehydrate({
    id: row.id,
    orderId: row.orderId,
    reference: row.reference,
    provider: row.provider,
    amount: Money.of(row.amountMinor, row.currency),
    status: row.status,
    providerTransactionId: row.providerTransactionId,
    refunded: Money.of(row.refundedMinor, row.currency),
    version: row.version,
  });
}

export class PrismaPaymentRepository implements PaymentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findByReference(reference: string): Promise<Payment | null> {
    const row = await this.prisma.payment.findUnique({ where: { reference } });
    return row ? toDomain(row) : null;
  }

  async save(payment: Payment): Promise<void> {
    const state = payment.snapshot;
    const events = payment.pullEvents();
    const fields = {
      status: state.status,
      providerTransactionId: state.providerTransactionId,
      refundedMinor: state.refunded.minor,
    };

    await this.prisma.$transaction(async (tx) => {
      if (state.version === 0) {
        await tx.payment.create({
          data: {
            ...fields,
            id: state.id,
            orderId: state.orderId,
            reference: state.reference,
            provider: state.provider,
            amountMinor: state.amount.minor,
            currency: state.amount.currency,
            version: 1,
          },
        });
      } else {
        const { count } = await tx.payment.updateMany({
          where: { id: state.id, version: state.version },
          data: { ...fields, version: { increment: 1 } },
        });
        if (count !== 1) throw new ConcurrencyConflict('Payment', state.id);
      }
      await appendToOutbox(tx, events);
    });
    payment.markSaved();
  }
}
