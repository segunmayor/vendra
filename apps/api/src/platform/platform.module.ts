import { Global, Module } from '@nestjs/common';
import { ENV, loadEnv } from './config/env';
import { PrismaService } from './prisma/prisma.service';

@Global()
@Module({
  providers: [PrismaService, { provide: ENV, useFactory: () => loadEnv() }],
  exports: [PrismaService, ENV],
})
export class PlatformModule {}
