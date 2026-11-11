import { PrismaClient } from '@prisma/client';
import type { INestApplication } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import * as jwt from 'jsonwebtoken';
import { createApp } from '../../src/bootstrap';
import * as audit from '../../src/platform/audit/audit';
import { StaffService } from '../../src/modules/identity';
import { PERMISSIONS } from '../../src/modules/identity/domain/permissions';
import { PrismaService } from '../../src/platform/prisma/prisma.service';
import { Principal } from '../../src/shared-kernel';

// Exercises the real HTTP stack and database. Rows use random emails and are left in place.
const prisma = new PrismaClient();
const PASSWORD = 'a-long-enough-password';
let app: INestApplication;
let base: string;
let staff: StaffService;

interface Reply {
  status: number;
  body: any;
}

async function call(method: string, path: string, options: { token?: string; body?: unknown } = {}): Promise<Reply> {
  const response = await fetch(`${base}/v1/${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(options.token ? { authorization: `Bearer ${options.token}` } : {}),
    },
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  return { status: response.status, body: text ? JSON.parse(text) : null };
}

const staffClient = () => app.get(PrismaService);
const email = () => `user_${randomUUID()}@example.com`;
const register = (surface: 'store' | 'vendor', address = email(), password = PASSWORD) =>
  call('POST', `${surface}/auth/register`, { body: { email: address, password } });
const login = (surface: string, address: string, password = PASSWORD) =>
  call('POST', `${surface}/auth/login`, { body: { email: address, password } });
const me = (surface: string, token?: string) => call('GET', `${surface}/auth/me`, { token });
const refresh = (surface: string, refreshToken: string) =>
  call('POST', `${surface}/auth/refresh`, { body: { refreshToken } });

/** Makes a role and staff member directly, as a seeded test fixture. */
async function makeStaff(permissions: readonly string[]) {
  const address = email();
  const root: Principal = {
    accountId: randomUUID(),
    sessionId: randomUUID(),
    audience: 'admin',
    permissions: PERMISSIONS,
  };
  const role = await staff.createRole(root, `role_${randomUUID()}`, permissions);
  const { id } = await staff.createStaff(root, address, PASSWORD, [role.id]);
  const session = await login('admin', address);
  expect(session.status).toBe(200);
  return { id, email: address, role, token: session.body.accessToken as string };
}

beforeAll(async () => {
  const [row] = await prisma.$queryRaw<{ db: string }[]>`SELECT current_database() AS db`;
  if (!row || !/test/.test(row.db)) throw new Error(`Refusing to run against database: ${row?.db}`);
  app = await createApp();
  await app.listen(0, '127.0.0.1');
  base = `http://127.0.0.1:${(app.getHttpServer().address() as AddressInfo).port}`;
  staff = app.get(StaffService);
});

beforeEach(() => prisma.loginFailure.deleteMany({ where: { key: { startsWith: 'ip:' } } }));

afterAll(async () => {
  await app.close();
  await prisma.$disconnect();
});

