import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OutboxRegistry, OutboxRunner } from '../../platform/outbox/outbox-runner';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { CheckoutService } from '../checkout';
import { CheckoutModule } from '../checkout/checkout.module';
import { AuthService } from '../identity';
import { IdentityModule } from '../identity/identity.module';
import { ListingQueries } from '../listings';
import { ListingsModule } from '../listings/listings.module';
import { OrderService, ShipmentProgress } from './application/orders.service';
import { PrismaOrderRepository } from './infrastructure/prisma-order.repository';
import { AdminOrdersController, StoreOrdersController } from './interface/orders.controller';

/**
 * What each shipment status means for the seller order. Statuses before collection change
 * nothing: the items are still with Vendra.
 */
const PROGRESS: Record<string, ShipmentProgress | undefined> = {
  picked_up: 'dispatched',
  in_transit: 'dispatched',
  out_for_delivery: 'dispatched',
  delivery_failed: 'dispatched',
  returning: 'dispatched',
  delivered: 'delivered',
  cancelled: 'back_to_pending',
  returned: 'back_to_pending',
};

/**
 * A paid checkout becomes an order. Safe to repeat: a checkout has at most one order.
 * Shipping's progress moves each seller order along, and delivery of all of them fulfils it.
 */
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
    this.registry.on('ShipmentStatusChanged', async (event) => {
      const { sellerOrderId, status } = event.payload;
      if (typeof sellerOrderId !== 'string' || typeof status !== 'string') throw new Error(`ShipmentStatusChanged ${event.id} is incomplete`);
      const progress = PROGRESS[status];
      if (progress) await this.orders.applyShipmentStatus(sellerOrderId, progress);
    });
  }
}

@Module({
  imports: [CheckoutModule, ListingsModule, IdentityModule],
  controllers: [StoreOrdersController, AdminOrdersController],
  providers: [
    {
      provide: OrderService,
      inject: [PrismaService, CheckoutService, ListingQueries, AuthService, OutboxRunner],
      useFactory: (prisma: PrismaService, checkout: CheckoutService, listings: ListingQueries, auth: AuthService, outbox: OutboxRunner) =>
        new OrderService(
          new PrismaOrderRepository(prisma),
          checkout,
          listings,
          { emailOf: (id) => auth.emailOf(id) },
          { uuid: randomUUID },
          { now: () => new Date() },
          () => outbox.drain(),
        ),
    },
    OrderReactions,
  ],
  exports: [OrderService],
})
export class OrdersModule {}
