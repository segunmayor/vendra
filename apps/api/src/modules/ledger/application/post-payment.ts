import { Money } from '../../../shared-kernel';
import { SettingsReader } from '../../settings';
import { JournalEntry } from '../domain/journal-entry';
import { JournalRepository } from './ports';

/**
 * Records a verified customer payment: money now held by the gateway (debit) against what
 * Vendra owes the customer until the order is delivered (credit). The accounts are settings.
 * Posting twice for one payment is a no-op.
 */
export class PostPaymentReceived {
  constructor(
    private readonly journal: JournalRepository,
    private readonly settings: SettingsReader,
    private readonly ids: { uuid(): string },
  ) {}

  async execute(paymentId: string, amount: Money, postedAt: Date): Promise<'posted' | 'duplicate'> {
    const [clearing, prepayments] = await this.settings.getMany(['payments.ledgerClearingAccount', 'payments.ledgerPrepaymentAccount'] as const);
    const entry = JournalEntry.post({
      id: this.ids.uuid(),
      sourceType: 'payment_received',
      sourceId: paymentId,
      paymentId,
      postedAt,
      lines: [
        { accountCode: clearing, side: 'debit', amount },
        { accountCode: prepayments, side: 'credit', amount },
      ],
    });
    return this.journal.append(entry);
  }
}

/**
 * Records money returned to a customer. Whatever part of the payment is still held as a
 * prepayment comes out of it (the order was not delivered, so nothing was earned yet). Any
 * part beyond that was already recognised as a sale on delivery, so it is debited to the
 * refunds-after-delivery account instead. Posting twice for one refund is a no-op.
 */
export class PostRefundPaid {
  constructor(
    private readonly journal: JournalRepository,
    private readonly settings: SettingsReader,
    private readonly ids: { uuid(): string },
  ) {}

  async execute(refundId: string, paymentId: string, amount: Money, postedAt: Date): Promise<'posted' | 'duplicate'> {
    const [clearing, prepayments, refunds] = await this.settings.getMany([
      'payments.ledgerClearingAccount',
      'payments.ledgerPrepaymentAccount',
      'payments.ledgerRefundsAfterDeliveryAccount',
    ] as const);
    const held = clamp(await this.journal.balanceFor(paymentId, prepayments), amount.minor);
    const debits = [
      { accountCode: prepayments, side: 'debit' as const, amount: Money.of(held, amount.currency) },
      { accountCode: refunds, side: 'debit' as const, amount: Money.of(amount.minor - held, amount.currency) },
    ].filter((line) => line.amount.isPositive());
    const entry = JournalEntry.post({
      id: this.ids.uuid(),
      sourceType: 'refund_paid',
      sourceId: refundId,
      paymentId,
      postedAt,
      lines: [...debits, { accountCode: clearing, side: 'credit', amount }],
    });
    return this.journal.append(entry);
  }
}

/**
 * Records a delivered order: Vendra no longer owes the customer what it still holds of their
 * prepayment (debit), and has earned it (credits: the delivery charge first, the rest as
 * sales). After a partial refund only what is left is recognised; after a full refund there
 * is nothing to record. Posting twice for one order is a no-op.
 */
export class PostOrderDelivered {
  constructor(
    private readonly journal: JournalRepository,
    private readonly settings: SettingsReader,
    private readonly ids: { uuid(): string },
  ) {}

  async execute(orderId: string, paymentId: string, amounts: { subtotal: Money; delivery: Money }, postedAt: Date): Promise<'posted' | 'duplicate' | 'nothing_held'> {
    const [prepayments, sales, deliveryIncome] = await this.settings.getMany(['payments.ledgerPrepaymentAccount', 'payments.ledgerSalesAccount', 'payments.ledgerDeliveryIncomeAccount'] as const);
    const currency = amounts.subtotal.currency;
    const total = amounts.subtotal.add(amounts.delivery).minor;
    const held = clamp(await this.journal.balanceFor(paymentId, prepayments), total);
    if (held === 0n) return 'nothing_held';
    const delivery = clamp(amounts.delivery.minor, held);
    const credits = [
      { accountCode: sales, side: 'credit' as const, amount: Money.of(held - delivery, currency) },
      { accountCode: deliveryIncome, side: 'credit' as const, amount: Money.of(delivery, currency) },
    ].filter((line) => line.amount.isPositive());
    const entry = JournalEntry.post({
      id: this.ids.uuid(),
      sourceType: 'order_delivered',
      sourceId: orderId,
      paymentId,
      postedAt,
      lines: [{ accountCode: prepayments, side: 'debit', amount: Money.of(held, currency) }, ...credits],
    });
    return this.journal.append(entry);
  }
}

/** `value` limited to 0..`max`. */
function clamp(value: bigint, max: bigint): bigint {
  return value < 0n ? 0n : value > max ? max : value;
}
