import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { RecoveryCodeGenerator, TotpPort } from '../application/ports';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
const PERIOD_SECONDS = 30;
const DIGITS = 6;
/** Accept the code before and after the current one, for clocks up to 30 seconds apart. */
const DRIFT_STEPS = 1;

export function base32Encode(bytes: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  const clean = text.toUpperCase().replace(/[\s=-]/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const char of clean) {
    const index = ALPHABET.indexOf(char);
    if (index < 0) throw new Error('Not base32');
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** The RFC 4226 HOTP value for one counter, as used by RFC 6238 TOTP with HMAC-SHA1. */
export function hotp(secret: Buffer, counter: number): string {
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));
  const digest = createHmac('sha1', secret).update(message).digest();
  const offset = digest[digest.length - 1]! & 0x0f;
  const binary = (digest.readUInt32BE(offset) & 0x7fffffff) % 10 ** DIGITS;
  return binary.toString().padStart(DIGITS, '0');
}

/**
 * Time-based codes per RFC 6238, with the settings every authenticator app supports:
 * SHA-1, 6 digits, 30 seconds. Works with Google Authenticator, Microsoft Authenticator,
 * 1Password, Authy and others.
 */
export class RfcTotp implements TotpPort {
  newSecret(): string {
    // 160 bits, the length RFC 4226 recommends.
    return base32Encode(randomBytes(20));
  }

  uri(secret: string, accountName: string, issuer: string): string {
    const label = encodeURIComponent(`${issuer}:${accountName}`);
    const params = new URLSearchParams({ secret, issuer, algorithm: 'SHA1', digits: String(DIGITS), period: String(PERIOD_SECONDS) });
    return `otpauth://totp/${label}?${params.toString()}`;
  }

  match(secret: string, code: string, now: Date): number | null {
    if (!/^\d{6}$/.test(code)) return null;
    const key = base32Decode(secret);
    const current = Math.floor(now.getTime() / 1000 / PERIOD_SECONDS);
    let matched: number | null = null;
    // Check every candidate, so timing does not reveal which step matched.
    for (let step = current - DRIFT_STEPS; step <= current + DRIFT_STEPS; step++) {
      if (timingSafeEqual(Buffer.from(hotp(key, step)), Buffer.from(code))) matched = step;
    }
    return matched;
  }
}

const RECOVERY_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789';

/** Ten characters from a 30-letter alphabet without look-alikes (no 0/O, 1/I/L, U/V): about 49 bits. */
export class RandomRecoveryCodes implements RecoveryCodeGenerator {
  next(): string {
    let raw = '';
    // Rejection sampling keeps every letter equally likely.
    while (raw.length < 10) {
      for (const byte of randomBytes(16)) {
        if (byte < 240 && raw.length < 10) raw += RECOVERY_ALPHABET[byte % 30];
      }
    }
    return `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}`;
  }
}
