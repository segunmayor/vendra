import { Prisma, type PrismaClient } from '@prisma/client';
import { appendToOutbox } from '../../../platform/outbox/outbox';
import { Money } from '../../../shared-kernel';
import { OrderRepository } from '../application/orders.service';
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

  async findByCheckout(checkoutId: string): Promise<Order | null> {
    const row = await this.prisma.order.findUnique({ where: { checkoutId }, include });
    return row ? toOrder(row) : null;
  }

  async listForCustomer(customerId: string, limit: number): Promise<Order[]> {
    const rows = await this.prisma.order.findMany({ where: { customerId }, include, orderBy: { placedAt: 'desc' }, take: limit });
    return rows.map(toOrder);
  }

  async listRecent(limit: number, filter: { status?: OrderStatus; number?: string }): Promise<Order[]> {
    const rows = await this.prisma.order.findMany({
      where: { ...(filter.status ? { status: filter.status } : {}), ...(filter.number ? { number: filter.number } : {}) },
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
}
