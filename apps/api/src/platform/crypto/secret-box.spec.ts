import { randomBytes } from 'node:crypto';
import { SecretBox } from './secret-box';

const key = () => randomBytes(32).toString('base64');

describe('SecretBox', () => {
  it('round-trips and never repeats ciphertext', () => {
    const box = new SecretBox(key());
    const a = box.seal('sk_test_abc');
    expect(box.open(a)).toBe('sk_test_abc');
    expect(box.seal('sk_test_abc')).not.toBe(a);
    expect(a).not.toContain('sk_test_abc');
  });

  it('refuses the wrong key, tampering and junk with a clear message', () => {
    const box = new SecretBox(key());
    const sealed = box.seal('secret');
    expect(() => new SecretBox(key()).open(sealed)).toThrow('different encryption key');
    const parts = sealed.split(':');
    parts[4] = Buffer.from('tampered').toString('base64');
    expect(() => box.open(parts.join(':'))).toThrow('altered');
    expect(() => box.open('plain text')).toThrow('format');
  });

  it('refuses a key of the wrong size', () => {
    expect(() => new SecretBox(Buffer.from('short').toString('base64'))).toThrow('32 bytes');
  });
});
