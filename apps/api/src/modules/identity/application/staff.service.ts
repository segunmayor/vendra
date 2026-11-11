import { ApplicationError, DomainError, Principal } from '../../../shared-kernel';
import { Account, assertPasswordAllowed } from '../domain/account';
import { isPermission, PERMISSIONS } from '../domain/permissions';
import {
  AccountRepository,
  AuditRecord,
  AuditTrail,
  Clock,
  PasswordHasher,
  RoleRepository,
  RoleView,
  Secrets,
  StaffView,
} from './ports';

export const SUPER_ADMIN_ROLE = 'super_admin';

const forbidden = (message: string): ApplicationError =>
  new ApplicationError('forbidden', 'staff.not_allowed', message);
const staffNotFound = (): ApplicationError =>
  new ApplicationError('not_found', 'staff.not_found', 'Staff member not found');

export class StaffService {
  constructor(
    private readonly accounts: AccountRepository,
    private readonly roles: RoleRepository,
    private readonly hasher: PasswordHasher,
    private readonly secrets: Secrets,
    private readonly audit: AuditTrail,
    private readonly clock: Clock,
  ) {}

  listPermissions(): readonly string[] {
    return PERMISSIONS;
  }

  listRoles(): Promise<RoleView[]> {
    return this.roles.list();
  }

  listStaff(): Promise<StaffView[]> {
    return this.roles.listStaff();
  }

  listAudit(limit: number, cursor?: string): Promise<AuditRecord[]> {
    return this.audit.list(limit, cursor);
  }

  async createRole(actor: Principal, name: string, permissions: readonly string[]): Promise<RoleView> {
    const unique = [...new Set(permissions)];
    const unknown = unique.filter((permission) => !isPermission(permission));
    if (unknown.length > 0) {
      throw new DomainError('role.unknown_permission', `Unknown permissions: ${unknown.join(', ')}`);
    }
    this.assertHolds(actor, unique);
    const role: RoleView = { id: this.secrets.uuid(), name, permissions: unique };
    await this.roles.create(role, {
      actorId: actor.accountId,
      action: 'role.created',
      targetType: 'role',
      targetId: role.id,
      after: { name, permissions: unique },
    });
    return role;
  }

  async createStaff(
    actor: Principal,
    email: string,
    password: string,
    roleIds: readonly string[],
  ): Promise<{ id: string }> {
    assertPasswordAllowed(password);
    const unique = await this.loadGrantableRoles(actor, roleIds);
    const account = Account.register({
      id: this.secrets.uuid(),
      audience: 'admin',
      email,
      passwordHash: await this.hasher.hash(password),
      now: this.clock.now(),
    });
    await this.accounts.insert(account, {
      roleIds: unique,
      audit: {
        actorId: actor.accountId,
        action: 'staff.created',
        targetType: 'account',
        targetId: account.snapshot.id,
        after: { email: account.snapshot.email, roleIds: unique },
      },
    });
    return { id: account.snapshot.id };
  }

  async setRoles(actor: Principal, targetId: string, roleIds: readonly string[]): Promise<void> {
    if (actor.accountId === targetId) throw forbidden('You cannot change your own roles');
    await this.loadManageableStaff(actor, targetId);
    const unique = await this.loadGrantableRoles(actor, roleIds);
    await this.roles.setAccountRoles(targetId, unique, {
      actorId: actor.accountId,
      action: 'staff.roles_changed',
      targetType: 'account',
      targetId,
      after: { roleIds: unique },
    });
  }

  async suspend(actor: Principal, targetId: string): Promise<void> {
    if (actor.accountId === targetId) throw forbidden('You cannot suspend yourself');
    const account = await this.loadManageableStaff(actor, targetId);
    const now = this.clock.now();
    account.suspend(now);
    await this.accounts.save(account, {
      revokeSessionsAt: now,
      audit: { actorId: actor.accountId, action: 'staff.suspended', targetType: 'account', targetId },
    });
  }

  /** Creates the first administrator. Refuses once any staff account exists. */
  async bootstrapSuperAdmin(email: string, password: string): Promise<{ id: string }> {
    assertPasswordAllowed(password);
    if ((await this.accounts.countByAudience('admin')) > 0) {
      throw new ApplicationError('conflict', 'staff.already_bootstrapped', 'Staff accounts already exist');
    }
    let role = await this.roles.findByName(SUPER_ADMIN_ROLE);
    if (!role) {
      role = { id: this.secrets.uuid(), name: SUPER_ADMIN_ROLE, permissions: PERMISSIONS };
      await this.roles.create(role, null);
    }
    const account = Account.register({
      id: this.secrets.uuid(),
      audience: 'admin',
      email,
      passwordHash: await this.hasher.hash(password),
      now: this.clock.now(),
    });
    await this.accounts.insert(account, {
      roleIds: [role.id],
      audit: {
        actorId: null,
        action: 'staff.bootstrapped',
        targetType: 'account',
        targetId: account.snapshot.id,
      },
    });
    return { id: account.snapshot.id };
  }

  /** Nobody can hand out access they do not hold themselves. */
  private assertHolds(actor: Principal, permissions: readonly string[]): void {
    const missing = permissions.filter((permission) => !actor.permissions.includes(permission));
    if (missing.length > 0) throw forbidden('You cannot grant permissions you do not hold');
  }

  private async loadGrantableRoles(actor: Principal, roleIds: readonly string[]): Promise<string[]> {
    const unique = [...new Set(roleIds)];
    const roles = await this.roles.findByIds(unique);
    if (roles.length !== unique.length) {
      throw new ApplicationError('not_found', 'role.not_found', 'Role not found');
    }
    this.assertHolds(actor, roles.flatMap((role) => role.permissions));
    return unique;
  }

  /** Staff with more access than the actor cannot be modified by them. */
  private async loadManageableStaff(actor: Principal, targetId: string): Promise<Account> {
    const account = await this.accounts.findById(targetId);
    if (!account || account.snapshot.audience !== 'admin') throw staffNotFound();
    const held = await this.roles.permissionsOf(targetId);
    if (held.some((permission) => !actor.permissions.includes(permission))) {
      throw forbidden('You cannot modify staff with more access than you');
    }
    return account;
  }
}
