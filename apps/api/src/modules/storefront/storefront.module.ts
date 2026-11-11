import { Module } from '@nestjs/common';
import { StorefrontCatalogue } from '../catalogue';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { InventoryQueries } from '../inventory';
import { InventoryModule } from '../inventory/inventory.module';
import { ListingQueries } from '../listings';
import { ListingsModule } from '../listings/listings.module';
import { StorefrontService } from './application/storefront.service';
import { StorefrontController } from './interface/storefront.controller';

/** The customer's catalogue. Owns no aggregate; it reads other modules' contracts. */
@Module({
  imports: [CatalogueModule, ListingsModule, InventoryModule],
  controllers: [StorefrontController],
  providers: [
    {
      provide: StorefrontService,
      inject: [StorefrontCatalogue, ListingQueries, InventoryQueries],
      useFactory: (catalogue: StorefrontCatalogue, listings: ListingQueries, inventory: InventoryQueries) =>
        new StorefrontService(catalogue, listings, inventory),
    },
  ],
})
export class StorefrontModule {}
