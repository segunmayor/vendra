import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Public, RequirePermission, Surface } from '../../../platform/http/auth.decorators';
import { ApplicationError, Principal } from '../../../shared-kernel';
import { AuthService } from '../application/auth.service';
import { AuthGuard } from './auth.guard';

class Routes {
  noPolicy(): void {}
  @Public() open(): void {}
  @Surface('admin') admin(): void {}
  @Surface('admin') @RequirePermission('orders.refund') refund(): void {}
}

const principal = (permissions: string[]): Principal => ({
  accountId: 'a',
  sessionId: 's',
  audience: 'admin',
  permissions,
});

function run(handler: keyof Routes, authenticate: jest.Mock, authorization?: string) {
  const request: { headers: { authorization?: string }; principal?: Principal } = { headers: { authorization } };
  const context = {
    getHandler: () => Routes.prototype[handler],
    getClass: () => Routes,
    switchToHttp: () => ({ getRequest: () => request }),
  } as unknown as ExecutionContext;
  const guard = new AuthGuard(new Reflector(), { authenticate } as unknown as AuthService);
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
});
