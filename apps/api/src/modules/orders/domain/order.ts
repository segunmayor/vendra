import { AggregateRoot, DomainError, Money } from '../../../shared-kernel';

/**
 * - placed: paid, waiting to be packed and sent.
 * - stock_issue: paid, but an item sold out before the payment arrived. Needs a refund.
 * - fulfilled: every seller order delivered.
 * - cancelled: staff cancelled it before anything left with a courier. Stock goes back on sale;
 *   the refund is a separate step, through the payment.
 */
export type OrderStatus = 'placed' | 'stock_issue' | 'cancelled' | 'fulfilled';
export type SellerOrderStatus = 'pending' | 'cancelled' | 'dispatched' | 'delivered';

export interface OrderAddress {
  readonly recipient: string;
  readonly phone: string;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly state: string;
}

export interface OrderLineState {
  readonly id: string;
  readonly listingId: string;
  readonly variantId: string;
  readonly sku: string;
  readonly productName: string;
  readonly options: Readonly<Record<string, string>>;
  readonly quantity: number;
  readonly unitPrice: Money;
  readonly lineTotal: Money;
}

/** What one seller must send. At launch the only seller is Vendra itself. */
export interface SellerOrderState {
  readonly id: string;
  readonly sellerId: string;
  readonly status: SellerOrderStatus;
  readonly lines: readonly OrderLineState[];
}

export interface OrderCancellation {
  readonly reason: string;
  readonly by: string;
  readonly at: Date;
}

export const CANCEL_REASON_MAX = 300;

export interface OrderState {
  readonly id: string;
  /** Short, for customers to quote on the phone. */
  readonly number: string;
  readonly checkoutId: string;
  readonly paymentId: string;
  readonly customerId: string;
  readonly status: OrderStatus;
  readonly address: OrderAddress;
  readonly subtotal: Money;
  readonly delivery: Money;
  readonly total: Money;
  readonly sellerOrders: readonly SellerOrderState[];
  readonly placedAt: Date;
  readonly cancellation: OrderCancellation | null;
  readonly version: number;
}

export interface PlaceOrderInput {
  readonly id: string;
  readonly number: string;
  readonly checkoutId: string;
  readonly paymentId: string;
  readonly customerId: string;
  readonly address: OrderAddress;
  readonly subtotal: Money;
  readonly delivery: Money;
  readonly total: Money;
  readonly stockIssue: boolean;
  readonly lines: readonly (Omit<OrderLineState, 'id'> & { readonly sellerId: string })[];
  readonly newId: () => string;
  readonly now: Date;
}

export class Order extends AggregateRoot {
  private constructor(private state: OrderState) {
    super();
  }

  /** An order is placed only from a paid checkout, at the prices the customer agreed to. */
  static place(input: PlaceOrderInput): Order {
    if (input.lines.length === 0) throw new DomainError('order.empty', 'An order needs at least one item');
    let subtotal = Money.zero(input.total.currency);
    for (const line of input.lines) {
      if (!Number.isSafeInteger(line.quantity) || line.quantity < 1) throw new DomainError('order.invalid_quantity', `Invalid quantity for ${line.sku}`);
      if (!line.lineTotal.equals(line.unitPrice.times(line.quantity))) throw new DomainError('order.line_mismatch', `Line total does not match for ${line.sku}`);
      subtotal = subtotal.add(line.lineTotal);
    }
    if (!subtotal.equals(input.subtotal) || !input.subtotal.add(input.delivery).equals(input.total)) {
      throw new DomainError('order.total_mismatch', 'Order totals do not add up');
    }

    // One seller order per seller, in the order their items first appear.
    const bySeller = new Map<string, OrderLineState[]>();
    for (const { sellerId, ...line } of input.lines) {
      const lines = bySeller.get(sellerId) ?? [];
      lines.push({ ...line, id: input.newId() });
      bySeller.set(sellerId, lines);
    }
    const order = new Order({
      id: input.id,
      number: input.number,
      checkoutId: input.checkoutId,
      paymentId: input.paymentId,
      customerId: input.customerId,
      status: input.stockIssue ? 'stock_issue' : 'placed',
      address: input.address,
      subtotal: input.subtotal,
      delivery: input.delivery,
      total: input.total,
      sellerOrders: [...bySeller].map(([sellerId, lines]) => ({ id: input.newId(), sellerId, status: 'pending', lines })),
      placedAt: input.now,
      cancellation: null,
      version: 0,
    });
    order.raise({
      type: 'OrderPlaced',
      aggregateId: input.id,
      occurredAt: input.now,
      payload: {
        orderId: input.id,
        number: input.number,
        customerId: input.customerId,
        checkoutId: input.checkoutId,
        totalMinor: input.total.minor.toString(),
        currency: input.total.currency,
        stockIssue: input.stockIssue,
      },
    });
    return order;
  }

  static rehydrate(state: OrderState): Order {
    return new Order(state);
  }

  get snapshot(): OrderState {
    return this.state;
  }

  get itemCount(): number {
    return this.state.sellerOrders.reduce((sum, seller) => sum + seller.lines.reduce((n, line) => n + line.quantity, 0), 0);
  }

