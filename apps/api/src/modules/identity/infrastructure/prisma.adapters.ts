import { Prisma, type PrismaClient } from '@prisma/client';
import { appendAudit } from '../../../platform/audit/audit';
import { appendToOutbox } from '../../../platform/outbox/outbox';
import { ApplicationError, Audience, AuditEntry } from '../../../shared-kernel';
import {
  AccountRepository,
  AuditRecord,
  AuditTrail,
  LoginThrottle,
  NewSession,
  RoleRepository,
  RoleView,
  SessionRepository,
  SessionView,
  StaffView,
} from '../application/ports';
import { Account, AccountStatus } from '../domain/account';

const isUniqueViolation = (error: unknown): boolean =>
  error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';

type AccountRow = Prisma.AccountGetPayload<object>;

const toAccount = (row: AccountRow): Account =>
  Account.rehydrate({
    id: row.id,
    audience: row.audience,
    email: row.email,
    passwordHash: row.passwordHash,
    status: row.status as AccountStatus,
  });

export class PrismaAccountRepository implements AccountRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async findById(id: string): Promise<Account | null> {
    const row = await this.prisma.account.findUnique({ where: { id } });
    return row ? toAccount(row) : null;
  }

  async findByEmail(audience: Audience, email: string): Promise<Account | null> {
    const row = await this.prisma.account.findUnique({ where: { audience_email: { audience, email } } });
    return row ? toAccount(row) : null;
  }

  countByAudience(audience: Audience): Promise<number> {
    return this.prisma.account.count({ where: { audience } });
  }

  async insert(account: Account, options: { audit?: AuditEntry; roleIds?: readonly string[] } = {}): Promise<void> {
    const events = account.pullEvents();
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.account.create({
          data: {
            ...account.snapshot,
            roles: { create: (options.roleIds ?? []).map((roleId) => ({ roleId })) },
          },
        });
        if (options.audit) await appendAudit(tx, options.audit);
        await appendToOutbox(tx, events);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApplicationError('conflict', 'account.email_taken', 'This email is already registered');
      }
      throw error;
    }
  }

  async save(account: Account, options: { audit?: AuditEntry; revokeSessionsAt?: Date } = {}): Promise<void> {
    const { id, passwordHash, status } = account.snapshot;
    const events = account.pullEvents();
    await this.prisma.$transaction(async (tx) => {
      await tx.account.update({ where: { id }, data: { passwordHash, status } });
      if (options.revokeSessionsAt) {
        await tx.session.updateMany({
          where: { accountId: id, revokedAt: null },
          data: { revokedAt: options.revokeSessionsAt },
        });
      }
      if (options.audit) await appendAudit(tx, options.audit);
      await appendToOutbox(tx, events);
    });
  }
}

const sessionInclude = { account: { select: { audience: true, status: true } } } as const;
type SessionRow = Prisma.SessionGetPayload<{ include: typeof sessionInclude }>;

const toSession = (row: SessionRow): SessionView => ({
  id: row.id,
  accountId: row.accountId,
  familyId: row.familyId,
  refreshTokenHash: row.refreshTokenHash,
  expiresAt: row.expiresAt,
  revokedAt: row.revokedAt,
  audience: row.account.audience,
  accountStatus: row.account.status as AccountStatus,
});

export class PrismaSessionRepository implements SessionRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(session: NewSession): Promise<void> {
    await this.prisma.session.create({ data: session });
  }

  async findByTokenHash(hash: string): Promise<SessionView | null> {
    const row = await this.prisma.session.findUnique({
      where: { refreshTokenHash: hash },
      include: sessionInclude,
    });
    return row ? toSession(row) : null;
  }

  rotate(oldId: string, next: NewSession, now: Date): Promise<boolean> {
    return this.prisma.$transaction(async (tx) => {
      const { count } = await tx.session.updateMany({
        where: { id: oldId, revokedAt: null },
        data: { revokedAt: now },
      });
      if (count !== 1) return false;
      await tx.session.create({ data: next });
      return true;
    });
  }

  async revokeFamily(familyId: string, now: Date): Promise<number> {
    const { count } = await this.prisma.session.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: now },
    });
    return count;
  }

  async findWithPermissions(id: string): Promise<{ session: SessionView; permissions: string[] } | null> {
    const row = await this.prisma.session.findUnique({
      where: { id },
      include: {
        account: {
          select: {
            audience: true,
            status: true,
            roles: { select: { role: { select: { permissions: { select: { permission: true } } } } } },
          },
        },
      },
    });
    if (!row) return null;
    const permissions = row.account.roles.flatMap(({ role }) => role.permissions.map((p) => p.permission));
    return { session: toSession(row), permissions: [...new Set(permissions)] };
  }
}

