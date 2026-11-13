import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OutboxRunner } from '../../platform/outbox/outbox-runner';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { OrderService } from '../orders';
import { OrdersModule } from '../orders/orders.module';
import { ShippingService } from './application/shipping.service';
import { ManualDispatchAdapter } from './infrastructure/manual-dispatch.adapter';
import { PrismaShipmentRepository } from './infrastructure/prisma-shipment.repository';
import { AdminOrderShipmentsController, AdminShipmentsController, StoreTrackingController } from './interface/shipping.controller';

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
  ],
  exports: [ShippingService],
})
export class ShippingModule {}
