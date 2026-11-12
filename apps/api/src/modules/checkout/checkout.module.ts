import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { OutboxRegistry } from '../../platform/outbox/outbox-runner';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { CartPricing, CartService } from '../cart';
import { CartModule } from '../cart/cart.module';
import { InventoryCommands } from '../inventory';
import { InventoryModule } from '../inventory/inventory.module';
import { LogisticsService } from '../logistics';
import { LogisticsModule } from '../logistics/logistics.module';
import { SettingsReader } from '../settings';
import { CheckoutService } from './application/checkout.service';
import { PrismaCheckoutRepository } from './infrastructure/prisma-checkout.repository';
import { CheckoutController } from './interface/checkout.controller';

/** When a payment succeeds, the checkout is marked paid and its stock committed as a sale. */
@Injectable()
class CheckoutReactions implements OnModuleInit {
  constructor(
    private readonly registry: OutboxRegistry,
    private readonly checkout: CheckoutService,
  ) {}

  onModuleInit(): void {
    this.registry.on('PaymentSucceeded', async (event) => {
      const checkoutId = event.payload.checkoutId;
      if (typeof checkoutId === 'string') await this.checkout.markPaid(checkoutId, event.aggregateId);
    });
  }
}

@Module({
  imports: [CartModule, LogisticsModule, InventoryModule],
  controllers: [CheckoutController],
  providers: [
    {
      provide: CheckoutService,
      inject: [PrismaService, CartService, CartPricing, LogisticsService, InventoryCommands, SettingsReader],
      useFactory: (
        prisma: PrismaService,
        carts: CartService,
        pricing: CartPricing,
        logistics: LogisticsService,
        inventory: InventoryCommands,
        settings: SettingsReader,
      ) =>
        new CheckoutService(new PrismaCheckoutRepository(prisma), carts, pricing, logistics, inventory, { uuid: randomUUID }, { now: () => new Date() }, settings),
    },
    CheckoutReactions,
  ],
  exports: [CheckoutService],
})
export class CheckoutModule {}