describe('surfaces', () => {
  it.each([
    ['store', 'admin'],
    ['store', 'vendor'],
    ['vendor', 'store'],
    ['vendor', 'admin'],
  ] as const)('a %s token is rejected on %s', async (from, to) => {
    const { body } = await register(from);
    expect((await me(from, body.accessToken)).status).toBe(200);
    expect((await me(to, body.accessToken)).status).toBe(401);
  });

  it.each(['store', 'vendor'])('a staff token is rejected on %s', async (surface) => {
    const { token } = await makeStaff(['audit.read']);
    expect((await me('admin', token)).status).toBe(200);
    expect((await me(surface, token)).status).toBe(401);
  });

  it('a customer token cannot reach staff endpoints', async () => {
    const { body } = await register('store');
    expect((await call('GET', 'admin/staff', { token: body.accessToken })).status).toBe(401);
  });

  it('a forged audience fails without the signing key', async () => {
    const forged = jwt.sign({ sid: randomUUID() }, 'attacker-secret-attacker-secret-attacker', {
      audience: 'admin',
      issuer: 'vendra-api',
      subject: randomUUID(),
    });
    expect((await me('admin', forged)).status).toBe(401);
  });

  it('a validly signed token for a non-existent session is rejected', async () => {
    const token = jwt.sign({ sid: randomUUID() }, process.env.JWT_SECRET!, {
      audience: 'admin',
      issuer: 'vendra-api',
      subject: randomUUID(),
    });
    expect((await me('admin', token)).status).toBe(401);
  });

  it('a validly signed token claiming another account is rejected', async () => {
    const victim = await register('store');
    const attacker = await register('store');
    const sid = (jwt.decode(attacker.body.accessToken) as jwt.JwtPayload).sid;
    const token = jwt.sign({ sid }, process.env.JWT_SECRET!, {
      audience: 'store',
      issuer: 'vendra-api',
      subject: victim.body.accountId,
    });
    expect((await me('store', token)).status).toBe(401);
  });

  it('a validly signed token naming the wrong audience for its session is rejected', async () => {
    const customer = await register('store');
    const claims = jwt.decode(customer.body.accessToken) as jwt.JwtPayload;
    const token = jwt.sign({ sid: claims.sid }, process.env.JWT_SECRET!, {
      audience: 'admin',
      issuer: 'vendra-api',
      subject: customer.body.accountId,
    });
    expect((await me('admin', token)).status).toBe(401);
  });

  it('requires a token', async () => {
    expect((await me('store')).status).toBe(401);
  });

  it('keeps health checks public', async () => {
    expect((await call('GET', 'health')).status).toBe(200);
  });

  it('has no public staff registration', async () => {
    const reply = await call('POST', 'admin/auth/register', { body: { email: email(), password: PASSWORD } });
    expect(reply.status).toBe(404);
  });
});

describe('registration', () => {
  it('stores an Argon2id hash and returns no secrets from the profile', async () => {
    const address = email();
    const { status, body } = await register('store', address);
    expect(status).toBe(201);
    const row = await prisma.account.findUniqueOrThrow({ where: { id: body.accountId } });
    expect(row.passwordHash.startsWith('$argon2id$')).toBe(true);
    const profile = await me('store', body.accessToken);
    expect(profile.body).toEqual({ id: body.accountId, audience: 'store', email: address, permissions: [] });
  });

  it('stores refresh tokens only as hashes', async () => {
    const { body } = await register('store');
    const rows = await prisma.session.findMany({ where: { accountId: body.accountId } });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.refreshTokenHash).not.toBe(body.refreshToken);
  });

  it('records an event with no personal data', async () => {
    const { body } = await register('store');
    const events = await prisma.outboxEvent.findMany({ where: { aggregateId: body.accountId } });
    expect(events.map((event) => event.type)).toEqual(['AccountRegistered']);
    expect(events[0]?.payload).toEqual({ audience: 'store' });
  });

  it('treats email case as the same account', async () => {
    const address = email();
    await register('store', address);
    const reply = await register('store', address.toUpperCase());
    expect(reply.status).toBe(409);
    expect(reply.body.code).toBe('account.email_taken');
  });

  it('allows one email on separate surfaces, as separate accounts', async () => {
    const address = email();
    const store = await register('store', address);
    const vendor = await register('vendor', address);
    expect(vendor.status).toBe(201);
    expect(vendor.body.accountId).not.toBe(store.body.accountId);
  });

  it('rejects a short password and an invalid email', async () => {
    expect((await register('store', email(), 'short')).status).toBe(422);
    expect((await register('store', 'not-an-email')).status).toBe(422);
  });

  it('rejects a malformed body with problem details', async () => {
    const reply = await call('POST', 'store/auth/register', { body: { email: 1 } });
    expect(reply.status).toBe(400);
    expect(reply.body.detail).toContain('email');
  });
});

