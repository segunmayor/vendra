import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { CartPricing, CartService } from '../cart';
import { CartModule } from '../cart/cart.module';
import { InventoryCommands } from '../inventory';
import { InventoryModule } from '../inventory/inventory.module';
import { LogisticsService } from '../logistics';
import { LogisticsModule } from '../logistics/logistics.module';
import { CheckoutService } from './application/checkout.service';
import { PrismaCheckoutRepository } from './infrastructure/prisma-checkout.repository';
import { CheckoutController } from './interface/checkout.controller';

@Module({
  imports: [CartModule, LogisticsModule, InventoryModule],
  controllers: [CheckoutController],
  providers: [
    {
      provide: CheckoutService,
      inject: [PrismaService, CartService, CartPricing, LogisticsService, InventoryCommands],
      useFactory: (prisma: PrismaService, carts: CartService, pricing: CartPricing, logistics: LogisticsService, inventory: InventoryCommands) =>
        new CheckoutService(new PrismaCheckoutRepository(prisma), carts, pricing, logistics, inventory, { uuid: randomUUID }, { now: () => new Date() }),
    },
  ],
  exports: [CheckoutService],
})
export class CheckoutModule {}
