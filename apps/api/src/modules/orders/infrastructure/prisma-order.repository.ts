import { Prisma, type PrismaClient } from '@prisma/client';
import { appendAudit } from '../../../platform/audit/audit';
import { appendToOutbox } from '../../../platform/outbox/outbox';
import { AuditEntry, ConcurrencyConflict, Money } from '../../../shared-kernel';
import { OrderFilter, OrderRepository } from '../application/orders.service';

/** Paid, with items still waiting to be handed to a courier. */
const TO_SEND = { status: 'placed', sellerOrders: { some: { status: 'pending' } } } satisfies Prisma.OrderWhereInput;

/** Cancelled or stock issue orders whose completed refunds do not yet cover what was paid. */
const OWED_REFUND = Prisma.sql`
  SELECT o."id" FROM "orders"."orders" o
  LEFT JOIN (SELECT "orderId", SUM("amountMinor") AS refunded FROM "orders"."order_refunds" GROUP BY 1) r ON r."orderId" = o."id"
  WHERE o."status" IN ('cancelled', 'stock_issue') AND COALESCE(r.refunded, 0) < o."totalMinor"`;
import { Order, OrderAddress, OrderStatus, SellerOrderStatus } from '../domain/order';

const include = { sellerOrders: { include: { lines: { orderBy: { position: 'asc' } } }, orderBy: { position: 'asc' } } } as const;
type Row = Prisma.OrderGetPayload<{ include: typeof include }>;

function toOrder(row: Row): Order {
  const money = (minor: bigint) => Money.of(minor, row.currency);
  return Order.rehydrate({
    id: row.id,
    number: row.number,
    checkoutId: row.checkoutId,
    paymentId: row.paymentId,
    customerId: row.customerId,
    status: row.status as OrderStatus,
    address: row.shippingAddress as unknown as OrderAddress,
    subtotal: money(row.subtotalMinor),
    delivery: money(row.deliveryMinor),
    total: money(row.totalMinor),
    sellerOrders: row.sellerOrders.map((seller) => ({
      id: seller.id,
      sellerId: seller.sellerId,
      status: seller.status as SellerOrderStatus,
      lines: seller.lines.map((line) => ({
        id: line.id,
        listingId: line.listingId,
        variantId: line.variantId,
        sku: line.sku,
        productName: line.productName,
        options: line.options as Record<string, string>,
        quantity: line.quantity,
        unitPrice: money(line.unitPriceMinor),
        lineTotal: money(line.lineTotalMinor),
      })),
    })),
    placedAt: row.placedAt,
    cancellation:
      row.cancelledAt && row.cancelledBy && row.cancellationReason
        ? { at: row.cancelledAt, by: row.cancelledBy, reason: row.cancellationReason }
        : null,
    version: row.version,
  });
}

