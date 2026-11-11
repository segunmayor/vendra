import * as jwt from 'jsonwebtoken';
import { Argon2PasswordHasher, JwtAccessTokenService, NodeSecrets } from './security.adapters';

const secret = 'a-test-secret-that-is-long-enough-to-use';
const service = new JwtAccessTokenService(secret);
const claims = { accountId: 'acc', sessionId: 'ses', audience: 'store' as const };
const base = { subject: 'acc', audience: 'store', issuer: 'vendra-api' };

describe('JwtAccessTokenService', () => {
  it('round-trips valid claims', () => {
    expect(service.verify(service.issue(claims).token, 'store')).toEqual(claims);
  });

  it('expires after 15 minutes', () => {
    const { expiresAt } = service.issue(claims);
    expect(Math.round((expiresAt.getTime() - Date.now()) / 60_000)).toBe(15);
  });

  it.each(['admin', 'vendor'] as const)('rejects a store token on %s', (audience) => {
    expect(service.verify(service.issue(claims).token, audience)).toBeNull();
  });

  it('rejects a token signed with another secret', () => {
    const token = jwt.sign({ sid: 'ses' }, 'another-secret-that-is-long-enough-too', base);
    expect(service.verify(token, 'store')).toBeNull();
  });

  it('rejects an unsigned token', () => {
    const encode = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');
    const token = `${encode({ alg: 'none', typ: 'JWT' })}.${encode({ sid: 'ses', sub: 'acc', aud: 'store', iss: 'vendra-api' })}.`;
    expect(service.verify(token, 'store')).toBeNull();
  });

  it('rejects another signing algorithm', () => {
    expect(service.verify(jwt.sign({ sid: 'ses' }, secret, { ...base, algorithm: 'HS512' }), 'store')).toBeNull();
  });

  it('rejects an expired token', () => {
    expect(service.verify(jwt.sign({ sid: 'ses' }, secret, { ...base, expiresIn: -1 }), 'store')).toBeNull();
  });

  it('rejects another issuer', () => {
    expect(service.verify(jwt.sign({ sid: 'ses' }, secret, { ...base, issuer: 'evil' }), 'store')).toBeNull();
  });

  it('rejects a token with no session', () => {
    expect(service.verify(jwt.sign({}, secret, base), 'store')).toBeNull();
  });

  it('rejects garbage', () => {
    expect(service.verify('garbage', 'store')).toBeNull();
  });
});

describe('Argon2PasswordHasher', () => {
  const hasher = new Argon2PasswordHasher();

  it('produces Argon2id hashes that verify', async () => {
    const stored = await hasher.hash('correct horse battery');
    expect(stored.startsWith('$argon2id$')).toBe(true);
    await expect(hasher.verify(stored, 'correct horse battery')).resolves.toBe(true);
    await expect(hasher.verify(stored, 'wrong password here')).resolves.toBe(false);
  });

  it('treats a malformed stored hash as a failed match', async () => {
    await expect(hasher.verify('not-a-hash', 'anything')).resolves.toBe(false);
  });
});

describe('NodeSecrets', () => {
  const secrets = new NodeSecrets();

  it('generates unique tokens and never stores them as-is', () => {
    const token = secrets.refreshToken();
    expect(token).not.toBe(secrets.refreshToken());
    expect(token.length).toBeGreaterThanOrEqual(43);
    expect(secrets.hashToken(token)).not.toContain(token);
  });
});
