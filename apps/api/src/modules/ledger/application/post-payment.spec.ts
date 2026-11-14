import { Money } from '../../../shared-kernel';
import { SettingsReader } from '../../settings';
import { JournalEntry } from '../domain/journal-entry';
import { PostOrderDelivered, PostPaymentReceived, PostRefundPaid } from './post-payment';

const accounts: Record<string, string> = {
  'payments.ledgerClearingAccount': '1100',
  'payments.ledgerPrepaymentAccount': '2100',
  'payments.ledgerSalesAccount': '4000',
  'payments.ledgerDeliveryIncomeAccount': '4100',
  'payments.ledgerRefundsAfterDeliveryAccount': '4900',
};
const settings = { getMany: async (keys: readonly string[]) => keys.map((key) => accounts[key]) } as unknown as SettingsReader;
const naira = (minor: bigint) => Money.of(minor, 'NGN');
const now = new Date('2026-11-14T09:00:00Z');

function setup() {
  const posted: JournalEntry[] = [];
  let next = 0;
  const journal = {
    append: async (entry: JournalEntry) => {
      if (posted.some((other) => other.sourceType === entry.sourceType && other.sourceId === entry.sourceId)) return 'duplicate' as const;
      posted.push(entry);
      return 'posted' as const;
    },
    balanceFor: async (paymentId: string, accountCode: string) =>
      posted
        .filter((entry) => entry.paymentId === paymentId)
        .flatMap((entry) => entry.lines)
        .filter((line) => line.accountCode === accountCode)
        .reduce((sum, line) => sum + (line.side === 'credit' ? line.amount.minor : -line.amount.minor), 0n),
  };
  const ids = { uuid: () => `j${++next}` };
  return {
    posted,
    pay: new PostPaymentReceived(journal, settings, ids),
    refund: new PostRefundPaid(journal, settings, ids),
    deliver: new PostOrderDelivered(journal, settings, ids),
  };
}
const lines = (entry: JournalEntry) => entry.lines.map((line) => [line.accountCode, line.side, line.amount.minor]);
const order = { subtotal: naira(2_500_000n), delivery: naira(250_000n) };

/** Net balance per account across everything posted (credits positive). */
function balances(posted: readonly JournalEntry[]) {
  const totals: Record<string, bigint> = {};
  for (const line of posted.flatMap((entry) => entry.lines)) totals[line.accountCode] = (totals[line.accountCode] ?? 0n) + (line.side === 'credit' ? line.amount.minor : -line.amount.minor);
  return totals;
}

describe('ledger postings for one payment', () => {
  it('moves the prepayment to sales and delivery income on delivery, once', async () => {
    const world = setup();
    await world.pay.execute('p1', naira(2_750_000n), now);
    expect(await world.deliver.execute('o1', 'p1', order, now)).toBe('posted');
    // A re-delivered event finds nothing left to recognise, so nothing is posted twice.
    expect(await world.deliver.execute('o1', 'p1', order, now)).toBe('nothing_held');
    expect(world.posted).toHaveLength(2);
    expect(lines(world.posted[1]!)).toEqual([
      ['2100', 'debit', 2_750_000n],
      ['4000', 'credit', 2_500_000n],
      ['4100', 'credit', 250_000n],
    ]);
    expect(world.posted[1]!.paymentId).toBe('p1');
  });

  it('leaves out delivery income when delivery was free', async () => {
    const world = setup();
    await world.pay.execute('p2', naira(1_000n), now);
    await world.deliver.execute('o2', 'p2', { subtotal: naira(1_000n), delivery: naira(0n) }, now);
    expect(lines(world.posted[1]!)).toEqual([
      ['2100', 'debit', 1_000n],
      ['4000', 'credit', 1_000n],
    ]);
  });

  it('takes a refund before delivery out of the prepayment, and recognises only what is left', async () => {
    const world = setup();
    await world.pay.execute('p3', naira(2_750_000n), now);
    await world.refund.execute('r1', 'p3', naira(1_000_000n), now);
    expect(lines(world.posted[1]!)).toEqual([
      ['2100', 'debit', 1_000_000n],
      ['1100', 'credit', 1_000_000n],
    ]);
    await world.deliver.execute('o3', 'p3', order, now);
    expect(lines(world.posted[2]!)).toEqual([
      ['2100', 'debit', 1_750_000n],
      ['4000', 'credit', 1_500_000n],
      ['4100', 'credit', 250_000n],
    ]);
    expect(balances(world.posted)['2100']).toBe(0n);
  });

  it('records a refund after delivery against refunds, never pushing prepayments below zero', async () => {
    const world = setup();
    await world.pay.execute('p4', naira(2_750_000n), now);
    await world.deliver.execute('o4', 'p4', order, now);
    await world.refund.execute('r2', 'p4', naira(2_750_000n), now);
    expect(lines(world.posted[2]!)).toEqual([
      ['4900', 'debit', 2_750_000n],
      ['1100', 'credit', 2_750_000n],
    ]);
    expect(balances(world.posted)).toMatchObject({ '1100': 0n, '2100': 0n, '4000': 2_500_000n, '4100': 250_000n, '4900': -2_750_000n });
  });

  it('records nothing on delivery when the payment was refunded in full first', async () => {
    const world = setup();
    await world.pay.execute('p5', naira(2_750_000n), now);
    await world.refund.execute('r3', 'p5', naira(2_750_000n), now);
    expect(await world.deliver.execute('o5', 'p5', order, now)).toBe('nothing_held');
    expect(world.posted).toHaveLength(2);
  });
});
