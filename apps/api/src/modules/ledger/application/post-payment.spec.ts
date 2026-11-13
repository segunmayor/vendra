import { Money } from '../../../shared-kernel';
import { SettingsReader } from '../../settings';
import { JournalEntry } from '../domain/journal-entry';
import { PostOrderDelivered } from './post-payment';

const accounts: Record<string, string> = {
  'payments.ledgerPrepaymentAccount': '2100',
  'payments.ledgerSalesAccount': '4000',
  'payments.ledgerDeliveryIncomeAccount': '4100',
};
const settings = { getMany: async (keys: readonly string[]) => keys.map((key) => accounts[key]) } as unknown as SettingsReader;
const naira = (minor: bigint) => Money.of(minor, 'NGN');

function setup() {
  const posted: JournalEntry[] = [];
  const journal = {
    append: async (entry: JournalEntry) => {
      if (posted.some((other) => other.sourceType === entry.sourceType && other.sourceId === entry.sourceId)) return 'duplicate' as const;
      posted.push(entry);
      return 'posted' as const;
    },
  };
  return { posted, use: new PostOrderDelivered(journal, settings, { uuid: () => 'j1' }) };
}
const lines = (entry: JournalEntry) => entry.lines.map((line) => [line.accountCode, line.side, line.amount.minor]);

describe('PostOrderDelivered', () => {
  it('moves the prepayment to sales and delivery income, once', async () => {
    const { posted, use } = setup();
    expect(await use.execute('o1', { subtotal: naira(2_500_000n), delivery: naira(250_000n) }, new Date())).toBe('posted');
    expect(await use.execute('o1', { subtotal: naira(2_500_000n), delivery: naira(250_000n) }, new Date())).toBe('duplicate');
    expect(posted).toHaveLength(1);
    expect(lines(posted[0]!)).toEqual([
      ['2100', 'debit', 2_750_000n],
      ['4000', 'credit', 2_500_000n],
      ['4100', 'credit', 250_000n],
    ]);
  });

  it('leaves out delivery income when delivery was free', async () => {
    const { posted, use } = setup();
    await use.execute('o2', { subtotal: naira(1_000n), delivery: naira(0n) }, new Date());
    expect(lines(posted[0]!)).toEqual([
      ['2100', 'debit', 1_000n],
      ['4000', 'credit', 1_000n],
    ]);
  });
});
