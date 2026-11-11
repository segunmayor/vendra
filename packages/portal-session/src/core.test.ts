import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  ACCESS_EXPIRY_SKEW_MS,
  clientIpFrom,
  cookieNames,
  RefreshCoalescer,
  safeNextPath,
  sessionCookies,
  sharedCoalescer,
} from './core.ts';

const session = {
  accessToken: 'access',
  accessTokenExpiresAt: '2026-11-18T10:15:00.000Z',
  refreshToken: 'refresh',
  refreshTokenExpiresAt: '2026-11-18T22:00:00.000Z',
};

test('production cookie names carry the __Host- prefix', () => {
  assert.deepEqual(cookieNames('admin', true), { access: '__Host-vendra_admin_at', refresh: '__Host-vendra_admin_rt' });
  assert.deepEqual(cookieNames('store', false), { access: 'vendra_store_at', refresh: 'vendra_store_rt' });
});

test('each portal uses its own cookies', () => {
  const names = new Set((['store', 'admin', 'vendor'] as const).flatMap((a) => Object.values(cookieNames(a, true))));
  assert.equal(names.size, 6);
});

test('session cookies are httpOnly, SameSite=Lax, host-wide, and expire with their tokens', () => {
  const [access, refresh] = sessionCookies(cookieNames('admin', true), session, true);
  for (const cookie of [access, refresh]) {
    assert.equal(cookie.httpOnly, true);
    assert.equal(cookie.secure, true);
    assert.equal(cookie.sameSite, 'lax');
    assert.equal(cookie.path, '/');
  }
  assert.equal(access.value, 'access');
  assert.equal(access.expires.getTime(), Date.parse(session.accessTokenExpiresAt) - ACCESS_EXPIRY_SKEW_MS);
  assert.equal(refresh.value, 'refresh');
  assert.equal(refresh.expires.toISOString(), session.refreshTokenExpiresAt);
});

test('safeNextPath keeps local paths and their query', () => {
  assert.equal(safeNextPath('/catalogue/products?status=draft'), '/catalogue/products?status=draft');
  assert.equal(safeNextPath('/'), '/');
});

test('safeNextPath refuses anything that could leave the site', () => {
  for (const bad of [
    null,
    '',
    'https://evil.example',
    '//evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    '/\t/evil.example',
    '/\n/evil.example',
    'javascript:alert(1)',
    'evil.example',
  ]) {
    assert.equal(safeNextPath(bad, '/home'), '/home', String(bad));
  }
});

test('clientIpFrom trusts only the entry the trusted proxy appended', () => {
  assert.equal(clientIpFrom('6.6.6.6, 102.89.1.2', 1), '102.89.1.2');
  assert.equal(clientIpFrom('6.6.6.6, 102.89.1.2, 10.0.0.5', 2), '102.89.1.2');
});

test('clientIpFrom forwards nothing without a trusted proxy', () => {
  assert.equal(clientIpFrom('6.6.6.6', 0), null);
  assert.equal(clientIpFrom(null, 1), null);
  assert.equal(clientIpFrom('102.89.1.2', 3), null);
});

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

test('concurrent refreshes of one token make a single API call', async () => {
  const coalescer = new RefreshCoalescer<string>();
  const gate = deferred<string>();
  let calls = 0;
  const refresh = () => {
    calls += 1;
    return gate.promise;
  };
  const results = Promise.all([1, 2, 3, 4, 5].map(() => coalescer.run('token-a', refresh)));
  gate.resolve('new-session');
  assert.deepEqual(await results, Array(5).fill('new-session'));
  assert.equal(calls, 1);
});

test('a request arriving just after the refresh reuses the result', async () => {
  let clock = 0;
  const coalescer = new RefreshCoalescer<string>(10_000, 100, () => clock);
  let calls = 0;
  const refresh = async () => `session-${++calls}`;
  assert.equal(await coalescer.run('token-a', refresh), 'session-1');
  clock = 9_999;
  assert.equal(await coalescer.run('token-a', refresh), 'session-1');
  clock = 10_000;
  assert.equal(await coalescer.run('token-a', refresh), 'session-2');
  assert.equal(calls, 2);
});

test('different tokens never share a result', async () => {
  const coalescer = new RefreshCoalescer<string>();
  const [a, b] = await Promise.all([
    coalescer.run('token-a', async () => 'a'),
    coalescer.run('token-b', async () => 'b'),
  ]);
  assert.deepEqual([a, b], ['a', 'b']);
});

test('a failed refresh is shared by waiters but not remembered', async () => {
  const coalescer = new RefreshCoalescer<string>();
  const gate = deferred<string>();
  let calls = 0;
  const failing = () => {
    calls += 1;
    return gate.promise;
  };
  const both = Promise.allSettled([coalescer.run('token-a', failing), coalescer.run('token-a', failing)]);
  gate.reject(new Error('session_invalid'));
  const settled = await both;
  assert.ok(settled.every((result) => result.status === 'rejected'));
  assert.equal(calls, 1);
  assert.equal(await coalescer.run('token-a', async () => 'retried'), 'retried');
});

test('the remembered results are bounded', async () => {
  const coalescer = new RefreshCoalescer<string>(60_000, 3);
  for (const token of ['a', 'b', 'c', 'd']) await coalescer.run(token, async () => token);
  let called = false;
  await coalescer.run('a', async () => {
    called = true;
    return 'again';
  });
  assert.equal(called, true);
});

test('every bundle in the process gets the same coalescer per audience', () => {
  assert.equal(sharedCoalescer('admin'), sharedCoalescer('admin'));
  assert.notEqual(sharedCoalescer('admin'), sharedCoalescer('store'));
});