  markSaved(): void {
    this.state = { ...this.state, version: this.state.version + 1 };
  }

  /**
   * Follows a seller order's delivery. Shipping sends these through the outbox, perhaps more
   * than once and late, so each is applied only when it moves things forward. Returns true if
   * anything changed. When every seller order is delivered, the order is fulfilled.
   */
  applyShipmentStatus(sellerOrderId: string, shipment: ShipmentProgress, now: Date): boolean {
    const seller = this.state.sellerOrders.find((entry) => entry.id === sellerOrderId);
    if (!seller) throw new DomainError('order.unknown_seller_order', 'This seller order is not part of the order');
    const next = nextSellerStatus(seller.status, shipment);
    if (next === seller.status) return false;

    const sellerOrders = this.state.sellerOrders.map((entry) => (entry.id === sellerOrderId ? { ...entry, status: next } : entry));
    const live = sellerOrders.filter((entry) => entry.status !== 'cancelled');
    const fulfilled = this.state.status === 'placed' && live.length > 0 && live.every((entry) => entry.status === 'delivered');
    this.state = { ...this.state, sellerOrders, status: fulfilled ? 'fulfilled' : this.state.status };
    if (fulfilled) {
      this.raise({
        type: 'OrderFulfilled',
        aggregateId: this.state.id,
        occurredAt: now,
        payload: {
          orderId: this.state.id,
          number: this.state.number,
          paymentId: this.state.paymentId,
          customerId: this.state.customerId,
          subtotalMinor: this.state.subtotal.minor.toString(),
          deliveryMinor: this.state.delivery.minor.toString(),
          totalMinor: this.state.total.minor.toString(),
          currency: this.state.total.currency,
        },
      });
    }
    return true;
  }

  /** Why this order cannot be cancelled now, or null if it can. */
  get cannotCancelBecause(): string | null {
    const { status, sellerOrders } = this.state;
    if (status === 'cancelled') return 'It is already cancelled';
    if (status === 'fulfilled') return 'It has been delivered. Refund the customer from the payment instead';
    if (sellerOrders.some((seller) => seller.status !== 'pending')) {
      return 'Items have already been collected by a courier. Wait until they are delivered or back at Vendra';
    }
    return null;
  }

  /**
   * Staff cancel an order before anything has left with a courier. Every seller order is
   * cancelled with it. Inventory puts sold stock back and shipping cancels any shipment still
   * waiting for collection, both from `OrderCancelled`. Money is refunded separately.
   */
  cancel(reason: string, actorId: string, now: Date): void {
    const why = reason.trim();
    if (why.length < 3) throw new DomainError('order.cancel_reason_required', 'Say why the order is being cancelled');
    if (why.length > CANCEL_REASON_MAX) throw new DomainError('order.cancel_reason_too_long', `Keep the reason under ${CANCEL_REASON_MAX} characters`);
    const blocked = this.cannotCancelBecause;
    if (blocked) throw new DomainError('order.not_cancellable', `This order cannot be cancelled. ${blocked}.`);

    const before = this.state.status;
    this.state = {
      ...this.state,
      status: 'cancelled',
      sellerOrders: this.state.sellerOrders.map((seller) => ({ ...seller, status: 'cancelled' })),
      cancellation: { reason: why, by: actorId, at: now },
    };
    this.raise({
      type: 'OrderCancelled',
      aggregateId: this.state.id,
      occurredAt: now,
      payload: {
        orderId: this.state.id,
        number: this.state.number,
        checkoutId: this.state.checkoutId,
        paymentId: this.state.paymentId,
        customerId: this.state.customerId,
        sellerOrderIds: this.state.sellerOrders.map((seller) => seller.id),
        // A stock issue order never took stock, so there is nothing to put back.
        stockTaken: before === 'placed',
        totalMinor: this.state.total.minor.toString(),
        currency: this.state.total.currency,
      },
    });
  }

  /** Only a paid order with secured stock can be sent. */
  assertShippable(sellerOrderId: string): void {
    if (this.state.status !== 'placed') {
      const why = this.state.status === 'stock_issue' ? 'it has a stock issue: refund it instead' : `it is ${this.state.status}`;
      throw new DomainError('order.not_shippable', `This order cannot be sent because ${why}`);
    }
    const seller = this.state.sellerOrders.find((entry) => entry.id === sellerOrderId);
    if (!seller) throw new DomainError('order.unknown_seller_order', 'This seller order is not part of the order');
    if (seller.status !== 'pending') throw new DomainError('order.already_sent', `These items are already ${seller.status}`);
  }
}

/** The shipment statuses that matter to an order. */
export type ShipmentProgress = 'dispatched' | 'delivered' | 'back_to_pending';

function nextSellerStatus(current: SellerOrderStatus, shipment: ShipmentProgress): SellerOrderStatus {
  if (current === 'delivered' || current === 'cancelled') return current;
  if (shipment === 'delivered') return 'delivered';
  if (shipment === 'dispatched') return current === 'pending' ? 'dispatched' : current;
  // A cancelled or returned shipment: the items are back with Vendra, ready to send again.
  return current === 'dispatched' ? 'pending' : current;
}