describe('login', () => {
  it('succeeds with the right password', async () => {
    const address = email();
    await register('store', address);
    const reply = await login('store', address);
    expect(reply.status).toBe(200);
    expect((await me('store', reply.body.accessToken)).status).toBe(200);
  });

  it('gives identical replies for a wrong password and an unknown email', async () => {
    const address = email();
    await register('store', address);
    const wrong = await login('store', address, 'wrong-password-here');
    const unknown = await login('store', email());
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect({ ...wrong.body, instance: 0 }).toEqual({ ...unknown.body, instance: 0 });
  });

  it('does not accept an account from another surface', async () => {
    const address = email();
    await register('store', address);
    expect((await login('vendor', address)).status).toBe(401);
    expect((await login('admin', address)).status).toBe(401);
  });

  it('blocks after repeated failures, even with the right password', async () => {
    const address = email();
    await register('store', address);
    for (let i = 0; i < 5; i += 1) expect((await login('store', address, 'wrong-password-here')).status).toBe(401);
    const blocked = await login('store', address);
    expect(blocked.status).toBe(429);
    expect(blocked.body.code).toBe('auth.too_many_attempts');
  });

  it('clears failures after a success', async () => {
    const address = email();
    await register('store', address);
    for (let i = 0; i < 4; i += 1) await login('store', address, 'wrong-password-here');
    expect((await login('store', address)).status).toBe(200);
    for (let i = 0; i < 4; i += 1) await login('store', address, 'wrong-password-here');
    expect((await login('store', address)).status).toBe(200);
  });

  it('blocks a single address spraying many accounts', async () => {
    await prisma.loginFailure.createMany({
      data: Array.from({ length: 100 }, () => ({ key: 'ip:127.0.0.1', occurredAt: new Date() })),
    });
    expect((await login('store', email())).status).toBe(429);
  });

  it('ignores failures older than the window', async () => {
    const address = email();
    await register('store', address);
    await prisma.loginFailure.createMany({
      data: Array.from({ length: 5 }, () => ({
        key: `email:store:${address}`,
        occurredAt: new Date(Date.now() - 16 * 60_000),
      })),
    });
    expect((await login('store', address)).status).toBe(200);
  });
});

describe('refresh tokens', () => {
  it('rotates and issues working tokens', async () => {
    const { body } = await register('store');
    const next = await refresh('store', body.refreshToken);
    expect(next.status).toBe(200);
    expect(next.body.refreshToken).not.toBe(body.refreshToken);
    expect((await me('store', next.body.accessToken)).status).toBe(200);
  });

  it('never extends the absolute expiry', async () => {
    const { body } = await register('store');
    const next = await refresh('store', body.refreshToken);
    expect(next.body.refreshTokenExpiresAt).toBe(body.refreshTokenExpiresAt);
  });

  it('revokes the whole family when an old token is replayed', async () => {
    const { body } = await register('store');
    const next = await refresh('store', body.refreshToken);
    expect((await refresh('store', body.refreshToken)).status).toBe(401);
    expect((await refresh('store', next.body.refreshToken)).status).toBe(401);
    expect((await me('store', next.body.accessToken)).status).toBe(401);
    const logged = await prisma.auditLog.count({
      where: { actorId: body.accountId, action: 'auth.refresh_token_reuse' },
    });
    expect(logged).toBe(1);
  });

  it('issues at most one successor under concurrent use', async () => {
    const { body } = await register('store');
    const replies = await Promise.all([1, 2, 3].map(() => refresh('store', body.refreshToken)));
    expect(replies.filter((reply) => reply.status === 200).length).toBeLessThanOrEqual(1);
    const live = await prisma.session.count({ where: { accountId: body.accountId, revokedAt: null } });
    expect(live).toBeLessThanOrEqual(1);
  });

  it('does not affect other devices when one family is replayed', async () => {
    const address = email();
    const first = await register('store', address);
    const second = await login('store', address);
    await refresh('store', first.body.refreshToken);
    await refresh('store', first.body.refreshToken);
    expect((await me('store', second.body.accessToken)).status).toBe(200);
  });

  it('rejects a token on the wrong surface without revoking it', async () => {
    const { body } = await register('store');
    expect((await refresh('admin', body.refreshToken)).status).toBe(401);
    expect((await refresh('store', body.refreshToken)).status).toBe(200);
  });

  it('rejects an expired token', async () => {
    const { body } = await register('store');
    await prisma.session.updateMany({
      where: { accountId: body.accountId },
      data: { expiresAt: new Date(Date.now() - 1000) },
    });
    expect((await refresh('store', body.refreshToken)).status).toBe(401);
    expect((await me('store', body.accessToken)).status).toBe(401);
  });

  it('rejects an unknown token', async () => {
    expect((await refresh('store', 'unknown-token')).status).toBe(401);
  });

  it('makes the previous access token stop working', async () => {
    const { body } = await register('store');
    await refresh('store', body.refreshToken);
    expect((await me('store', body.accessToken)).status).toBe(401);
  });
});

