import { ApplicationError, AuditEntry, ConcurrencyConflict, Principal } from '../../../shared-kernel';
import { CheckoutService, PaidCheckout } from '../../checkout';
import { ListingQueries } from '../../listings';
import { Order, OrderAddress, OrderStatus, SellerOrderStatus, ShipmentProgress } from '../domain/order';

export interface OrderRepository {
  /** A new order number, unique and never reused. */
  nextNumber(): Promise<string>;
  /** Saves the order and its events. Returns false if an order already exists for its checkout. */
  insert(order: Order): Promise<boolean>;
  findById(id: string): Promise<Order | null>;
  findByCheckout(checkoutId: string): Promise<Order | null>;
  findBySellerOrder(sellerOrderId: string): Promise<Order | null>;
  findBySellerOrders(sellerOrderIds: readonly string[]): Promise<Order[]>;
  /** Saves status changes, events and the audit entry. Throws ConcurrencyConflict on a stale version. */
  save(order: Order, audit?: AuditEntry): Promise<void>;
  listForCustomer(customerId: string, limit: number): Promise<Order[]>;
  listRecent(limit: number, filter: OrderFilter): Promise<Order[]>;
  countByStatus(): Promise<Record<string, number>>;
  /** Paid orders with items not yet handed to a courier. */
  countToSend(): Promise<number>;
}

export interface OrderFilter {
  readonly status?: OrderStatus;
  readonly number?: string;
  /** Only paid orders with items not yet handed to a courier. */
  readonly toSend?: boolean;
}

export interface CustomerDirectory {
  emailOf(accountId: string): Promise<string | null>;
}

type Checkouts = Pick<CheckoutService, 'paidCheckout'>;
type Listings = Pick<ListingQueries, 'getOffers'>;

const notFound = () => new ApplicationError('not_found', 'order.not_found', 'Order not found');
const changed = () => new ApplicationError('conflict', 'order.changed', 'This order has just changed. Reload to see it as it is now.');

