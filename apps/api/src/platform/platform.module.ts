import { Global, Module } from '@nestjs/common';
import { ENV, loadEnv } from './config/env';
import { OutboxRegistry, OutboxRunner } from './outbox/outbox-runner';
import { PrismaService } from './prisma/prisma.service';

@Global()
@Module({
  providers: [PrismaService, { provide: ENV, useFactory: () => loadEnv() }, OutboxRegistry, OutboxRunner],
  exports: [PrismaService, ENV, OutboxRegistry, OutboxRunner],
})
export class PlatformModule {}
