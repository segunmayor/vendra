import { AggregateRoot, DomainError, Money } from '../../../shared-kernel';

/**
 * - placed: paid, waiting to be packed and sent.
 * - stock_issue: paid, but an item sold out before the payment arrived. Needs a refund.
 * - cancelled, fulfilled: set by later steps (staff cancellation, delivery).
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
}