const roleInclude = { permissions: { select: { permission: true } } } as const;
type RoleRow = Prisma.RoleGetPayload<{ include: typeof roleInclude }>;

const toRole = (row: RoleRow): RoleView => ({
  id: row.id,
  name: row.name,
  permissions: row.permissions.map((p) => p.permission),
});

export class PrismaRoleRepository implements RoleRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async list(): Promise<RoleView[]> {
    return (await this.prisma.role.findMany({ include: roleInclude, orderBy: { name: 'asc' } })).map(toRole);
  }

  async findByIds(ids: readonly string[]): Promise<RoleView[]> {
    const rows = await this.prisma.role.findMany({ where: { id: { in: [...ids] } }, include: roleInclude });
    return rows.map(toRole);
  }

  async findByName(name: string): Promise<RoleView | null> {
    const row = await this.prisma.role.findUnique({ where: { name }, include: roleInclude });
    return row ? toRole(row) : null;
  }

  async create(role: RoleView, audit: AuditEntry | null): Promise<void> {
    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.role.create({
          data: {
            id: role.id,
            name: role.name,
            permissions: { create: role.permissions.map((permission) => ({ permission })) },
          },
        });
        if (audit) await appendAudit(tx, audit);
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ApplicationError('conflict', 'role.name_taken', 'A role with this name already exists');
      }
      throw error;
    }
  }

  async permissionsOf(accountId: string): Promise<string[]> {
    const rows = await this.prisma.accountRole.findMany({
      where: { accountId },
      select: { role: { select: { permissions: { select: { permission: true } } } } },
    });
    return [...new Set(rows.flatMap(({ role }) => role.permissions.map((p) => p.permission)))];
  }

  async setAccountRoles(accountId: string, roleIds: readonly string[], audit: AuditEntry | null): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.accountRole.deleteMany({ where: { accountId } });
      await tx.accountRole.createMany({ data: roleIds.map((roleId) => ({ accountId, roleId })) });
      if (audit) await appendAudit(tx, audit);
    });
  }

  async listStaff(): Promise<StaffView[]> {
    const rows = await this.prisma.account.findMany({
      where: { audience: 'admin' },
      orderBy: { createdAt: 'asc' },
      select: {
        id: true,
        email: true,
        status: true,
        roles: { select: { role: { select: { id: true, name: true } } } },
      },
    });
    return rows.map((row) => ({
      id: row.id,
      email: row.email,
      status: row.status as AccountStatus,
      roles: row.roles.map(({ role }) => role),
    }));
  }
}

export class PrismaLoginThrottle implements LoginThrottle {
  constructor(private readonly prisma: PrismaClient) {}

  async isBlocked(checks: readonly { key: string; limit: number }[], since: Date): Promise<boolean> {
    const counts = await Promise.all(
      checks.map(({ key }) => this.prisma.loginFailure.count({ where: { key, occurredAt: { gte: since } } })),
    );
    return checks.some(({ limit }, index) => (counts[index] ?? 0) >= limit);
  }

  async recordFailure(keys: readonly string[], now: Date): Promise<void> {
    await this.prisma.loginFailure.createMany({ data: keys.map((key) => ({ key, occurredAt: now })) });
  }

  async clear(key: string): Promise<void> {
    await this.prisma.loginFailure.deleteMany({ where: { key } });
  }
}

export class PrismaAuditTrail implements AuditTrail {
  constructor(private readonly prisma: PrismaClient) {}

  record(entry: AuditEntry): Promise<void> {
    return appendAudit(this.prisma, entry);
  }

  async list(limit: number, cursor?: string): Promise<AuditRecord[]> {
    const rows = await this.prisma.auditLog.findMany({
      take: limit,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    return rows.map((row) => ({
      id: row.id,
      createdAt: row.createdAt,
      actorId: row.actorId,
      action: row.action,
      targetType: row.targetType,
      targetId: row.targetId,
      before: (row.before as Record<string, unknown> | null) ?? undefined,
      after: (row.after as Record<string, unknown> | null) ?? undefined,
      ipAddress: row.ipAddress ?? undefined,
    }));
  }
}