export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async nextNumber(): Promise<string> {
    const [row] = await this.prisma.$queryRaw<{ n: bigint }[]>`SELECT nextval('"orders"."order_number_seq"') AS n`;
    return row!.n.toString();
  }

  async insert(order: Order): Promise<boolean> {
    const state = order.snapshot;
    const events = order.pullEvents();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.order.create({
          data: {
            id: state.id,
            number: state.number,
            checkoutId: state.checkoutId,
            paymentId: state.paymentId,
            customerId: state.customerId,
            status: state.status,
            currency: state.total.currency,
            subtotalMinor: state.subtotal.minor,
            deliveryMinor: state.delivery.minor,
            totalMinor: state.total.minor,
            shippingAddress: state.address as unknown as Prisma.InputJsonObject,
            placedAt: state.placedAt,
            version: 1,
            sellerOrders: {
              create: state.sellerOrders.map((seller, sellerPosition) => ({
                id: seller.id,
                position: sellerPosition,
                sellerId: seller.sellerId,
                status: seller.status,
                lines: {
                  create: seller.lines.map((line, position) => ({
                    id: line.id,
                    position,
                    listingId: line.listingId,
                    variantId: line.variantId,
                    sku: line.sku,
                    productName: line.productName,
                    options: line.options as Prisma.InputJsonObject,
                    quantity: line.quantity,
                    unitPriceMinor: line.unitPrice.minor,
                    lineTotalMinor: line.lineTotal.minor,
                  })),
                },
              })),
            },
          },
        });
        await appendToOutbox(tx, events);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') return false;
      throw error;
    }
    order.markSaved();
    return true;
  }

  async findById(id: string): Promise<Order | null> {
    const row = await this.prisma.order.findUnique({ where: { id }, include });
    return row ? toOrder(row) : null;
  }

  async findBySellerOrder(sellerOrderId: string): Promise<Order | null> {
    const row = await this.prisma.order.findFirst({ where: { sellerOrders: { some: { id: sellerOrderId } } }, include });
    return row ? toOrder(row) : null;
  }

  async findBySellerOrders(sellerOrderIds: readonly string[]): Promise<Order[]> {
    if (sellerOrderIds.length === 0) return [];
    const rows = await this.prisma.order.findMany({ where: { sellerOrders: { some: { id: { in: [...sellerOrderIds] } } } }, include });
    return rows.map(toOrder);
  }

  async save(order: Order, audit?: AuditEntry): Promise<void> {
    const state = order.snapshot;
    const events = order.pullEvents();
    await this.prisma.$transaction(async (tx) => {
      const { count } = await tx.order.updateMany({
        where: { id: state.id, version: state.version },
        data: {
          status: state.status,
          cancelledAt: state.cancellation?.at ?? null,
          cancelledBy: state.cancellation?.by ?? null,
          cancellationReason: state.cancellation?.reason ?? null,
          version: { increment: 1 },
        },
      });
      if (count !== 1) throw new ConcurrencyConflict('Order', state.id);
      for (const seller of state.sellerOrders) {
        await tx.sellerOrder.update({ where: { id: seller.id }, data: { status: seller.status } });
      }
      if (audit) await appendAudit(tx, audit);
      await appendToOutbox(tx, events);
    });
    order.markSaved();
  }

  async findByCheckout(checkoutId: string): Promise<Order | null> {
    const row = await this.prisma.order.findUnique({ where: { checkoutId }, include });
    return row ? toOrder(row) : null;
  }

  async listForCustomer(customerId: string, limit: number): Promise<Order[]> {
    const rows = await this.prisma.order.findMany({ where: { customerId }, include, orderBy: { placedAt: 'desc' }, take: limit });
    return rows.map(toOrder);
  }

  async listRecent(limit: number, filter: OrderFilter): Promise<Order[]> {
    const owed = filter.owedRefund ? (await this.prisma.$queryRaw<{ id: string }[]>(OWED_REFUND)).map((row) => row.id) : null;
    const rows = await this.prisma.order.findMany({
      where: {
        ...(owed ? { id: { in: owed } } : {}),
        ...(filter.status ? { status: filter.status } : {}),
        ...(filter.number ? { number: filter.number } : {}),
        ...(filter.toSend ? TO_SEND : {}),
      },
      include,
      orderBy: { placedAt: 'desc' },
      take: limit,
    });
    return rows.map(toOrder);
  }

  async countByStatus(): Promise<Record<string, number>> {
    const rows = await this.prisma.order.groupBy({ by: ['status'], _count: { _all: true } });
    return Object.fromEntries(rows.map((row) => [row.status, row._count._all]));
  }

  countToSend(): Promise<number> {
    return this.prisma.order.count({ where: TO_SEND });
  }

  async countOwedRefund(): Promise<number> {
    const [row] = await this.prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(*) AS n FROM (${OWED_REFUND}) owed`;
    return Number(row?.n ?? 0n);
  }

  async recordRefund(paymentId: string, refundId: string, amountMinor: bigint, at: Date): Promise<boolean> {
    const order = await this.prisma.order.findFirst({ where: { paymentId }, select: { id: true } });
    if (!order) return false;
    const inserted = await this.prisma.$executeRaw`
      INSERT INTO "orders"."order_refunds" ("refundId", "orderId", "amountMinor", "refundedAt")
      VALUES (${refundId}::uuid, ${order.id}::uuid, ${amountMinor}, ${at})
      ON CONFLICT ("refundId") DO NOTHING`;
    return inserted === 1;
  }

  async refundedMinor(orderId: string): Promise<bigint> {
    const total = await this.prisma.orderRefund.aggregate({ where: { orderId }, _sum: { amountMinor: true } });
    return total._sum.amountMinor ?? 0n;
  }
}
