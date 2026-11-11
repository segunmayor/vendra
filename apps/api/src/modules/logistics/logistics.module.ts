import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { LogisticsService } from './application/logistics';
import { PrismaDeliveryZoneRepository } from './infrastructure/prisma-zone.repository';
import { LogisticsController } from './interface/logistics.controller';

@Module({
  controllers: [LogisticsController],
  providers: [
    {
      provide: LogisticsService,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new LogisticsService(new PrismaDeliveryZoneRepository(prisma), { uuid: randomUUID }),
    },
  ],
  exports: [LogisticsService],
})
export class LogisticsModule {}