export class OrderService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly checkouts: Checkouts,
    private readonly listings: Listings,
    private readonly customers: CustomerDirectory,
    private readonly ids: { uuid(): string },
    private readonly clock: { now(): Date },
    /** Delivers committed events at once, so stock is back on sale when staff look. */
    private readonly deliver: () => Promise<void> = async () => undefined,
  ) {}

  /**
   * Places the order for a paid checkout. Safe to call again: a checkout has at most one order.
   * Called when checkout reports the payment, so stock has already been committed (or the
   * shortfall recorded as a stock issue).
   */
  async placeFromCheckout(checkoutId: string): Promise<Order> {
    const existing = await this.orders.findByCheckout(checkoutId);
    if (existing) return existing;
    const checkout = await this.checkouts.paidCheckout(checkoutId);
    if (!checkout) throw new Error(`Checkout ${checkoutId} is not paid, so no order can be placed`);

    const order = Order.place({
      id: this.ids.uuid(),
      number: await this.orders.nextNumber(),
      checkoutId: checkout.id,
      paymentId: checkout.paymentId,
      customerId: checkout.customerId,
      address: checkout.address,
      subtotal: checkout.subtotal,
      delivery: checkout.delivery,
      total: checkout.total,
      stockIssue: checkout.stockIssue,
      lines: await this.linesWithSellers(checkout),
      newId: () => this.ids.uuid(),
      now: this.clock.now(),
    });
    if (await this.orders.insert(order)) return order;
    // Placed by a concurrent delivery of the same event.
    return (await this.orders.findByCheckout(checkoutId)) ?? order;
  }

  // ---- customers: only their own orders ----

  listMine(principal: Principal): Promise<Order[]> {
    return this.orders.listForCustomer(principal.accountId, 100);
  }

  async getMine(principal: Principal, id: string): Promise<Order> {
    const order = await this.orders.findById(id);
    if (!order || order.snapshot.customerId !== principal.accountId) throw notFound();
    return order;
  }

  /** For the page customers return to after paying. */
  async getMineByCheckout(principal: Principal, checkoutId: string): Promise<Order> {
    const order = await this.orders.findByCheckout(checkoutId);
    if (!order || order.snapshot.customerId !== principal.accountId) throw notFound();
    return order;
  }

  // ---- staff ----

  list(filter: OrderFilter): Promise<Order[]> {
    return this.orders.listRecent(100, filter);
  }

  async get(id: string): Promise<{ order: Order; customerEmail: string | null }> {
    const order = await this.orders.findById(id);
    if (!order) throw notFound();
    return { order, customerEmail: await this.customers.emailOf(order.snapshot.customerId) };
  }

  /** For shipping: what one seller must send, and where. */
  async sellerOrder(sellerOrderId: string): Promise<SellerOrderContext | null> {
    const order = await this.orders.findBySellerOrder(sellerOrderId);
    return order ? context(order, sellerOrderId) : null;
  }

  /** Staff: every seller order of an order. */
  async sellerOrdersOf(orderId: string): Promise<SellerOrderContext[]> {
    const order = await this.orders.findById(orderId);
    if (!order) throw notFound();
    return order.snapshot.sellerOrders.map((seller) => context(order, seller.id));
  }

  /** Customers: the seller orders of their own order only. */
  async mySellerOrders(principal: Principal, orderId: string): Promise<SellerOrderContext[]> {
    const order = await this.getMine(principal, orderId);
    return order.snapshot.sellerOrders.map((seller) => context(order, seller.id));
  }

  async sellerOrders(sellerOrderIds: readonly string[]): Promise<SellerOrderContext[]> {
    const wanted = new Set(sellerOrderIds);
    return (await this.orders.findBySellerOrders([...wanted])).flatMap((order) =>
      order.snapshot.sellerOrders.filter((seller) => wanted.has(seller.id)).map((seller) => context(order, seller.id)),
    );
  }

  /**
   * Staff cancel an order before anything leaves with a courier. `version` is the one the
   * staff member was looking at, so a change they have not seen is never cancelled over.
   */
  async cancel(actor: Principal, id: string, reason: string, version?: number): Promise<Order> {
    const order = await this.orders.findById(id);
    if (!order) throw notFound();
    if (version !== undefined && version !== order.snapshot.version) throw changed();
    const before = order.snapshot.status;
    order.cancel(reason, actor.accountId, this.clock.now());
    try {
      await this.orders.save(order, {
        actorId: actor.accountId,
        action: 'orders.cancelled',
        targetType: 'order',
        targetId: id,
        before: { status: before },
        after: { status: 'cancelled', reason: order.snapshot.cancellation!.reason },
      });
    } catch (error) {
      if (error instanceof ConcurrencyConflict) throw changed();
      throw error;
    }
    await this.deliver();
    return order;
  }

  /** Throws a DomainError explaining why these items cannot be sent now. */
  async assertShippable(sellerOrderId: string): Promise<void> {
    const order = await this.orders.findBySellerOrder(sellerOrderId);
    if (!order) throw notFound();
    order.assertShippable(sellerOrderId);
  }

  /** Shipping's progress, from the outbox. Safe to repeat and to receive late. */
  async applyShipmentStatus(sellerOrderId: string, progress: ShipmentProgress): Promise<void> {
    for (let attempt = 1; ; attempt++) {
      const order = await this.orders.findBySellerOrder(sellerOrderId);
      if (!order) throw new Error(`Seller order ${sellerOrderId} not found`);
      if (!order.applyShipmentStatus(sellerOrderId, progress, this.clock.now())) return;
      try {
        await this.orders.save(order);
        return;
      } catch (error) {
        if (!(error instanceof ConcurrencyConflict) || attempt >= 5) throw error;
      }
    }
  }

  /** How many orders are in each status, for the staff dashboard. */
  async counts(): Promise<{ byStatus: Record<string, number>; toSend: number }> {
    const [byStatus, toSend] = await Promise.all([this.orders.countByStatus(), this.orders.countToSend()]);
    return { byStatus, toSend };
  }

  private async linesWithSellers(checkout: PaidCheckout) {
    const sellers = new Map((await this.listings.getOffers([...new Set(checkout.lines.map((line) => line.listingId))])).map((offer) => [offer.id, offer.sellerId]));
    return checkout.lines.map((line) => {
      const sellerId = sellers.get(line.listingId);
      if (!sellerId) throw new Error(`Listing ${line.listingId} in checkout ${checkout.id} not found`);
      return {
        sellerId,
        listingId: line.listingId,
        variantId: line.variantId,
        sku: line.sku,
        productName: line.productName,
        options: line.options,
        quantity: line.quantity,
        unitPrice: line.unitPrice,
        lineTotal: line.lineTotal,
      };
    });
  }
}

export { Order } from '../domain/order';
export type { OrderStatus, ShipmentProgress } from '../domain/order';
export { CANCEL_REASON_MAX } from '../domain/order';

export interface SellerOrderContext {
  readonly orderId: string;
  readonly orderNumber: string;
  readonly orderStatus: OrderStatus;
  readonly customerId: string;
  readonly sellerOrderId: string;
  readonly sellerId: string;
  readonly status: SellerOrderStatus;
  readonly address: OrderAddress;
  readonly lines: readonly { readonly id: string; readonly productName: string; readonly sku: string; readonly quantity: number }[];
}

function context(order: Order, sellerOrderId: string): SellerOrderContext {
  const state = order.snapshot;
  const seller = state.sellerOrders.find((entry) => entry.id === sellerOrderId)!;
  return {
    orderId: state.id,
    orderNumber: state.number,
    orderStatus: state.status,
    customerId: state.customerId,
    sellerOrderId: seller.id,
    sellerId: seller.sellerId,
    status: seller.status,
    address: state.address,
    lines: seller.lines.map(({ id, productName, sku, quantity }) => ({ id, productName, sku, quantity })),
  };
}
