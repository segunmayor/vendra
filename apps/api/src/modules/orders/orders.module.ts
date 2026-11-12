import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OutboxRegistry } from '../../platform/outbox/outbox-runner';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { CheckoutService } from '../checkout';
import { CheckoutModule } from '../checkout/checkout.module';
import { AuthService } from '../identity';
import { IdentityModule } from '../identity/identity.module';
import { ListingQueries } from '../listings';
import { ListingsModule } from '../listings/listings.module';
import { OrderService } from './application/orders.service';
import { PrismaOrderRepository } from './infrastructure/prisma-order.repository';
import { AdminOrdersController, StoreOrdersController } from './interface/orders.controller';

/** A paid checkout becomes an order. Safe to repeat: a checkout has at most one order. */
@Injectable()
class OrderReactions implements OnModuleInit {
  constructor(
    private readonly registry: OutboxRegistry,
    private readonly orders: OrderService,
  ) {}

  onModuleInit(): void {
    this.registry.on('CheckoutPaid', async (event) => {
      const checkoutId = event.payload.checkoutId;
      if (typeof checkoutId !== 'string') throw new Error(`CheckoutPaid ${event.id} has no checkout`);
      await this.orders.placeFromCheckout(checkoutId);
    });
  }
}

@Module({
  imports: [CheckoutModule, ListingsModule, IdentityModule],
  controllers: [StoreOrdersController, AdminOrdersController],
  providers: [
    {
      provide: OrderService,
      inject: [PrismaService, CheckoutService, ListingQueries, AuthService],
      useFactory: (prisma: PrismaService, checkout: CheckoutService, listings: ListingQueries, auth: AuthService) =>
        new OrderService(new PrismaOrderRepository(prisma), checkout, listings, { emailOf: (id) => auth.emailOf(id) }, { uuid: randomUUID }, { now: () => new Date() }),
    },
    OrderReactions,
  ],
  exports: [OrderService],
})
export class OrdersModule {}
