import { Body, Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ENV, Env } from '../../../platform/config/env';
import { AllowWithoutMfa, CurrentPrincipal, Public, RequireMfa, Surface } from '../../../platform/http/auth.decorators';
import { clientIp } from '../../../platform/http/request';
import { ZodPipe } from '../../../platform/http/zod.pipe';
import { Audience, Principal } from '../../../shared-kernel';
import { AccountProfile, AuthService, IssuedSession, LoginResult } from '../application/auth.service';
import { MfaEnrolment, MfaService, MfaStatus } from '../application/mfa.service';
import {
  AdminLoginResponse,
  ChangePasswordDto,
  changePasswordSchema,
  CredentialsDto,
  credentialsSchema,
  MfaCodeDto,
  mfaCodeSchema,
  MfaEnrolmentResponse,
  MfaStatusResponse,
  MfaVerifyDto,
  mfaVerifySchema,
  ProfileResponse,
  RecoveryCodesResponse,
  RefreshDto,
  refreshSchema,
  SessionResponse,
} from './dto';

/** One definition, three surfaces, so the portals cannot drift apart. */
function createAuthController(audience: Audience) {
  @ApiTags(`${audience} auth`)
  @Surface(audience)
  @Controller({ path: `${audience}/auth`, version: '1' })
  class AuthController {
    constructor(
      readonly auth: AuthService,
      @Inject(ENV) readonly env: Env,
    ) {}

    @Public()
    @Post('login')
    @HttpCode(200)
    @ApiOperation({ operationId: `${audience}Login` })
    @ApiOkResponse({ type: audience === 'admin' ? AdminLoginResponse : SessionResponse })
    login(
      @Body(new ZodPipe(credentialsSchema)) body: CredentialsDto,
      @Req() request: Request,
    ): Promise<LoginResult> {
      return this.auth.login(audience, body.email, body.password, clientIp(request, this.env.PORTAL_SHARED_SECRET));
    }

    @Public()
    @Post('refresh')
    @HttpCode(200)
    @ApiOperation({ operationId: `${audience}Refresh` })
    @ApiOkResponse({ type: SessionResponse })
    refresh(@Body(new ZodPipe(refreshSchema)) body: RefreshDto): Promise<IssuedSession> {
      return this.auth.refresh(audience, body.refreshToken);
    }

    @Public()
    @Post('logout')
    @HttpCode(204)
    @ApiOperation({ operationId: `${audience}Logout` })
    @ApiNoContentResponse()
    logout(@Body(new ZodPipe(refreshSchema)) body: RefreshDto): Promise<void> {
      return this.auth.logout(audience, body.refreshToken);
    }

    @Get('me')
    @AllowWithoutMfa()
    @ApiBearerAuth()
    @ApiOperation({ operationId: `${audience}Me` })
    @ApiOkResponse({ type: ProfileResponse })
    me(@CurrentPrincipal() principal: Principal): Promise<AccountProfile> {
      return this.auth.profile(principal);
    }

    @Post('change-password')
    @HttpCode(204)
    @ApiBearerAuth()
    @ApiOperation({ operationId: `${audience}ChangePassword` })
    @ApiNoContentResponse()
    changePassword(
      @CurrentPrincipal() principal: Principal,
      @Body(new ZodPipe(changePasswordSchema)) body: ChangePasswordDto,
    ): Promise<void> {
      return this.auth.changePassword(principal, body.currentPassword, body.newPassword);
    }
  }
  return AuthController;
}

/** Staff two-step sign-in: setting it up, and the second step of signing in. */
@ApiTags('admin auth')
@Surface('admin')
@Controller({ path: 'admin/auth/mfa', version: '1' })
export class AdminMfaController {
  constructor(
    private readonly auth: AuthService,
    private readonly mfa: MfaService,
    @Inject(ENV) private readonly env: Env,
  ) {}

  @Public()
  @Post('verify')
  @HttpCode(200)
  @ApiOperation({ operationId: 'adminMfaVerify', summary: 'Second step of sign-in: a code from the app, or a recovery code' })
  @ApiOkResponse({ type: SessionResponse })
  verify(@Body(new ZodPipe(mfaVerifySchema)) body: MfaVerifyDto, @Req() request: Request): Promise<IssuedSession> {
    return this.auth.completeMfaLogin(body.challengeToken, body.code, clientIp(request, this.env.PORTAL_SHARED_SECRET));
  }

  @Get()
  @AllowWithoutMfa()
  @ApiBearerAuth()
  @ApiOperation({ operationId: 'adminMfaStatus' })
  @ApiOkResponse({ type: MfaStatusResponse })
  status(@CurrentPrincipal() principal: Principal): Promise<MfaStatus> {
    return this.mfa.status(principal);
  }

  @Post('setup')
  @HttpCode(200)
  @AllowWithoutMfa()
  @ApiBearerAuth()
  @ApiOperation({ operationId: 'adminMfaSetup', summary: 'Starts setting up an authenticator app' })
  @ApiOkResponse({ type: MfaEnrolmentResponse })
  setup(@CurrentPrincipal() principal: Principal): Promise<MfaEnrolment> {
    return this.mfa.begin(principal);
  }

  @Post('confirm')
  @HttpCode(200)
  @AllowWithoutMfa()
  @ApiBearerAuth()
  @ApiOperation({ operationId: 'adminMfaConfirm', summary: 'Turns two-step sign-in on. Returns recovery codes once.' })
  @ApiOkResponse({ type: RecoveryCodesResponse })
  confirm(@CurrentPrincipal() principal: Principal, @Body(new ZodPipe(mfaCodeSchema)) body: MfaCodeDto): Promise<{ recoveryCodes: string[] }> {
    return this.mfa.confirm(principal, body.code);
  }

  @Post('recovery-codes')
  @HttpCode(200)
  @RequireMfa()
  @ApiBearerAuth()
  @ApiOperation({ operationId: 'adminMfaRecoveryCodes', summary: 'Replaces the recovery codes' })
  @ApiOkResponse({ type: RecoveryCodesResponse })
  recoveryCodes(@CurrentPrincipal() principal: Principal, @Body(new ZodPipe(mfaCodeSchema)) body: MfaCodeDto): Promise<{ recoveryCodes: string[] }> {
    return this.mfa.regenerateRecoveryCodes(principal, body.code);
  }
}

/** Staff accounts are created by other staff, so there is no admin equivalent. */
function createRegistrationController(audience: Exclude<Audience, 'admin'>) {
  @ApiTags(`${audience} auth`)
  @Public()
  @Controller({ path: `${audience}/auth`, version: '1' })
  class RegistrationController {
    constructor(
      readonly auth: AuthService,
      @Inject(ENV) readonly env: Env,
    ) {}

    @Post('register')
    @ApiOperation({ operationId: `${audience}Register` })
    @ApiCreatedResponse({ type: SessionResponse })
    register(@Body(new ZodPipe(credentialsSchema)) body: CredentialsDto, @Req() request: Request): Promise<IssuedSession> {
      return this.auth.register(audience, body.email, body.password, clientIp(request, this.env.PORTAL_SHARED_SECRET));
    }
  }
  return RegistrationController;
}

export const authControllers = [
  createAuthController('store'),
  createAuthController('vendor'),
  createAuthController('admin'),
  createRegistrationController('store'),
  createRegistrationController('vendor'),
  AdminMfaController,
];
