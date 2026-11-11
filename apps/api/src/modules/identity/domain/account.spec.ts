import { DomainError } from '../../../shared-kernel';
import { Account, assertPasswordAllowed, normalizeEmail } from './account';
import { isPermission } from './permissions';

const now = new Date('2026-11-11T10:00:00Z');
const register = () =>
  Account.register({ id: 'a1', audience: 'store', email: ' Ada@Example.COM ', passwordHash: 'h', now });

describe('Account', () => {
  it('normalizes email on registration and raises an event without personal data', () => {
    const account = register();
    expect(account.snapshot.email).toBe('ada@example.com');
    const [event] = account.pullEvents();
    expect(event?.type).toBe('AccountRegistered');
    expect(JSON.stringify(event?.payload)).not.toContain('ada');
  });

  it.each(['', 'no-at-sign', 'a@b', 'a b@c.com', `${'x'.repeat(250)}@e.com`])('rejects email %j', (email) => {
    expect(() => normalizeEmail(email)).toThrow(DomainError);
  });

  it.each([['too short', 'x'.repeat(11)], ['too long', 'x'.repeat(129)]])('rejects a password that is %s', (_n, p) => {
    expect(() => assertPasswordAllowed(p)).toThrow(DomainError);
  });

  it.each([12, 128])('accepts a password of %i characters', (length) => {
    expect(() => assertPasswordAllowed('x'.repeat(length))).not.toThrow();
  });

  it('suspends once', () => {
    const account = register();
    account.pullEvents();
    account.suspend(now);
    account.suspend(now);
    expect(account.isActive).toBe(false);
    expect(account.pullEvents()).toHaveLength(1);
  });

  it('recognises only catalogued permissions', () => {
    expect(isPermission('orders.refund')).toBe(true);
    expect(isPermission('orders.delete_everything')).toBe(false);
  });
});
