import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ENV, Env } from '../../platform/config/env';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { AuthService } from './application/auth.service';
import { Clock } from './application/ports';
import { StaffService } from './application/staff.service';
import {
  PrismaAccountRepository,
  PrismaAuditTrail,
  PrismaLoginThrottle,
  PrismaRoleRepository,
  PrismaSessionRepository,
} from './infrastructure/prisma.adapters';
import { Argon2PasswordHasher, JwtAccessTokenService, NodeSecrets } from './infrastructure/security.adapters';
import { AuthGuard } from './interface/auth.guard';
import { authControllers } from './interface/auth.controllers';
import { StaffController } from './interface/staff.controller';

const clock: Clock = { now: () => new Date() };

@Module({
  controllers: [...authControllers, StaffController],
  providers: [
    {
      provide: AuthService,
      inject: [PrismaService, ENV],
      useFactory: (prisma: PrismaService, env: Env) =>
        new AuthService(
          new PrismaAccountRepository(prisma),
          new PrismaSessionRepository(prisma),
          new Argon2PasswordHasher(),
          new JwtAccessTokenService(env.JWT_SECRET),
          new NodeSecrets(),
          new PrismaLoginThrottle(prisma),
          new PrismaAuditTrail(prisma),
          clock,
        ),
    },
    {
      provide: StaffService,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new StaffService(
          new PrismaAccountRepository(prisma),
          new PrismaRoleRepository(prisma),
          new Argon2PasswordHasher(),
          new NodeSecrets(),
          new PrismaAuditTrail(prisma),
          clock,
        ),
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService, StaffService],
})
export class IdentityModule {}
