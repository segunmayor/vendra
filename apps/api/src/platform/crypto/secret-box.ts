import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/**
 * Encrypts small secrets at rest with AES-256-GCM. The output names the key it was made with
 * (a fingerprint, not the key), so a wrong or rotated key is reported clearly instead of
 * failing with a cryptic error.
 */
export class SecretBox {
  private readonly key: Buffer;
  private readonly keyId: string;

  constructor(base64Key: string) {
    this.key = Buffer.from(base64Key, 'base64');
    if (this.key.length !== 32) throw new Error('SETTINGS_ENCRYPTION_KEY must be 32 bytes, base64');
    this.keyId = createHash('sha256').update(this.key).digest('hex').slice(0, 8);
  }

  seal(plaintext: string): string {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.key, iv);
    cipher.setAAD(Buffer.from(this.keyId));
    const body = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    return ['v1', this.keyId, iv.toString('base64'), cipher.getAuthTag().toString('base64'), body.toString('base64')].join(':');
  }

  open(sealed: string): string {
    const [version, keyId, iv, tag, body] = sealed.split(':');
    if (version !== 'v1' || !keyId || !iv || !tag || body === undefined) throw new SecretBoxError('These credentials are not in a format this API can read');
    if (keyId !== this.keyId) throw new SecretBoxError('These credentials were saved with a different encryption key. Enter them again.');
    const decipher = createDecipheriv('aes-256-gcm', this.key, Buffer.from(iv, 'base64'));
    decipher.setAAD(Buffer.from(keyId));
    decipher.setAuthTag(Buffer.from(tag, 'base64'));
    try {
      return Buffer.concat([decipher.update(Buffer.from(body, 'base64')), decipher.final()]).toString('utf8');
    } catch {
      throw new SecretBoxError('These credentials have been altered or damaged. Enter them again.');
    }
  }
}

export class SecretBoxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SecretBoxError';
  }
}
