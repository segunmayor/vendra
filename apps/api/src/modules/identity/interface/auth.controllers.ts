import { Body, Controller, Get, HttpCode, Inject, Post, Req } from '@nestjs/common';
import { ApiBearerAuth, ApiCreatedResponse, ApiNoContentResponse, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ENV, Env } from '../../../platform/config/env';
import { CurrentPrincipal, Public, Surface } from '../../../platform/http/auth.decorators';
import { clientIp } from '../../../platform/http/request';
import { ZodPipe } from '../../../platform/http/zod.pipe';
import { Audience, Principal } from '../../../shared-kernel';
import { AccountProfile, AuthService, IssuedSession } from '../application/auth.service';
import {
  ChangePasswordDto,
  changePasswordSchema,
  CredentialsDto,
  credentialsSchema,
  ProfileResponse,
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
    @ApiOkResponse({ type: SessionResponse })
    login(
      @Body(new ZodPipe(credentialsSchema)) body: CredentialsDto,
      @Req() request: Request,
    ): Promise<IssuedSession> {
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

/** Staff accounts are created by other staff, so there is no admin equivalent. */
function createRegistrationController(audience: Exclude<Audience, 'admin'>) {
  @ApiTags(`${audience} auth`)
  @Public()
  @Controller({ path: `${audience}/auth`, version: '1' })
  class RegistrationController {
    constructor(readonly auth: AuthService) {}

    @Post('register')
    @ApiOperation({ operationId: `${audience}Register` })
    @ApiCreatedResponse({ type: SessionResponse })
    register(@Body(new ZodPipe(credentialsSchema)) body: CredentialsDto): Promise<IssuedSession> {
      return this.auth.register(audience, body.email, body.password);
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
];
