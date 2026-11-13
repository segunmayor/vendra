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
 * Records money returned to a customer: the reverse of a payment received. Posting twice for
 * one refund is a no-op.
 */
export class PostRefundPaid {
  constructor(
    private readonly journal: JournalRepository,
    private readonly settings: SettingsReader,
    private readonly ids: { uuid(): string },
  ) {}

  async execute(refundId: string, amount: Money, postedAt: Date): Promise<'posted' | 'duplicate'> {
    const [clearing, prepayments] = await this.settings.getMany(['payments.ledgerClearingAccount', 'payments.ledgerPrepaymentAccount'] as const);
    const entry = JournalEntry.post({
      id: this.ids.uuid(),
      sourceType: 'refund_paid',
      sourceId: refundId,
      postedAt,
      lines: [
        { accountCode: prepayments, side: 'debit', amount },
        { accountCode: clearing, side: 'credit', amount },
      ],
    });
    return this.journal.append(entry);
  }
}

/**
 * Records a delivered order: Vendra no longer owes the customer their prepayment (debit), and
 * has earned the item prices and the delivery charge (credits). Posting twice for one order is a
 * no-op.
 */
export class PostOrderDelivered {
  constructor(
    private readonly journal: JournalRepository,
    private readonly settings: SettingsReader,
    private readonly ids: { uuid(): string },
  ) {}

  async execute(orderId: string, amounts: { subtotal: Money; delivery: Money }, postedAt: Date): Promise<'posted' | 'duplicate'> {
    const [prepayments, sales, deliveryIncome] = await this.settings.getMany(['payments.ledgerPrepaymentAccount', 'payments.ledgerSalesAccount', 'payments.ledgerDeliveryIncomeAccount'] as const);
    const total = amounts.subtotal.add(amounts.delivery);
    const credits = [
      { accountCode: sales, side: 'credit' as const, amount: amounts.subtotal },
      { accountCode: deliveryIncome, side: 'credit' as const, amount: amounts.delivery },
    ].filter((line) => line.amount.isPositive());
    const entry = JournalEntry.post({
      id: this.ids.uuid(),
      sourceType: 'order_delivered',
      sourceId: orderId,
      postedAt,
      lines: [{ accountCode: prepayments, side: 'debit', amount: total }, ...credits],
    });
    return this.journal.append(entry);
  }
}
