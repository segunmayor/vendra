import { DomainError, Money } from '../../../shared-kernel';

export interface JournalLine {
  readonly accountCode: string;
  readonly side: 'debit' | 'credit';
  readonly amount: Money;
}

/** An immutable double-entry record. It cannot exist unless it balances. */
export class JournalEntry {
  private constructor(
    readonly id: string,
    readonly sourceType: string,
    readonly sourceId: string,
    readonly postedAt: Date,
    readonly lines: readonly JournalLine[],
    /** The customer payment this entry concerns, when there is one. */
    readonly paymentId: string | null = null,
  ) {}

  static post(input: {
    id: string;
    sourceType: string;
    sourceId: string;
    postedAt: Date;
    lines: readonly JournalLine[];
    paymentId?: string | null;
  }): JournalEntry {
    const { lines } = input;
    const first = lines[0];
    if (!first || lines.length < 2) {
      throw new DomainError('ledger.too_few_lines', 'An entry needs at least two lines');
    }
    if (lines.some((line) => !line.amount.isPositive())) {
      throw new DomainError('ledger.invalid_amount', 'Line amounts must be positive');
    }
    const currency = first.amount.currency;
    if (lines.some((line) => line.amount.currency !== currency)) {
      throw new DomainError('ledger.mixed_currency', 'An entry must use one currency');
    }
    const total = (side: JournalLine['side']): Money =>
      lines
        .filter((line) => line.side === side)
        .reduce((sum, line) => sum.add(line.amount), Money.zero(currency));
    if (!total('debit').equals(total('credit'))) {
      throw new DomainError('ledger.unbalanced', 'Debits must equal credits');
    }
    return new JournalEntry(input.id, input.sourceType, input.sourceId, input.postedAt, [...lines], input.paymentId ?? null);
  }

  /** Corrections are new entries with sides swapped. Entries are never edited. */
  reverse(id: string, postedAt: Date): JournalEntry {
    return JournalEntry.post({
      id,
      sourceType: 'reversal',
      sourceId: this.id,
      postedAt,
      paymentId: this.paymentId,
      lines: this.lines.map((line) => ({
        ...line,
        side: line.side === 'debit' ? 'credit' : 'debit',
      })),
    });
  }
}
