import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { HealthController } from './platform/health/health.controller';
import { ProblemDetailsFilter } from './platform/http/problem-details.filter';
import { PlatformModule } from './platform/platform.module';
import { CatalogueModule } from './modules/catalogue/catalogue.module';
import { IdentityModule } from './modules/identity/identity.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { ListingsModule } from './modules/listings/listings.module';
import { StorefrontModule } from './modules/storefront/storefront.module';

@Module({
  imports: [PlatformModule, IdentityModule, CatalogueModule, ListingsModule, InventoryModule, StorefrontModule],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
})
export class AppModule {}
