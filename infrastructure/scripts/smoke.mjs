#!/usr/bin/env node
/**
 * Read-only checks against a deployed environment (staging or production). Changes nothing,
 * so it is safe to run against live. Exits 1 if any check fails.
 *
 *   node infrastructure/scripts/smoke.mjs \
 *     --api https://api.example.ng --store https://example.ng \
 *     --admin https://admin.example.ng --sellers https://sellers.example.ng
 *
 * Use the public addresses. Behind the staging proxy the API only exposes health and
 * webhooks; the portals reach everything else over the private network.
 *
 * Add --allow-http for a local or private staging run without TLS.
 */
import { randomUUID } from 'node:crypto';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: {
    api: { type: 'string' },
    store: { type: 'string' },
    admin: { type: 'string' },
    sellers: { type: 'string' },
    'allow-http': { type: 'boolean', default: false },
  },
});
for (const name of ['api', 'store', 'admin', 'sellers']) {
  if (!values[name]) {
    console.error(`Missing --${name}. See the comment at the top of this file.`);
    process.exit(2);
  }
}
const strip = (url) => url.replace(/\/+$/, '');
const api = strip(values.api);
const portals = { store: strip(values.store), admin: strip(values.admin), sellers: strip(values.sellers) };
const tls = !values['allow-http'];

const results = [];
async function check(name, run) {
  try {
    await run();
    results.push({ name, ok: true });
  } catch (error) {
    results.push({ name, ok: false, reason: error instanceof Error ? error.message : String(error) });
  }
}
function expect(condition, message) {
  if (!condition) throw new Error(message);
}
async function get(url, init) {
  const response = await fetch(url, { redirect: 'manual', signal: AbortSignal.timeout(15_000), ...init });
  return { response, text: await response.text() };
}
const header = (response, name) => response.headers.get(name) ?? '';

// ---------- API ----------
await check('API is ready (database reachable)', async () => {
  const { response, text } = await get(`${api}/v1/health/ready`);
  expect(response.status === 200, `status ${response.status}: ${text.slice(0, 200)}`);
});
await check('API sends security headers and hides its software', async () => {
  const { response } = await get(`${api}/v1/health`);
  expect(header(response, 'x-content-type-options') === 'nosniff', 'no nosniff');
  expect(header(response, 'x-frame-options') === 'DENY', 'no X-Frame-Options DENY');
  expect(header(response, 'content-security-policy').includes("default-src 'none'"), 'no restrictive CSP');
  expect(!response.headers.has('x-powered-by'), 'X-Powered-By is present');
  if (tls) expect(header(response, 'strict-transport-security').includes('max-age='), 'no HSTS (is NODE_ENV=production?)');
});
await check('API docs are not exposed', async () => {
  const { response } = await get(`${api}/docs`);
  expect(response.status === 404, `GET /docs answered ${response.status}`);
});
await check('Staff routes refuse anonymous callers', async () => {
  for (const path of ['admin/orders', 'admin/settings', 'admin/sellers', 'admin/staff']) {
    const { response } = await get(`${api}/v1/${path}`);
    // 401 from the API itself, or 404 where the proxy only exposes health and webhooks.
    expect(response.status === 401 || response.status === 404, `${path} answered ${response.status}`);
  }
});
await check('Webhooks refuse unsigned calls without a server error', async () => {
  const { response } = await get(`${api}/v1/webhooks/payments/${randomUUID()}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"event":"charge.success"}' });
  expect(response.status >= 400 && response.status < 500, `answered ${response.status}`);
});
if (tls) {
  await check('API refuses plain HTTP or redirects it to HTTPS', async () => {
    const plain = api.replace(/^https:/, 'http:');
    const result = await get(`${plain}/v1/health`).catch(() => null);
    expect(!result || [301, 302, 307, 308].includes(result.response.status) || result.response.status >= 400, `plain HTTP answered ${result?.response.status}`);
  });
}

// ---------- Portals ----------
const pages = [
  ['Customer home page', portals.store, '/'],
  ['Customer sign-in', portals.store, '/login'],
  ['Customer search (catalogue reachable from the portal)', portals.store, '/search?q=a'],
  ['Admin sign-in', portals.admin, '/login'],
  ['Seller sign-in', portals.sellers, '/login'],
];
for (const [name, base, path] of pages) {
  await check(`${name} loads with security headers`, async () => {
    const { response, text } = await get(`${base}${path}`);
    expect(response.status === 200, `status ${response.status}`);
    expect(text.includes('</html>'), 'not a full page');
    const csp = header(response, 'content-security-policy');
    expect(csp.includes("frame-ancestors 'none'") && csp.includes("object-src 'none'"), 'missing or weak CSP');
    expect(!csp.includes('unsafe-eval'), "CSP allows 'unsafe-eval' (a development build?)");
    expect(header(response, 'x-content-type-options') === 'nosniff', 'no nosniff');
    if (tls) expect(header(response, 'strict-transport-security').includes('max-age='), 'no HSTS');
  });
}
await check('Admin pages send signed-out visitors to sign in', async () => {
  const { response } = await get(`${portals.admin}/orders`);
  expect([302, 303, 307].includes(response.status) && header(response, 'location').includes('/login'), `answered ${response.status}`);
});

// ---------- Report ----------
for (const result of results) console.log(`${result.ok ? 'PASS' : 'FAIL'}  ${result.name}${result.ok ? '' : `\n      ${result.reason}`}`);
const failed = results.filter((result) => !result.ok).length;
console.log(`\n${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