describe('logout and password change', () => {
  it('ends the session at once', async () => {
    const { body } = await register('store');
    const reply = await call('POST', 'store/auth/logout', { body: { refreshToken: body.refreshToken } });
    expect(reply.status).toBe(204);
    expect((await me('store', body.accessToken)).status).toBe(401);
    expect((await refresh('store', body.refreshToken)).status).toBe(401);
  });

  it('does not record an incident for a token used after normal logout', async () => {
    const { body } = await register('store');
    await call('POST', 'store/auth/logout', { body: { refreshToken: body.refreshToken } });
    expect((await refresh('store', body.refreshToken)).status).toBe(401);
    await expect(
      prisma.auditLog.count({ where: { actorId: body.accountId, action: 'auth.refresh_token_reuse' } }),
    ).resolves.toBe(0);
  });

  it('does not end a session from the wrong surface', async () => {
    const { body } = await register('store');
    await call('POST', 'admin/auth/logout', { body: { refreshToken: body.refreshToken } });
    expect((await me('store', body.accessToken)).status).toBe(200);
  });

  it('refuses a suspended account even if its sessions were left open', async () => {
    const { body } = await register('store');
    await prisma.account.update({ where: { id: body.accountId }, data: { status: 'suspended' } });
    expect((await me('store', body.accessToken)).status).toBe(401);
    expect((await refresh('store', body.refreshToken)).status).toBe(401);
  });

  it('accepts logout with an unknown token', async () => {
    expect((await call('POST', 'store/auth/logout', { body: { refreshToken: 'nope' } })).status).toBe(204);
  });

  it('requires the current password', async () => {
    const { body } = await register('store');
    const reply = await call('POST', 'store/auth/change-password', {
      token: body.accessToken,
      body: { currentPassword: 'wrong-password-here', newPassword: 'another-long-password' },
    });
    expect(reply.status).toBe(401);
    expect((await me('store', body.accessToken)).status).toBe(200);
  });

  it('signs out every device and replaces the password', async () => {
    const address = email();
    const first = await register('store', address);
    const second = await login('store', address);
    const reply = await call('POST', 'store/auth/change-password', {
      token: first.body.accessToken,
      body: { currentPassword: PASSWORD, newPassword: 'another-long-password' },
    });
    expect(reply.status).toBe(204);
    expect((await me('store', first.body.accessToken)).status).toBe(401);
    expect((await me('store', second.body.accessToken)).status).toBe(401);
    expect((await refresh('store', second.body.refreshToken)).status).toBe(401);
    expect((await login('store', address)).status).toBe(401);
    expect((await login('store', address, 'another-long-password')).status).toBe(200);
  });

  it('applies the password policy to the new password', async () => {
    const { body } = await register('store');
    const reply = await call('POST', 'store/auth/change-password', {
      token: body.accessToken,
      body: { currentPassword: PASSWORD, newPassword: 'short' },
    });
    expect(reply.status).toBe(422);
  });
});

