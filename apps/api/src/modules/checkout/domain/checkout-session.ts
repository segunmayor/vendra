import { DomainError, isNigerianState, Money } from '../../../shared-kernel';

export type CheckoutStatus = 'awaiting_payment' | 'cancelled' | 'expired' | 'paid';

export interface DeliveryAddress {
  readonly recipient: string;
  /** Normalised to +234XXXXXXXXXX. */
  readonly phone: string;
  readonly line1: string;
  readonly line2: string | null;
  readonly city: string;
  readonly state: string;
}

export interface CheckoutLine {
  readonly listingId: string;
  readonly variantId: string;
  readonly sku: string;
  readonly productName: string;
  readonly options: Readonly<Record<string, string>>;
  readonly unitPrice: Money;
  readonly quantity: number;
  readonly lineTotal: Money;
}

export interface CheckoutSessionState {
  readonly id: string;
  readonly customerId: string;
  readonly idempotencyKey: string;
  readonly status: CheckoutStatus;
  readonly lines: readonly CheckoutLine[];
  readonly address: DeliveryAddress;
  readonly subtotal: Money;
  readonly delivery: Money;
  readonly total: Money;
  readonly weightGrams: number;
  readonly expiresAt: Date;
  readonly version: number;
  readonly paymentId?: string | null;
  /** Paid, but the stock could not be secured (the hold had lapsed and the items sold). Needs a refund. */
  readonly stockIssue?: boolean;
}

const PHONE = /^(?:\+?234|0)([789][01]\d{8})$/;

function text(value: string | null | undefined, label: string, min: number, max: number): string {
  const trimmed = (value ?? '').replace(/\s+/g, ' ').trim();
  if (trimmed.length < min || trimmed.length > max) {
    throw new DomainError('checkout.invalid_address', `${label} must be ${min} to ${max} characters`);
  }
  return trimmed;
}

/** Validates a Nigerian delivery address. The portal checks the same rules for quick feedback. */
export function parseAddress(input: {
  recipient: string;
  phone: string;
  line1: string;
  line2?: string | null;
  city: string;
  state: string;
}): DeliveryAddress {
  const phone = PHONE.exec(input.phone.replace(/[\s-]/g, ''));
  if (!phone) throw new DomainError('checkout.invalid_phone', 'Enter a Nigerian mobile number, such as 0803 123 4567');
  if (!isNigerianState(input.state)) throw new DomainError('checkout.invalid_state', 'Choose a state');
  const line2 = (input.line2 ?? '').trim();
  return {
    recipient: text(input.recipient, 'Recipient name', 2, 100),
    phone: `+234${phone[1]}`,
    line1: text(input.line1, 'Street address', 3, 200),
    line2: line2 ? text(line2, 'Address line 2', 1, 200) : null,
    city: text(input.city, 'City or town', 2, 100),
    state: input.state,
  };
}

/** A basket priced and held for payment. Prices are fixed here, so a later price change cannot alter what the customer agreed to pay. */
export class CheckoutSession {
  private constructor(private state: CheckoutSessionState) {}

  static open(input: Omit<CheckoutSessionState, 'status' | 'version' | 'subtotal' | 'total'>): CheckoutSession {
    if (input.lines.length === 0) throw new DomainError('checkout.empty', 'Your basket is empty');
    for (const line of input.lines) {
      if (!line.lineTotal.equals(line.unitPrice.times(line.quantity))) {
        throw new DomainError('checkout.line_mismatch', `Line total does not match for ${line.sku}`);
      }
    }
    const subtotal = input.lines.reduce((sum, line) => sum.add(line.lineTotal), Money.zero(input.delivery.currency));
    if (!subtotal.isPositive()) throw new DomainError('checkout.empty', 'Your basket is empty');
    if (input.delivery.minor < 0n) throw new DomainError('checkout.invalid_delivery', 'Delivery cannot be negative');
    return new CheckoutSession({
      ...input,
      status: 'awaiting_payment',
      subtotal,
      total: subtotal.add(input.delivery),
      version: 0,
      paymentId: null,
      stockIssue: false,
    });
  }

  static rehydrate(state: CheckoutSessionState): CheckoutSession {
    return new CheckoutSession(state);
  }

  get snapshot(): CheckoutSessionState {
    return this.state;
  }

  /** Expiry is read from the clock, so a session is never shown as payable after its stock hold lapsed. */
  statusAt(now: Date): CheckoutStatus {
    return this.state.status === 'awaiting_payment' && now >= this.state.expiresAt ? 'expired' : this.state.status;
  }

  isOpenAt(now: Date): boolean {
    return this.statusAt(now) === 'awaiting_payment';
  }

  /** Returns true if this changed the session. Cancelling twice, or after expiry, is a no-op. */
  cancel(now: Date): boolean {
    const status = this.statusAt(now);
    if (status === 'paid') throw new DomainError('checkout.already_paid', 'This order has been paid and cannot be cancelled here');
    if (status !== 'awaiting_payment') return false;
    this.state = { ...this.state, status: 'cancelled' };
    return true;
  }

  /**
   * Records a verified payment. Money has been taken, so this is accepted even if the session
   * expired or was cancelled meanwhile. Returns false if it was already paid.
   */
  markPaid(paymentId: string, stockIssue: boolean): boolean {
    if (this.state.status === 'paid') return false;
    this.state = { ...this.state, status: 'paid', paymentId, stockIssue };
    return true;
  }

  markSaved(): void {
    this.state = { ...this.state, version: this.state.version + 1 };
  }
}
