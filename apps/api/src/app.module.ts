import { Module } from '@nestjs/common';
import { APP_FILTER } from '@nestjs/core';
import { HealthController } from './platform/health/health.controller';
import { ProblemDetailsFilter } from './platform/http/problem-details.filter';
import { PlatformModule } from './platform/platform.module';
import { CartModule } from './modules/cart/cart.module';
import { CatalogueModule } from './modules/catalogue/catalogue.module';
import { CheckoutModule } from './modules/checkout/checkout.module';
import { IdentityModule } from './modules/identity/identity.module';
import { InventoryModule } from './modules/inventory/inventory.module';
import { LedgerModule } from './modules/ledger/ledger.module';
import { OrdersModule } from './modules/orders/orders.module';
import { ListingsModule } from './modules/listings/listings.module';
import { PaymentsModule } from './modules/payments/payments.module';
import { SettingsModule } from './modules/settings/settings.module';
import { LogisticsModule } from './modules/logistics/logistics.module';
import { ShippingModule } from './modules/shipping/shipping.module';
import { StorefrontModule } from './modules/storefront/storefront.module';
import { VendorsModule } from './modules/vendors/vendors.module';

@Module({
  imports: [PlatformModule, SettingsModule, IdentityModule, CatalogueModule, ListingsModule, InventoryModule, StorefrontModule, CartModule, LogisticsModule, CheckoutModule, PaymentsModule, LedgerModule, OrdersModule, ShippingModule, VendorsModule],
  controllers: [HealthController],
  providers: [{ provide: APP_FILTER, useClass: ProblemDetailsFilter }],
})
export class AppModule {}
