import { allocate, normalizeLines as normalize } from './reservation';

const MAX_UNITS_PER_LISTING = 10;
const normalizeLines = (lines: Parameters<typeof normalize>[0]) => normalize(lines, MAX_UNITS_PER_LISTING);

const row = (stockItemId: string, listingId: string, available: number) => ({ stockItemId, listingId, available });

describe('normalizeLines', () => {
  it('merges repeated listings', () => {
    expect(normalizeLines([{ listingId: 'a', quantity: 2 }, { listingId: 'a', quantity: 3 }])).toEqual([{ listingId: 'a', quantity: 5 }]);
  });

  it.each([0, -1, 1.5, Number.NaN])('rejects a quantity of %s', (quantity) => {
    expect(() => normalizeLines([{ listingId: 'a', quantity }])).toThrow('whole numbers');
  });

  it('rejects an empty request and caps units per listing, counted after merging', () => {
    expect(() => normalizeLines([])).toThrow('Nothing to reserve');
    expect(() => normalizeLines([{ listingId: 'a', quantity: MAX_UNITS_PER_LISTING }])).not.toThrow();
    expect(() =>
      normalizeLines([
        { listingId: 'a', quantity: MAX_UNITS_PER_LISTING },
        { listingId: 'a', quantity: 1 },
      ]),
    ).toThrow(`at most ${MAX_UNITS_PER_LISTING}`);
  });
});

describe('allocate', () => {
  it('takes from the fullest warehouse first and splits only when needed', () => {
    const stock = [row('s1', 'a', 2), row('s2', 'a', 5), row('s3', 'a', 1)];
    expect(allocate([{ listingId: 'a', quantity: 4 }], stock)).toEqual({ ok: true, allocations: [{ stockItemId: 's2', listingId: 'a', quantity: 4 }] });
    expect(allocate([{ listingId: 'a', quantity: 7 }], stock)).toEqual({
      ok: true,
      allocations: [
        { stockItemId: 's2', listingId: 'a', quantity: 5 },
        { stockItemId: 's1', listingId: 'a', quantity: 2 },
      ],
    });
  });

  it('allocates nothing if any line is short, and reports every short line', () => {
    const result = allocate(
      [
        { listingId: 'a', quantity: 1 },
        { listingId: 'b', quantity: 3 },
        { listingId: 'c', quantity: 1 },
      ],
      [row('s1', 'a', 9), row('s2', 'b', 2)],
    );
    expect(result).toEqual({
      ok: false,
      shortfalls: [
        { listingId: 'b', requested: 3, available: 2 },
        { listingId: 'c', requested: 1, available: 0 },
      ],
    });
  });

  it('ignores rows with nothing free', () => {
    expect(allocate([{ listingId: 'a', quantity: 1 }], [row('s1', 'a', 0), row('s2', 'a', -1)])).toMatchObject({ ok: false });
  });
});
