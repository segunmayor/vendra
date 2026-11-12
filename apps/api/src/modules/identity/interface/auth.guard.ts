import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { GUEST_ALLOWED, IS_PUBLIC, MFA_EXEMPT, REQUIRE_MFA, REQUIRED_PERMISSION, SURFACE } from '../../../platform/http/auth.decorators';
import { ApplicationError, Audience, Principal } from '../../../shared-kernel';
import { AuthService } from '../application/auth.service';

/** Runs on every route. A route with no declared policy is refused. */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly auth: AuthService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(IS_PUBLIC, targets)) return true;

    const surface = this.reflector.getAllAndOverride<Audience>(SURFACE, targets);
    if (!surface) throw new ForbiddenException('This route has no access policy');

    const request = context.switchToHttp().getRequest<Request & { principal?: Principal }>();
    const [scheme, token] = (request.headers.authorization ?? '').split(' ');
    if (!request.headers.authorization && this.reflector.getAllAndOverride<boolean>(GUEST_ALLOWED, targets)) return true;
    if (scheme !== 'Bearer' || !token) {
      throw new ApplicationError('unauthenticated', 'auth.token_required', 'Authentication is required');
    }

    const principal = await this.auth.authenticate(token, surface);
    const permission = this.reflector.getAllAndOverride<string>(REQUIRED_PERMISSION, targets);
    if (permission && !principal.permissions.includes(permission)) {
      throw new ApplicationError('forbidden', 'auth.permission_denied', 'You do not have permission to do this');
    }
    if (surface === 'admin' && principal.mfa !== true) await this.checkMfa(targets);
    request.principal = principal;
    return true;
  }

  private async checkMfa(targets: Parameters<Reflector['getAllAndOverride']>[1]): Promise<void> {
    if (this.reflector.getAllAndOverride<boolean>(REQUIRE_MFA, targets)) {
      throw new ApplicationError('forbidden', 'auth.mfa_required', 'Turn on two-step sign-in and sign in with your authenticator code to do this.');
    }
    if (this.reflector.getAllAndOverride<boolean>(MFA_EXEMPT, targets)) return;
    if (await this.auth.staffMfaRequired()) {
      throw new ApplicationError('forbidden', 'auth.mfa_setup_required', 'Set up two-step sign-in to continue.');
    }
  }
}
