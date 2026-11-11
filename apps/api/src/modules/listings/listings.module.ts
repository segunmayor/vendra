import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { CatalogueQueries } from '../catalogue';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { ListingQueries, ListingService } from './application/listings';
import { PrismaListingRepository } from './infrastructure/prisma-listing.repository';
import { ListingsController } from './interface/listings.controller';

@Module({
  imports: [CatalogueModule],
  controllers: [ListingsController],
  providers: [
    {
      provide: ListingService,
      inject: [PrismaService, CatalogueQueries],
      useFactory: (prisma: PrismaService, catalogue: CatalogueQueries) =>
        new ListingService(new PrismaListingRepository(prisma), catalogue, { uuid: randomUUID }, { now: () => new Date() }),
    },
    {
      provide: ListingQueries,
      inject: [PrismaService, CatalogueQueries],
      useFactory: (prisma: PrismaService, catalogue: CatalogueQueries) =>
        new ListingQueries(new PrismaListingRepository(prisma), catalogue),
    },
  ],
  exports: [ListingQueries],
})
export class ListingsModule {}
