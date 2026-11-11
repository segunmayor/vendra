import { decodeCursor, encodeCursor, normalizeQuery } from './storefront';

describe('storefront cursors', () => {
  it('round-trips both kinds', () => {
    const rank = { kind: 'rank', offset: 24 } as const;
    const newest = { kind: 'newest', createdAt: '2026-11-11 10:00:00.123456+00', id: '0b1c6a2e-1111-4222-8333-444455556666' } as const;
    expect(decodeCursor(encodeCursor(rank), 'rank')).toEqual(rank);
    expect(decodeCursor(encodeCursor(newest), 'newest')).toEqual(newest);
  });

  it.each([
    ['garbage', 'not-base64-json!!'],
    ['a number', Buffer.from('42').toString('base64url')],
    ['a negative offset', encodeCursor({ kind: 'rank', offset: -1 })],
    ['an offset past the limit', encodeCursor({ kind: 'rank', offset: 1001 })],
    ['a fractional offset', Buffer.from(JSON.stringify({ kind: 'rank', offset: 1.5 })).toString('base64url')],
  ])('rejects %s', (_name, cursor) => {
    expect(() => decodeCursor(cursor, 'rank')).toThrow('no longer valid');
  });

  it('rejects a cursor from the other kind of list, so search and browse cannot mix', () => {
    expect(() => decodeCursor(encodeCursor({ kind: 'rank', offset: 3 }), 'newest')).toThrow('no longer valid');
  });

  it('rejects an injected id or date in a browse cursor', () => {
    const bad = (value: object) => Buffer.from(JSON.stringify({ kind: 'newest', ...value })).toString('base64url');
    expect(() => decodeCursor(bad({ createdAt: 'yesterday', id: '0b1c6a2e-1111-4222-8333-444455556666' }), 'newest')).toThrow();
    expect(() => decodeCursor(bad({ createdAt: '2026-11-11', id: "x' OR 1=1 --" }), 'newest')).toThrow();
  });

  it('normalizes queries', () => {
    expect(normalizeQuery('  ankara   shirt ')).toBe('ankara shirt');
    expect(normalizeQuery('   ')).toBeUndefined();
    expect(normalizeQuery(undefined)).toBeUndefined();
    expect(normalizeQuery('x'.repeat(300))).toHaveLength(100);
  });
});
