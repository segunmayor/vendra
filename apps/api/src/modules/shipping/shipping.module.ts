import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OutboxRegistry, OutboxRunner } from '../../platform/outbox/outbox-runner';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { OrderService } from '../orders';
import { OrdersModule } from '../orders/orders.module';
import { ShippingService } from './application/shipping.service';
import { ManualDispatchAdapter } from './infrastructure/manual-dispatch.adapter';
import { PrismaShipmentRepository } from './infrastructure/prisma-shipment.repository';
import { AdminOrderShipmentsController, AdminShipmentsController, StoreTrackingController } from './interface/shipping.controller';

/** Shipments still waiting for collection are cancelled with their order. */
@Injectable()
class ShippingReactions implements OnModuleInit {
  constructor(
    private readonly registry: OutboxRegistry,
    private readonly shipping: ShippingService,
  ) {}

  onModuleInit(): void {
    this.registry.on('OrderCancelled', async (event) => {
      const ids = event.payload.sellerOrderIds;
      if (!Array.isArray(ids) || !ids.every((id) => typeof id === 'string')) throw new Error(`OrderCancelled ${event.id} has no seller orders`);
      await this.shipping.cancelUncollected(ids as string[]);
    });
  }
}

/** At launch, staff arrange riders themselves: manual dispatch. A carrier adapter replaces it later. */
@Module({
  imports: [OrdersModule],
  controllers: [AdminShipmentsController, AdminOrderShipmentsController, StoreTrackingController],
  providers: [
    {
      provide: ShippingService,
      inject: [PrismaService, OrderService, OutboxRunner],
      useFactory: (prisma: PrismaService, orders: OrderService, outbox: OutboxRunner) =>
        new ShippingService(new PrismaShipmentRepository(prisma), orders, new ManualDispatchAdapter(), { uuid: randomUUID }, { now: () => new Date() }, () => outbox.drain()),
    },
    ShippingReactions,
  ],
  exports: [ShippingService],
})
export class ShippingModule {}
