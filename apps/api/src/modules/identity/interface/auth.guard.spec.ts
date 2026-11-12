import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { AllowWithoutMfa, Public, RequireMfa, RequirePermission, Surface } from '../../../platform/http/auth.decorators';
import { ApplicationError, Principal } from '../../../shared-kernel';
import { AuthService } from '../application/auth.service';
import { AuthGuard } from './auth.guard';

class Routes {
  noPolicy(): void {}
  @Public() open(): void {}
  @Surface('admin') admin(): void {}
  @Surface('admin') @RequirePermission('orders.refund') refund(): void {}
  @Surface('admin') @AllowWithoutMfa() setup(): void {}
  @Surface('admin') @AllowWithoutMfa() @RequireMfa() sensitive(): void {}
  @Surface('store') shop(): void {}
}

const principal = (permissions: string[], mfa = true): Principal => ({
  accountId: 'a',
  sessionId: 's',
  audience: 'admin',
  permissions,
  mfa,
});

function run(handler: keyof Routes, authenticate: jest.Mock, authorization?: string, mfaRequired = true) {
  const request: { headers: { authorization?: string }; principal?: Principal } = { headers: { authorization } };
  const context = {
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const staffMfaRequired = jest.fn().mockResolvedValue(mfaRequired);
  const guard = new AuthGuard(new Reflector(), { authenticate, staffMfaRequired } as unknown as AuthService);
  return { result: guard.canActivate(context), request };
}

describe('AuthGuard', () => {
  it('denies a route with no declared policy, even with a valid token', async () => {
    const authenticate = jest.fn();
    await expect(run('noPolicy', authenticate, 'Bearer t').result).rejects.toThrow(ForbiddenException);
    expect(authenticate).not.toHaveBeenCalled();
  });

  it('allows a public route without a token', async () => {
    await expect(run('open', jest.fn()).result).resolves.toBe(true);
  });

  it.each([undefined, '', 'Bearer', 'Basic abc'])('requires a bearer token (header %j)', async (header) => {
    await expect(run('admin', jest.fn(), header).result).rejects.toThrow(ApplicationError);
  });

  it('authenticates against the surface of the route', async () => {
    const authenticate = jest.fn().mockResolvedValue(principal([]));
    const { result, request } = run('admin', authenticate, 'Bearer t');
    await expect(result).resolves.toBe(true);
    expect(authenticate).toHaveBeenCalledWith('t', 'admin');
    expect(request.principal?.accountId).toBe('a');
  });

  it('refuses a caller lacking the required permission', async () => {
    const authenticate = jest.fn().mockResolvedValue(principal(['orders.manage']));
    await expect(run('refund', authenticate, 'Bearer t').result).rejects.toThrow('permission');
  });

  it('allows a caller holding the required permission', async () => {
    const authenticate = jest.fn().mockResolvedValue(principal(['orders.refund']));
    await expect(run('refund', authenticate, 'Bearer t').result).resolves.toBe(true);
  });

  describe('two-step sign-in', () => {
    const unverified = () => jest.fn().mockResolvedValue(principal([], false));

    it('sends unverified staff to set it up while the setting requires it', async () => {
      await expect(run('admin', unverified(), 'Bearer t').result).rejects.toMatchObject({ code: 'auth.mfa_setup_required' });
    });

    it('lets unverified staff reach the set-up routes', async () => {
      await expect(run('setup', unverified(), 'Bearer t').result).resolves.toBe(true);
    });

    it('lets unverified staff work when the setting is off', async () => {
      await expect(run('admin', unverified(), 'Bearer t', false).result).resolves.toBe(true);
    });

    it('always requires it for sensitive routes, even when the setting is off', async () => {
      await expect(run('sensitive', unverified(), 'Bearer t', false).result).rejects.toMatchObject({ code: 'auth.mfa_required' });
      await expect(run('sensitive', jest.fn().mockResolvedValue(principal([], true)), 'Bearer t', false).result).resolves.toBe(true);
    });

    it('does not apply to customers', async () => {
      const customer = jest.fn().mockResolvedValue({ ...principal([], false), audience: 'store' });
      await expect(run('shop', customer, 'Bearer t').result).resolves.toBe(true);
    });
  });
});
