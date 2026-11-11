import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { ListingQueries } from '../listings';
import { ListingsModule } from '../listings/listings.module';
import { InventoryQueries, InventoryService } from './application/inventory';
import { PrismaStockRepository, PrismaWarehouseRepository } from './infrastructure/prisma.adapters';
import { InventoryController } from './interface/inventory.controller';

@Module({
  imports: [ListingsModule],
  controllers: [InventoryController],
  providers: [
    {
      provide: InventoryService,
      inject: [PrismaService, ListingQueries],
      useFactory: (prisma: PrismaService, listings: ListingQueries) =>
        new InventoryService(
          new PrismaWarehouseRepository(prisma),
          new PrismaStockRepository(prisma),
          listings,
          { uuid: randomUUID },
          { now: () => new Date() },
        ),
    },
    {
      provide: InventoryQueries,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new InventoryQueries(new PrismaStockRepository(prisma)),
    },
  ],
  exports: [InventoryQueries],
})
export class InventoryModule {}
