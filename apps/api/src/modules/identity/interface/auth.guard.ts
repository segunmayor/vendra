import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { GUEST_ALLOWED, IS_PUBLIC, REQUIRED_PERMISSION, SURFACE } from '../../../platform/http/auth.decorators';
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
    request.principal = principal;
    return true;
  }
}
