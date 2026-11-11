import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { CatalogueQueries } from './application/catalogue.queries';
import { CatalogueService } from './application/catalogue.service';
import {
  PrismaBrandRepository,
  PrismaCategoryRepository,
  PrismaProductRepository,
} from './infrastructure/prisma.adapters';
import { CatalogueController } from './interface/catalogue.controller';

@Module({
  controllers: [CatalogueController],
  providers: [
    {
      provide: CatalogueService,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new CatalogueService(
          new PrismaCategoryRepository(prisma),
          new PrismaBrandRepository(prisma),
          new PrismaProductRepository(prisma),
          { uuid: randomUUID },
          { now: () => new Date() },
        ),
    },
    {
      provide: CatalogueQueries,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new CatalogueQueries(new PrismaProductRepository(prisma)),
    },
  ],
  exports: [CatalogueQueries],
})
export class CatalogueModule {}
