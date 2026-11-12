import { base32Decode, base32Encode, hotp, RfcTotp } from './totp';

describe('TOTP', () => {
  // RFC 6238 appendix B uses the ASCII secret "12345678901234567890" with SHA-1, 8 digits.
  // Its 6-digit values are the last six digits of each 8-digit value.
  const rfcSecret = Buffer.from('12345678901234567890');
  it.each([
    [59, '287082'],
    [1111111109, '081804'],
    [1111111111, '050471'],
    [1234567890, '005924'],
    [2000000000, '279037'],
  ])('matches RFC 6238 test vector at %i', (seconds, expected) => {
    expect(hotp(rfcSecret, Math.floor(seconds / 30))).toBe(expected);
  });

  it('round-trips base32', () => {
    expect(base32Encode(Buffer.from('12345678901234567890'))).toBe('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ');
    expect(base32Decode('GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ').toString()).toBe('12345678901234567890');
  });

  const totp = new RfcTotp();
  const secret = base32Encode(rfcSecret);

  it('returns the step that matched, allowing one step of clock drift', () => {
    const now = new Date(1111111109 * 1000);
    const step = Math.floor(1111111109 / 30);
    expect(totp.match(secret, '081804', now)).toBe(step);
    expect(totp.match(secret, hotp(rfcSecret, step + 1), now)).toBe(step + 1);
    expect(totp.match(secret, hotp(rfcSecret, step - 1), now)).toBe(step - 1);
    expect(totp.match(secret, hotp(rfcSecret, step + 2), now)).toBeNull();
  });

  it('refuses anything that is not six digits', () => {
    const now = new Date(1111111109 * 1000);
    expect(totp.match(secret, '81804', now)).toBeNull();
    expect(totp.match(secret, '0818045', now)).toBeNull();
    expect(totp.match(secret, 'abcdef', now)).toBeNull();
  });

  it('makes new 160-bit secrets and a standard otpauth address', () => {
    const fresh = totp.newSecret();
    expect(base32Decode(fresh)).toHaveLength(20);
    expect(fresh).not.toBe(totp.newSecret());
    const uri = new URL(totp.uri('ABC', 'ada@example.com', 'Vendra Admin'));
    expect(uri.protocol).toBe('otpauth:');
    expect(uri.host).toBe('totp');
    expect(decodeURIComponent(uri.pathname)).toBe('/Vendra Admin:ada@example.com');
    expect(uri.searchParams.get('issuer')).toBe('Vendra Admin');
    expect(uri.searchParams.get('secret')).toBe('ABC');
  });
});
