import { ApplicationError, DomainError, Money, Principal } from '../../../shared-kernel';
import { CartPricing, CartService, CURRENCY } from '../../cart';
import { InventoryCommands, RESERVATION_MINUTES } from '../../inventory';
import { LogisticsService } from '../../logistics';
import { CheckoutLine, CheckoutSession, DeliveryAddress, parseAddress } from '../domain/checkout-session';

export interface CheckoutRepository {
  findById(id: string): Promise<CheckoutSession | null>;
  findByKey(customerId: string, idempotencyKey: string): Promise<CheckoutSession | null>;
  listOpen(customerId: string, now: Date): Promise<CheckoutSession[]>;
  latest(customerId: string): Promise<CheckoutSession | null>;
  /** Throws DuplicateCheckout when this customer already used the idempotency key. */
  insert(session: CheckoutSession): Promise<void>;
  /** Throws ConcurrencyConflict if the session changed since it was read. */
  update(session: CheckoutSession): Promise<void>;
}

export class DuplicateCheckout extends Error {}

export type AddressInput = Parameters<typeof parseAddress>[0];

export interface DeliveryPreview {
  readonly subtotal: Money;
  readonly delivery: Money | null;
  readonly total: Money | null;
  /** Why delivery cannot be quoted, in words for the customer. */
  readonly problem: string | null;
}

const notFound = () => new ApplicationError('not_found', 'checkout.not_found', 'Checkout not found');

export class CheckoutService {
  constructor(
    private readonly sessions: CheckoutRepository,
    private readonly carts: CartService,
    private readonly pricing: CartPricing,
    private readonly logistics: LogisticsService,
    private readonly inventory: InventoryCommands,
    private readonly ids: { uuid(): string },
    private readonly clock: { now(): Date },
  ) {}

  /** The delivery fee and total for the customer's basket, before anything is reserved. */
  async preview(principal: Principal, state: string): Promise<DeliveryPreview> {
    const priced = await this.pricing.price(await this.carts.linesOf(principal.accountId));
    const quote = await this.logistics.quote(state, priced.weightGrams);
    if (!quote.ok) return { subtotal: priced.subtotal, delivery: null, total: null, problem: this.deliveryProblem(quote.reason, state) };
    return { subtotal: priced.subtotal, delivery: quote.price, total: priced.subtotal.add(quote.price), problem: null };
  }

  /**
   * Prices the basket, quotes delivery and reserves stock, all or nothing. Repeating the
   * request with the same Idempotency-Key returns the same session and reserves nothing more.
   */
  async start(principal: Principal, idempotencyKey: string, addressInput: AddressInput): Promise<CheckoutSession> {
    const customerId = principal.accountId;
    const repeat = await this.sessions.findByKey(customerId, idempotencyKey);
    if (repeat) return repeat;

    const address = parseAddress(addressInput);
    const lines = await this.carts.linesOf(customerId);
    if (lines.length === 0) throw new ApplicationError('conflict', 'checkout.empty_cart', 'Your basket is empty');
    const priced = await this.pricing.price(lines);
    if (!priced.canCheckout) {
      throw new ApplicationError('conflict', 'checkout.cart_needs_attention', 'Some items in your basket have changed. Review your basket, then try again.');
    }
    const quote = await this.logistics.quote(address.state, priced.weightGrams);
    if (!quote.ok) throw new DomainError('checkout.no_delivery', this.deliveryProblem(quote.reason, address.state));

    // One open checkout per customer, so nobody can hold stock in several at once.
    const sameKey = await this.cancelOpen(customerId, idempotencyKey);
    if (sameKey) return sameKey;

    const now = this.clock.now();
    const session = CheckoutSession.open({
      id: this.ids.uuid(),
      customerId,
      idempotencyKey,
      address,
      delivery: quote.price,
      weightGrams: priced.weightGrams,
      expiresAt: new Date(now.getTime() + RESERVATION_MINUTES * 60_000),
      lines: priced.lines.map(
        (line): CheckoutLine => ({
          listingId: line.listingId,
          variantId: line.variantId!,
          sku: line.sku!,
          productName: line.productName,
          options: line.options,
          unitPrice: line.unitPrice!,
          quantity: line.quantity,
          lineTotal: line.lineTotal!,
        }),
      ),
    });

    const { snapshot } = session;
    await this.inventory.reserve(
      snapshot.id,
      snapshot.lines.map((line) => ({ listingId: line.listingId, quantity: line.quantity })),
      snapshot.expiresAt,
    );
    try {
      await this.sessions.insert(session);
    } catch (error) {
      await this.inventory.release(snapshot.id);
      // A concurrent request with the same key got there first; return its session.
      if (error instanceof DuplicateCheckout) {
        const winner = await this.sessions.findByKey(customerId, idempotencyKey);
        if (winner) return winner;
      }
      throw error;
    }
    return session;
  }

  async get(principal: Principal, id: string): Promise<CheckoutSession> {
    const session = await this.sessions.findById(id);
    // Someone else's checkout is reported as missing, so ids cannot be probed.
    if (!session || session.snapshot.customerId !== principal.accountId) throw notFound();
    return session;
  }

  async cancel(principal: Principal, id: string): Promise<CheckoutSession> {
    const session = await this.get(principal, id);
    if (session.cancel(this.clock.now())) await this.sessions.update(session);
    await this.inventory.release(id);
    return session;
  }

  /** The address used most recently, to prefill the next checkout. */
  async lastAddress(principal: Principal): Promise<DeliveryAddress | null> {
    return (await this.sessions.latest(principal.accountId))?.snapshot.address ?? null;
  }

  now(): Date {
    return this.clock.now();
  }

  /**
   * Cancels the customer's other open checkouts. If a concurrent request with the same key
   * has meanwhile created its session, that session is left alone and returned instead.
   */
  private async cancelOpen(customerId: string, idempotencyKey: string): Promise<CheckoutSession | null> {
    const now = this.clock.now();
    const open = await this.sessions.listOpen(customerId, now);
    const sameKey = open.find((session) => session.snapshot.idempotencyKey === idempotencyKey);
    if (sameKey) return sameKey;
    for (const session of open) {
      if (session.cancel(now)) await this.sessions.update(session);
      await this.inventory.release(session.snapshot.id);
    }
    return null;
  }

  private deliveryProblem(reason: 'no_zone' | 'too_heavy', state: string): string {
    return reason === 'no_zone'
      ? `We do not deliver to ${state} yet`
      : 'This order is too heavy for a single delivery. Remove some items or split it into two orders.';
  }
}

export { CURRENCY };
export { CheckoutSession } from '../domain/checkout-session';
export type { CheckoutStatus, DeliveryAddress } from '../domain/checkout-session';