describe('staff permissions', () => {
  it.each([
    ['GET', 'admin/staff'],
    ['POST', 'admin/staff'],
    ['GET', 'admin/roles'],
    ['POST', 'admin/roles'],
    ['GET', 'admin/permissions'],
    ['GET', 'admin/audit-logs'],
  ])('%s %s is refused without the permission', async (method, path) => {
    const { token } = await makeStaff(['catalogue.manage']);
    const body = method === 'POST' ? {} : undefined;
    expect((await call(method, path, { token, body })).status).toBe(403);
  });

  it('creates staff and writes an audit entry', async () => {
    const actor = await makeStaff(['staff.manage', 'orders.manage']);
    const reply = await call('POST', 'admin/staff', {
      token: actor.token,
      body: { email: email(), password: PASSWORD, roleIds: [] },
    });
    expect(reply.status).toBe(201);
    const entries = await prisma.auditLog.findMany({ where: { targetId: reply.body.id, action: 'staff.created' } });
    expect(entries).toHaveLength(1);
    expect(entries[0]?.actorId).toBe(actor.id);
    expect(JSON.stringify(entries[0])).not.toContain(PASSWORD);
  });

  it('applies a newly removed permission immediately', async () => {
    const actor = await makeStaff(['staff.manage', 'audit.read']);
    const target = await makeStaff(['audit.read']);
    expect((await call('GET', 'admin/audit-logs', { token: target.token })).status).toBe(200);
    const reply = await call('PUT', `admin/staff/${target.id}/roles`, { token: actor.token, body: { roleIds: [] } });
    expect(reply.status).toBe(204);
    expect((await call('GET', 'admin/audit-logs', { token: target.token })).status).toBe(403);
  });

  it('cuts off a suspended member at once', async () => {
    const actor = await makeStaff(['staff.manage']);
    const target = await makeStaff([]);
    await expect(login('admin', target.email)).resolves.toMatchObject({ status: 200 });
    const reply = await call('POST', `admin/staff/${target.id}/suspend`, { token: actor.token });
    expect(reply.status).toBe(204);
    expect((await me('admin', target.token)).status).toBe(401);
    expect((await login('admin', target.email)).status).toBe(401);
    await expect(prisma.session.count({ where: { accountId: target.id, revokedAt: null } })).resolves.toBe(0);
  });

  it('refuses to grant a role with permissions the actor lacks', async () => {
    const actor = await makeStaff(['staff.manage']);
    const powerful = await makeStaff(['orders.refund']);
    const reply = await call('POST', 'admin/staff', {
      token: actor.token,
      body: { email: email(), password: PASSWORD, roleIds: [powerful.role.id] },
    });
    expect(reply.status).toBe(403);
  });

  it('refuses to create a role with permissions the actor lacks', async () => {
    const actor = await makeStaff(['roles.manage']);
    const reply = await call('POST', 'admin/roles', {
      token: actor.token,
      body: { name: `role_${randomUUID()}`, permissions: ['orders.refund'] },
    });
    expect(reply.status).toBe(403);
  });

  it('refuses permissions that do not exist', async () => {
    const actor = await makeStaff(['roles.manage']);
    const reply = await call('POST', 'admin/roles', {
      token: actor.token,
      body: { name: `role_${randomUUID()}`, permissions: ['made.up'] },
    });
    expect(reply.status).toBe(422);
  });

  it('refuses changes to your own roles', async () => {
    const actor = await makeStaff(['staff.manage']);
    const reply = await call('PUT', `admin/staff/${actor.id}/roles`, { token: actor.token, body: { roleIds: [] } });
    expect(reply.status).toBe(403);
  });

  it('refuses to suspend yourself', async () => {
    const actor = await makeStaff(['staff.manage']);
    expect((await call('POST', `admin/staff/${actor.id}/suspend`, { token: actor.token })).status).toBe(403);
  });

  it.each([
    ['suspend', (id: string) => [`admin/staff/${id}/suspend`, 'POST', undefined] as const],
    ['demote', (id: string) => [`admin/staff/${id}/roles`, 'PUT', { roleIds: [] }] as const],
  ])('refuses to %s staff with more access', async (_name, route) => {
    const actor = await makeStaff(['staff.manage']);
    const senior = await makeStaff(['staff.manage', 'orders.refund']);
    const [path, method, body] = route(senior.id);
    expect((await call(method, path, { token: actor.token, body })).status).toBe(403);
    expect((await me('admin', senior.token)).status).toBe(200);
  });

  it('cannot manage a customer through staff endpoints', async () => {
    const actor = await makeStaff(['staff.manage']);
    const customer = await register('store');
    const reply = await call('POST', `admin/staff/${customer.body.accountId}/suspend`, { token: actor.token });
    expect(reply.status).toBe(404);
  });

  it('rejects a malformed staff id', async () => {
    const actor = await makeStaff(['staff.manage']);
    expect((await call('POST', 'admin/staff/not-a-uuid/suspend', { token: actor.token })).status).toBe(400);
  });

  it('audits staff login and failed login', async () => {
    const target = await makeStaff([]);
    await login('admin', target.email, 'wrong-password-here');
    const actions = await prisma.auditLog.findMany({ where: { actorId: target.id }, select: { action: true } });
    expect(actions.map((a) => a.action).sort()).toEqual(['auth.login', 'auth.login_failed']);
  });

  it('paginates the audit log', async () => {
    const reader = await makeStaff(['audit.read']);
    const first = await call('GET', 'admin/audit-logs?limit=2', { token: reader.token });
    expect(first.body).toHaveLength(2);
    const second = await call('GET', `admin/audit-logs?limit=2&cursor=${first.body[1].id}`, { token: reader.token });
    expect(second.body[0].id).not.toBe(first.body[0].id);
    expect(second.body[0].id).not.toBe(first.body[1].id);
  });
});

