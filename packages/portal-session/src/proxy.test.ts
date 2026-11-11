import assert from 'node:assert/strict';
import { test } from 'node:test';
import { NextRequest } from 'next/server.js';
import { createSessionProxy, PATH_HEADER } from './proxy.ts';

const admin = createSessionProxy({ audience: 'admin', protect: 'all' });
const store = createSessionProxy({ audience: 'store', protect: ['/account'] });

function request(path: string, init: { method?: string; cookies?: string; headers?: Record<string, string> } = {}) {
  const headers = new Headers(init.headers);
  if (init.cookies) headers.set('cookie', init.cookies);
  return new NextRequest(new URL(path, 'http://portal.test'), { method: init.method ?? 'GET', headers });
}

const location = (response: Response) => response.headers.get('location');
const forwardedPath = (response: Response) => response.headers.get(`x-middleware-request-${PATH_HEADER}`);

test('a visitor with no session is sent to sign in, keeping the page', () => {
  const response = admin(request('/catalogue/products?status=draft'));
  assert.equal(response.status, 307);
  assert.equal(location(response), 'http://portal.test/login?next=%2Fcatalogue%2Fproducts%3Fstatus%3Ddraft');
});

test('an expired access token with a refresh token goes through the refresh route', () => {
  const response = admin(request('/catalogue', { cookies: 'vendra_admin_rt=r' }));
  assert.equal(response.status, 307);
  assert.equal(location(response), 'http://portal.test/auth/refresh?next=%2Fcatalogue');
});

test('a visitor with an access token passes, and the page learns its path', () => {
  const response = admin(request('/catalogue?x=1', { cookies: 'vendra_admin_at=a' }));
  assert.equal(location(response), null);
  assert.equal(forwardedPath(response), '/catalogue?x=1');
});

test('the path header cannot be supplied by the client', () => {
  const response = admin(request('/catalogue', { cookies: 'vendra_admin_at=a', headers: { [PATH_HEADER]: '//evil.example' } }));
  assert.equal(forwardedPath(response), '/catalogue');
});

test('another portal\'s cookie does not count', () => {
  const response = admin(request('/', { cookies: 'vendra_store_at=a; vendra_vendor_rt=r' }));
  assert.equal(location(response), 'http://portal.test/login?next=%2F');
});

test('sign-in and the refresh route stay open', () => {
  for (const path of ['/login', '/login?next=%2F', '/auth/refresh?next=%2F']) {
    assert.equal(location(admin(request(path))), null, path);
  }
});

test('open prefixes match whole segments only', () => {
  assert.equal(admin(request('/loginx')).status, 307);
  assert.equal(admin(request('/authority')).status, 307);
});

test('Server Action posts pass through, because each action checks the session itself', () => {
  assert.equal(location(admin(request('/catalogue', { method: 'POST' }))), null);
});

test('the store protects only the account area', () => {
  assert.equal(location(store(request('/'))), null);
  assert.equal(location(store(request('/products/ankara-shirt'))), null);
  assert.equal(location(store(request('/accounts-help'))), null);
  assert.equal(location(store(request('/account/orders'))), 'http://portal.test/login?next=%2Faccount%2Forders');
});
