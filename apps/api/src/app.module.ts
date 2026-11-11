import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { HealthController } from './platform/health/health.controller';
import { ProblemDetailsFilter } from './platform/http/problem-details.filter';
import { PrismaService } from './platform/prisma/prisma.service';

@Module({
  controllers: [HealthController],
  providers: [PrismaService, { provide: APP_FILTER, useClass: ProblemDetailsFilter }],
})
export class AppModule {}