describe('atomic audit', () => {
  afterEach(() => jest.restoreAllMocks());

  it('rolls back a suspension when its audit entry cannot be written', async () => {
    const actor = await makeStaff(['staff.manage']);
    const target = await makeStaff([]);
    jest.spyOn(audit, 'appendAudit').mockRejectedValueOnce(new Error('audit down'));
    expect((await call('POST', `admin/staff/${target.id}/suspend`, { token: actor.token })).status).toBe(500);
    expect((await me('admin', target.token)).status).toBe(200);
    const row = await prisma.account.findUniqueOrThrow({ where: { id: target.id } });
    expect(row.status).toBe('active');
  });

  it.each([
    ['suspension', (actor: string, id: string) => call('POST', `admin/staff/${id}/suspend`, { token: actor })],
    ['role change', (actor: string, id: string) => call('PUT', `admin/staff/${id}/roles`, { token: actor, body: { roleIds: [] } })],
  ])('writes the %s audit entry on the transaction', async (_name, act) => {
    const actor = await makeStaff(['staff.manage']);
    const target = await makeStaff([]);
    const append = jest.spyOn(audit, 'appendAudit');
    expect((await act(actor.token, target.id)).status).toBe(204);
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0]?.[0]).not.toBe(staffClient());
  });

  it('writes the staff creation audit entry on the transaction', async () => {
    const actor = await makeStaff(['staff.manage', 'roles.manage']);
    const append = jest.spyOn(audit, 'appendAudit');
    await call('POST', 'admin/staff', { token: actor.token, body: { email: email(), password: PASSWORD, roleIds: [] } });
    expect(append).toHaveBeenCalledTimes(1);
    expect(append.mock.calls[0]?.[0]).not.toBe(staffClient());
  });

  it('rolls back staff creation when its audit entry cannot be written', async () => {
    const actor = await makeStaff(['staff.manage']);
    const address = email();
    jest.spyOn(audit, 'appendAudit').mockRejectedValueOnce(new Error('audit down'));
    const reply = await call('POST', 'admin/staff', {
      token: actor.token,
      body: { email: address, password: PASSWORD, roleIds: [] },
    });
    expect(reply.status).toBe(500);
    await expect(prisma.account.count({ where: { email: address } })).resolves.toBe(0);
  });
});

describe('bootstrap', () => {
  it('refuses once staff exist', async () => {
    await makeStaff([]);
    const address = email();
    await expect(staff.bootstrapSuperAdmin(address, PASSWORD)).rejects.toThrow('already exist');
    await expect(prisma.account.count({ where: { email: address } })).resolves.toBe(0);
  });
});
