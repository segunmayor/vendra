import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import * as jwt from 'jsonwebtoken';
import { Audience } from '../../../shared-kernel';
import { AccessClaims, AccessTokenService, PasswordHasher, Secrets } from '../application/ports';

const ISSUER = 'vendra-api';

export class Argon2PasswordHasher implements PasswordHasher {
  // The library's default algorithm is Argon2id. These are OWASP's minimum settings.
  private readonly options = { memoryCost: 19_456, timeCost: 2, parallelism: 1 };

  hash(password: string): Promise<string> {
    return hash(password, this.options);
  }

  async verify(stored: string, password: string): Promise<boolean> {
    try {
      return await verify(stored, password);
    } catch {
      return false;
    }
  }
}

export class JwtAccessTokenService implements AccessTokenService {
  constructor(private readonly secret: string) {}

  issue(claims: AccessClaims, ttlSeconds: number): { token: string; expiresAt: Date } {
    const token = jwt.sign({ sid: claims.sessionId }, this.secret, {
      algorithm: 'HS256',
      subject: claims.accountId,
      audience: claims.audience,
      issuer: ISSUER,
      expiresIn: ttlSeconds,
    });
    return { token, expiresAt: new Date(Date.now() + ttlSeconds * 1000) };
  }

  verify(token: string, audience: Audience): AccessClaims | null {
    try {
      const payload = jwt.verify(token, this.secret, { algorithms: ['HS256'], audience, issuer: ISSUER });
      if (typeof payload === 'string' || !payload.sub || typeof payload.sid !== 'string') return null;
      return { accountId: payload.sub, sessionId: payload.sid, audience };
    } catch {
      return null;
    }
  }
}

export class NodeSecrets implements Secrets {
  uuid(): string {
    return randomUUID();
  }

  refreshToken(): string {
    return randomBytes(32).toString('base64url');
  }

  /** A fast hash is safe here, because the token is 256 bits of randomness. */
  hashToken(token: string): string {
    return createHash('sha256').update(token).digest('hex');
  }
}
