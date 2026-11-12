import { createParamDecorator, CustomDecorator, ExecutionContext, SetMetadata } from '@nestjs/common';
import { Audience, Principal } from '../../shared-kernel';

export const IS_PUBLIC = 'vendra:public';
export const SURFACE = 'vendra:surface';
export const REQUIRED_PERMISSION = 'vendra:permission';
export const GUEST_ALLOWED = 'vendra:guest-allowed';
export const MFA_EXEMPT = 'vendra:mfa-exempt';
export const REQUIRE_MFA = 'vendra:require-mfa';

/** Every route is denied unless it is marked `Public` or declares a `Surface`. */
export const Public = (): CustomDecorator => SetMetadata(IS_PUBLIC, true);

/** Only tokens issued for this audience may call the route. */
export const Surface = (audience: Audience): CustomDecorator => SetMetadata(SURFACE, audience);

/**
 * With a `Surface`: a request without a token proceeds as a guest, with no principal.
 * A request that sends a token must still send a valid one for that surface.
 */
export const GuestAllowed = (): CustomDecorator => SetMetadata(GUEST_ALLOWED, true);

/**
 * Staff routes a person may use before setting up two-step sign-in, such as setting it up.
 * Every other staff route needs a verified second factor while the setting requires one.
 */
export const AllowWithoutMfa = (): CustomDecorator => SetMetadata(MFA_EXEMPT, true);

/** Staff routes that always need a verified second factor, whatever the setting says. */
export const RequireMfa = (): CustomDecorator => SetMetadata(REQUIRE_MFA, true);

export const RequirePermission = (permission: string): CustomDecorator =>
  SetMetadata(REQUIRED_PERMISSION, permission);

export const CurrentPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal =>
    context.switchToHttp().getRequest<{ principal: Principal }>().principal,
);

/** The caller, or undefined for a guest on a `GuestAllowed` route. */
export const OptionalPrincipal = createParamDecorator(
  (_data: unknown, context: ExecutionContext): Principal | undefined =>
    context.switchToHttp().getRequest<{ principal?: Principal }>().principal,
);
