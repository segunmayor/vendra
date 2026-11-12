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
