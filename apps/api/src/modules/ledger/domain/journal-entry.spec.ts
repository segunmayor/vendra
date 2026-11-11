import { Money } from '../../../shared-kernel';
import { JournalEntry, JournalLine } from './journal-entry';

const at = new Date('2026-11-11T10:00:00Z');
const line = (side: JournalLine['side'], minor: bigint, currency = 'NGN'): JournalLine => ({
  accountCode: side === 'debit' ? 'cash' : 'revenue',
  side,
  amount: Money.of(minor, currency),
});
const post = (lines: JournalLine[]) =>
  JournalEntry.post({ id: 'j1', sourceType: 'payment', sourceId: 'p1', postedAt: at, lines });

describe('JournalEntry', () => {
  it('posts a balanced entry', () => {
    expect(post([line('debit', 100n), line('credit', 60n), line('credit', 40n)]).lines).toHaveLength(3);
  });

  it('rejects an unbalanced entry', () => {
    expect(() => post([line('debit', 100n), line('credit', 99n)])).toThrow('Debits must equal credits');
  });

  it('rejects a single line', () => {
    expect(() => post([line('debit', 100n)])).toThrow('at least two');
  });

  it('rejects non-positive lines', () => {
    expect(() => post([line('debit', 0n), line('credit', 0n)])).toThrow('positive');
  });

  it('rejects mixed currencies', () => {
    expect(() => post([line('debit', 100n), line('credit', 100n, 'USD')])).toThrow('one currency');
  });

  it('reverses by swapping sides and links to the original', () => {
    const reversal = post([line('debit', 100n), line('credit', 100n)]).reverse('j2', at);
    expect(reversal.lines.map((l) => l.side)).toEqual(['credit', 'debit']);
    expect(reversal.sourceId).toBe('j1');
  });
});
