import type { Prisma, Payment as PaymentRow, PrismaClient, Refund as RefundRow } from '@prisma/client';
import { appendAudit } from '../../../platform/audit/audit';
import { appendToOutbox } from '../../../platform/outbox/outbox';
import { AuditEntry, ConcurrencyConflict, Money } from '../../../shared-kernel';
import { PaymentRepository } from '../application/ports';
import { RefundRepository } from '../application/refunds';
import { Payment } from '../domain/payment';
import { Refund, RefundStatus } from '../domain/refund';

function toDomain(row: PaymentRow): Payment {
  return Payment.rehydrate({
    id: row.id,
    checkoutId: row.checkoutId,
    reference: row.reference,
    provider: row.provider,
    gatewayId: row.gatewayId,
    redirectUrl: row.redirectUrl,
    amount: Money.of(row.amountMinor, row.currency),
    status: row.status,
    providerTransactionId: row.providerTransactionId,
    refunded: Money.of(row.refundedMinor, row.currency),
    refundPending: Money.of(row.refundPendingMinor, row.currency),
    version: row.version,
  });
}

export class PrismaPaymentRepository implements PaymentRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Payment | null> {
    const row = await this.prisma.payment.findUnique({ where: { id } });
    return row ? toDomain(row) : null;
  }

  async findByReference(reference: string): Promise<Payment | null> {
    const row = await this.prisma.payment.findUnique({ where: { reference } });
    return row ? toDomain(row) : null;
  }

  async findOpenForCheckout(checkoutId: string, gatewayId: string): Promise<Payment | null> {
    const row = await this.prisma.payment.findFirst({
      where: { checkoutId, gatewayId, status: 'initiated', redirectUrl: { not: null } },
      orderBy: { createdAt: 'desc' },
    });
    return row ? toDomain(row) : null;
  }

  async recent(limit: number, status?: string) {
    return this.prisma.payment.findMany({
      where: status ? { status: status as never } : {},
      orderBy: { createdAt: 'desc' },
      take: limit,
      select: { id: true, reference: true, checkoutId: true, provider: true, gatewayId: true, amountMinor: true, currency: true, status: true, createdAt: true, updatedAt: true },
    });
  }

  async save(payment: Payment): Promise<void> {
    await this.prisma.$transaction((tx) => writePayment(tx, payment));
    payment.markSaved();
  }
}

/** Writes a payment and its events. Rejects a stale version. */
async function writePayment(tx: Prisma.TransactionClient, payment: Payment): Promise<void> {
  const state = payment.snapshot;
  const events = payment.pullEvents();
  const fields = {
    status: state.status,
    providerTransactionId: state.providerTransactionId,
    refundedMinor: state.refunded.minor,
    refundPendingMinor: state.refundPending.minor,
    redirectUrl: state.redirectUrl,
  };
  if (state.version === 0) {
    await tx.payment.create({
      data: {
        ...fields,
        id: state.id,
        checkoutId: state.checkoutId,
        reference: state.reference,
        provider: state.provider,
        gatewayId: state.gatewayId,
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
}

function toRefund(row: RefundRow): Refund {
  return Refund.rehydrate({
    id: row.id,
    paymentId: row.paymentId,
    amount: Money.of(row.amountMinor, row.currency),
    reason: row.reason,
    requestedBy: row.requestedBy,
    status: row.status as RefundStatus,
    providerRefundId: row.providerRefundId,
    gatewayStatus: row.gatewayStatus,
    failureReason: row.failureReason,
    resolvedBy: row.resolvedBy,
    createdAt: row.createdAt,
    version: row.version,
  });
}

export class PrismaRefundRepository implements RefundRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async find(id: string): Promise<Refund | null> {
    const row = await this.prisma.refund.findUnique({ where: { id } });
    return row ? toRefund(row) : null;
  }

  async forPayment(paymentId: string): Promise<Refund[]> {
    const rows = await this.prisma.refund.findMany({ where: { paymentId }, orderBy: { createdAt: 'desc' } });
    return rows.map(toRefund);
  }

  async save(refund: Refund, payment: Payment, audit?: AuditEntry): Promise<void> {
    const state = refund.snapshot;
    const fields = {
      status: state.status,
      providerRefundId: state.providerRefundId,
      gatewayStatus: state.gatewayStatus,
      failureReason: state.failureReason,
      resolvedBy: state.resolvedBy,
    };
    await this.prisma.$transaction(async (tx) => {
      await writePayment(tx, payment);
      if (state.version === 0) {
        await tx.refund.create({
          data: {
            ...fields,
            id: state.id,
            paymentId: state.paymentId,
            amountMinor: state.amount.minor,
            currency: state.amount.currency,
            reason: state.reason,
            requestedBy: state.requestedBy,
            createdAt: state.createdAt,
            version: 1,
          },
        });
      } else {
        const { count } = await tx.refund.updateMany({ where: { id: state.id, version: state.version }, data: { ...fields, version: { increment: 1 } } });
        if (count !== 1) throw new ConcurrencyConflict('Refund', state.id);
      }
      if (audit) await appendAudit(tx, audit);
    });
    payment.markSaved();
    refund.markSaved();
  }
}
