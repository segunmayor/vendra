import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { CatalogueQueries } from '../catalogue';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { InventoryQueries } from '../inventory';
import { InventoryModule } from '../inventory/inventory.module';
import { ListingQueries } from '../listings';
import { ListingsModule } from '../listings/listings.module';
import { SettingsReader } from '../settings';
import { CartService } from './application/cart.service';
import { CartPricing } from './application/pricing';
import { CryptoCartTokens, PrismaCartRepository } from './infrastructure/prisma-cart.repository';
import { CartController } from './interface/cart.controller';

@Module({
  imports: [CatalogueModule, ListingsModule, InventoryModule],
  controllers: [CartController],
  providers: [
    {
      provide: CartPricing,
      inject: [ListingQueries, CatalogueQueries, InventoryQueries],
      useFactory: (listings: ListingQueries, catalogue: CatalogueQueries, inventory: InventoryQueries) => new CartPricing(listings, catalogue, inventory),
    },
    {
      provide: CartService,
      inject: [PrismaService, CartPricing, SettingsReader],
      useFactory: (prisma: PrismaService, pricing: CartPricing, settings: SettingsReader) =>
        new CartService(new PrismaCartRepository(prisma), pricing, new CryptoCartTokens(), { uuid: randomUUID }, settings),
    },
  ],
  exports: [CartService, CartPricing],
})
export class CartModule {}
