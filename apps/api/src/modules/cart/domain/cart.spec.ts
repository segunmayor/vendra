import { Cart } from './cart';

const MAX_LINE_QUANTITY = 10;
const MAX_LINES = 30;
const limits = { maxQuantity: MAX_LINE_QUANTITY, maxLines: MAX_LINES };

const guest = () => Cart.open('c1', { kind: 'guest', tokenHash: 'h' });

describe('Cart', () => {
  it('adds to an existing line and keeps the order lines were added', () => {
    const cart = guest();
    cart.add('a', 1, limits);
    cart.add('b', 2, limits);
    cart.add('a', 2, limits);
    expect(cart.snapshot.lines).toEqual([
      { listingId: 'a', quantity: 3 },
      { listingId: 'b', quantity: 2 },
    ]);
  });

  it('removes a line when set to zero', () => {
    const cart = guest();
    cart.add('a', 1, limits);
    cart.set('a', 0, limits);
    expect(cart.snapshot.lines).toEqual([]);
  });

  it.each([-1, 1.5])('refuses a quantity of %s', (quantity) => {
    expect(() => guest().set('a', quantity, limits)).toThrow('whole number');
  });

  it('caps one item at the per-order limit, counting what is already there', () => {
    const cart = guest();
    cart.add('a', MAX_LINE_QUANTITY, limits);
    expect(() => cart.add('a', 1, limits)).toThrow(`at most ${MAX_LINE_QUANTITY}`);
    expect(cart.quantityOf('a')).toBe(MAX_LINE_QUANTITY);
  });

  it('caps the number of different items', () => {
    const cart = guest();
    for (let index = 0; index < MAX_LINES; index += 1) cart.add(`l${index}`, 1, limits);
    expect(() => cart.add('one-more', 1, limits)).toThrow(`up to ${MAX_LINES}`);
    expect(() => cart.add('l0', 1, limits)).not.toThrow();
  });

  it('absorbs a guest cart, adding quantities and capping instead of failing', () => {
    const mine = Cart.open('m', { kind: 'customer', customerId: 'u1' });
    mine.add('a', 8, limits);
    const theirs = guest();
    theirs.add('a', 5, limits);
    theirs.add('b', 1, limits);
    expect(mine.absorb(theirs, limits)).toEqual({ capped: true });
    expect(mine.snapshot.lines).toEqual([
      { listingId: 'a', quantity: MAX_LINE_QUANTITY },
      { listingId: 'b', quantity: 1 },
    ]);
  });

  it('reports no capping when everything fits', () => {
    const mine = Cart.open('m', { kind: 'customer', customerId: 'u1' });
    const theirs = guest();
    theirs.add('a', 2, limits);
    expect(mine.absorb(theirs, limits)).toEqual({ capped: false });
  });
});

describe('configurable limits', () => {
  it('apply whatever limits are passed in', () => {
    const cart = guest();
    const tight = { maxQuantity: 2, maxLines: 1 };
    cart.add('a', 2, tight);
    expect(() => cart.add('a', 1, tight)).toThrow('at most 2');
    expect(() => cart.add('b', 1, tight)).toThrow('up to 1');
  });
});
