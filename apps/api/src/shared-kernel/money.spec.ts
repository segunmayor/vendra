import { DomainError } from './domain-error';
import { Money } from './money';

describe('Money', () => {
  it('adds exactly, beyond the safe range of floats', () => {
    const big = Money.of(9_007_199_254_740_993n, 'NGN');
    expect(big.add(Money.of(2n, 'NGN')).minor).toBe(9_007_199_254_740_995n);
  });

  it('refuses to combine currencies', () => {
    expect(() => Money.of(1n, 'NGN').add(Money.of(1n, 'USD'))).toThrow(DomainError);
  });

  it('treats different currencies as unequal', () => {
    expect(Money.of(1n, 'NGN').equals(Money.of(1n, 'USD'))).toBe(false);
  });

  it('rejects malformed currency codes', () => {
    expect(() => Money.of(1n, 'naira')).toThrow(DomainError);
  });
});
