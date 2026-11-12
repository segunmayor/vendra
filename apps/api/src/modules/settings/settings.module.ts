import { Global, Module } from '@nestjs/common';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { SettingsReader, SettingsService } from './application/settings';
import { PrismaSettingsStore } from './infrastructure/prisma-settings.store';
import { PublicSettingsController, SettingsController } from './interface/settings.controller';

/** Global, since nearly every module reads settings. */
@Global()
@Module({
  controllers: [SettingsController, PublicSettingsController],
  providers: [
    {
      provide: SettingsReader,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new SettingsReader(new PrismaSettingsStore(prisma), { now: () => new Date() }),
    },
    {
      provide: SettingsService,
      inject: [PrismaService, SettingsReader],
      useFactory: (prisma: PrismaService, reader: SettingsReader) => new SettingsService(new PrismaSettingsStore(prisma), reader),
    },
  ],
  exports: [SettingsReader],
})
export class SettingsModule {}
