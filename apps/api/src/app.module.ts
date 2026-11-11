import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { HealthController } from './platform/health/health.controller';
import { ProblemDetailsFilter } from './platform/http/problem-details.filter';
import { PlatformModule } from './platform/platform.module';
import { IdentityModule } from './modules/identity/identity.module';

@Module({
  imports: [PlatformModule, IdentityModule],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
})
export class AppModule {}
