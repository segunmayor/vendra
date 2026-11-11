import { createParamDecorator, CustomDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Audience, Principal } from '../../shared-kernel';

export const IS_PUBLIC = 'vendra:public';
export const SURFACE = 'vendra:surface';
export const REQUIRED_PERMISSION = 'vendra:permission';

/** Every route is denied unless it is marked `Public` or declares a `Surface`. */
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC, true);

/** Only tokens issued for this audience may call the route. */
export const Surface = (audience: Audience): CustomDecorator => SetMetadata(SURFACE, audience);

export const RequirePermission = (permission: string): CustomDecorator =>
  SetMetadata(REQUIRED_PERMISSION, permission);

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal =>
    context.switchToHttp().getRequest<{ principal: Principal }>().principal,
);
