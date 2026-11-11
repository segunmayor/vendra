import { StockItem } from './stock-item';

const now = new Date('2026-11-11T10:00:00Z');
const open = (onHand = 0, reserved = 0) =>
  StockItem.rehydrate({ id: 's1', listingId: 'l1', warehouseId: 'w1', onHand, reserved, version: 1 });

describe('StockItem', () => {
  it('starts empty', () => {
    const item = StockItem.open({ id: 's', listingId: 'l', warehouseId: 'w' });
    expect([item.snapshot.onHand, item.available]).toEqual([0, 0]);
  });

  it('receives and removes stock', () => {
    const item = open();
    item.adjust(10, 'receipt', now);
    item.adjust(-3, 'damaged', now);
    expect(item.snapshot.onHand).toBe(7);
    expect(item.pullEvents().map((e) => e.payload.onHand)).toEqual([10, 7]);
  });

  it('never goes below zero', () => {
    expect(() => open(2).adjust(-3, 'correction', now)).toThrow('free to remove');
  });

  it('cannot remove reserved units', () => {
    const item = open(10, 8);
    expect(() => item.adjust(-3, 'lost', now)).toThrow('8 are reserved');
    item.adjust(-2, 'lost', now);
    expect(item.available).toBe(0);
  });

  it.each([0, 1.5, 1_000_001, Number.NaN])('rejects a quantity of %s', (delta) => {
    expect(() => open(5).adjust(delta, 'correction', now)).toThrow('whole number');
  });

  it.each([
    [-1, 'receipt'],
    [-1, 'returned'],
    [1, 'damaged'],
    [1, 'lost'],
  ] as const)('rejects %i for %s', (delta, reason) => {
    expect(() => open(5).adjust(delta, reason, now)).toThrow('stock');
  });

  it('allows corrections either way', () => {
    const item = open(5);
    item.adjust(2, 'correction', now);
    item.adjust(-4, 'correction', now);
    expect(item.snapshot.onHand).toBe(3);
  });
});
