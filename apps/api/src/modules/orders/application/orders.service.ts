import { ApplicationError, Principal } from '../../../shared-kernel';
import { CheckoutService, PaidCheckout } from '../../checkout';
import { ListingQueries } from '../../listings';
import { Order, OrderStatus } from '../domain/order';

export interface OrderRepository {
  /** A new order number, unique and never reused. */
  nextNumber(): Promise<string>;
  /** Saves the order and its events. Returns false if an order already exists for its checkout. */
  insert(order: Order): Promise<boolean>;
  findById(id: string): Promise<Order | null>;
  findByCheckout(checkoutId: string): Promise<Order | null>;
  listForCustomer(customerId: string, limit: number): Promise<Order[]>;
  listRecent(limit: number, filter: { status?: OrderStatus; number?: string }): Promise<Order[]>;
  countByStatus(): Promise<Record<string, number>>;
}

export interface CustomerDirectory {
  emailOf(accountId: string): Promise<string | null>;
}

type Checkouts = Pick<CheckoutService, 'paidCheckout'>;
type Listings = Pick<ListingQueries, 'getOffers'>;

const notFound = () => new ApplicationError('not_found', 'order.not_found', 'Order not found');

export class OrderService {
  constructor(
    private readonly orders: OrderRepository,
    private readonly checkouts: Checkouts,
    private readonly listings: Listings,
    private readonly customers: CustomerDirectory,
    private readonly ids: { uuid(): string },
    private readonly clock: { now(): Date },
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

  list(filter: { status?: OrderStatus; number?: string }): Promise<Order[]> {
    return this.orders.listRecent(100, filter);
  }

  async get(id: string): Promise<{ order: Order; customerEmail: string | null }> {
    const order = await this.orders.findById(id);
    if (!order) throw notFound();
    return { order, customerEmail: await this.customers.emailOf(order.snapshot.customerId) };
  }

  /** How many orders are in each status, for the staff dashboard. */
  counts(): Promise<Record<string, number>> {
    return this.orders.countByStatus();
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
export type { OrderStatus } from '../domain/order';
