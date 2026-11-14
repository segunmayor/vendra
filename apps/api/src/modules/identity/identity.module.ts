import { Injectable, Logger, Module, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ENV, Env } from '../../platform/config/env';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { SettingsReader } from '../settings';
import { createSealer } from '../../platform/crypto/sealer';
import { AuthService } from './application/auth.service';
import { MfaService } from './application/mfa.service';
import { Clock } from './application/ports';
import { StaffService } from './application/staff.service';
import {
  PrismaAccountRepository,
  PrismaAuditTrail,
  PrismaLoginThrottle,
  PrismaMfaRepository,
  PrismaRoleRepository,
  PrismaSessionRepository,
} from './infrastructure/prisma.adapters';
import { Argon2PasswordHasher, JwtAccessTokenService, NodeSecrets } from './infrastructure/security.adapters';
import { RandomRecoveryCodes, RfcTotp } from './infrastructure/totp';
import { AuthGuard } from './interface/auth.guard';
import { authControllers } from './interface/auth.controllers';
import { StaffController } from './interface/staff.controller';

const clock: Clock = { now: () => new Date() };

/** The longest window any sign-in or sign-up limit looks back over, plus an hour. */
const THROTTLE_RETENTION_MS = 25 * 3_600_000;

/** Hourly, deletes sign-in and sign-up records no limit can still use (they hold IP addresses). */
@Injectable()
class ThrottlePurge implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('ThrottlePurge');
  private timer: NodeJS.Timeout | undefined;

  constructor(private readonly prisma: PrismaService) {}

  onApplicationBootstrap(): void {
    this.timer = setInterval(() => {
      new PrismaLoginThrottle(this.prisma).purgeBefore(new Date(Date.now() - THROTTLE_RETENTION_MS)).then(
        (count) => count > 0 && this.logger.log(`Deleted ${count} old sign-in records`),
        (error: unknown) => this.logger.error(error instanceof Error ? error.message : String(error)),
      );
    }, 3_600_000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }
}

@Module({
  controllers: [...authControllers, StaffController],
  providers: [
    ThrottlePurge,
    {
      provide: MfaService,
      inject: [PrismaService, ENV, SettingsReader],
      useFactory: (prisma: PrismaService, env: Env, settings: SettingsReader) =>
        new MfaService(
          new PrismaMfaRepository(prisma),
          new RfcTotp(),
          createSealer(env.SETTINGS_ENCRYPTION_KEY, 'two-step sign-in secrets'),
          new NodeSecrets(),
          new RandomRecoveryCodes(),
          new PrismaLoginThrottle(prisma),
          new PrismaAuditTrail(prisma),
          settings,
          clock,
        ),
    },
    {
      provide: AuthService,
      inject: [PrismaService, ENV, SettingsReader, MfaService],
      useFactory: (prisma: PrismaService, env: Env, settings: SettingsReader, mfa: MfaService) =>
        new AuthService(
          new PrismaAccountRepository(prisma),
          new PrismaSessionRepository(prisma),
          new Argon2PasswordHasher(),
          new JwtAccessTokenService(env.JWT_SECRET),
          new NodeSecrets(),
          new PrismaLoginThrottle(prisma),
          new PrismaAuditTrail(prisma),
          clock,
          settings,
          mfa,
        ),
    },
    {
      provide: StaffService,
      inject: [PrismaService, SettingsReader],
      useFactory: (prisma: PrismaService, settings: SettingsReader) =>
        new StaffService(
          new PrismaAccountRepository(prisma),
          new PrismaRoleRepository(prisma),
          new Argon2PasswordHasher(),
          new NodeSecrets(),
          new PrismaAuditTrail(prisma),
          clock,
          settings,
        ),
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [AuthService, StaffService, MfaService],
})
export class IdentityModule {}
