import { Prisma, type PrismaClient } from '@prisma/client';
import { ConcurrencyConflict, Money } from '../../../shared-kernel';
import { type CheckoutRepository, DuplicateCheckout } from '../application/checkout.service';
import { CheckoutLine, CheckoutSession, CheckoutStatus, DeliveryAddress } from '../domain/checkout-session';

type Row = Prisma.CheckoutSessionGetPayload<object>;

interface StoredLine extends Omit<CheckoutLine, 'unitPrice' | 'lineTotal'> {
  unitPriceMinor: string;
  lineTotalMinor: string;
}

function toSession(row: Row): CheckoutSession {
  const lines = (row.lines as unknown as StoredLine[]).map(({ unitPriceMinor, lineTotalMinor, ...line }) => ({
    ...line,
    unitPrice: Money.of(BigInt(unitPriceMinor), row.currency),
    lineTotal: Money.of(BigInt(lineTotalMinor), row.currency),
  }));
  return CheckoutSession.rehydrate({
    id: row.id,
    customerId: row.customerId,
    idempotencyKey: row.idempotencyKey,
    status: row.status as CheckoutStatus,
    lines,
    address: row.address as unknown as DeliveryAddress,
    subtotal: Money.of(row.subtotalMinor, row.currency),
    delivery: Money.of(row.deliveryMinor, row.currency),
    total: Money.of(row.totalMinor, row.currency),
    weightGrams: row.weightGrams,
    expiresAt: row.expiresAt,
    version: row.version,
    paymentId: row.paymentId,
    stockIssue: row.stockIssue,
  });
}

export class PrismaCheckoutRepository implements CheckoutRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string) {
    const row = await this.prisma.checkoutSession.findUnique({ where: { id } });
    return row ? toSession(row) : null;
  }

  async findByKey(customerId: string, idempotencyKey: string) {
    const row = await this.prisma.checkoutSession.findUnique({ where: { customerId_idempotencyKey: { customerId, idempotencyKey } } });
    return row ? toSession(row) : null;
  }

  async listOpen(customerId: string, now: Date) {
    const rows = await this.prisma.checkoutSession.findMany({ where: { customerId, status: 'awaiting_payment', expiresAt: { gt: now } } });
    return rows.map(toSession);
  }

  async latest(customerId: string) {
    const row = await this.prisma.checkoutSession.findFirst({ where: { customerId }, orderBy: { createdAt: 'desc' } });
    return row ? toSession(row) : null;
  }

  async insert(session: CheckoutSession): Promise<void> {
    const state = session.snapshot;
    const lines: StoredLine[] = state.lines.map(({ unitPrice, lineTotal, ...line }) => ({
      ...line,
      unitPriceMinor: unitPrice.minor.toString(),
      lineTotalMinor: lineTotal.minor.toString(),
    }));
    try {
      await this.prisma.checkoutSession.create({
        data: {
          id: state.id,
          customerId: state.customerId,
          idempotencyKey: state.idempotencyKey,
          status: state.status,
          currency: state.total.currency,
          lines: lines as unknown as Prisma.InputJsonValue,
          address: state.address as unknown as Prisma.InputJsonValue,
          subtotalMinor: state.subtotal.minor,
          deliveryMinor: state.delivery.minor,
          totalMinor: state.total.minor,
          weightGrams: state.weightGrams,
          expiresAt: state.expiresAt,
          version: 1,
        },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') throw new DuplicateCheckout();
      throw error;
    }
    session.markSaved();
  }

  async update(session: CheckoutSession): Promise<void> {
    const state = session.snapshot;
    const { count } = await this.prisma.checkoutSession.updateMany({
      where: { id: state.id, version: state.version },
      data: { status: state.status, paymentId: state.paymentId ?? null, stockIssue: state.stockIssue ?? false, version: { increment: 1 } },
    });
    if (count !== 1) throw new ConcurrencyConflict('CheckoutSession', state.id);
    session.markSaved();
  }
}
