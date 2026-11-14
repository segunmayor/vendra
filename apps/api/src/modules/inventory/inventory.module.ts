import { Inject, Injectable, Logger, Module, OnApplicationBootstrap, OnApplicationShutdown, OnModuleInit } from '@nestjs/common';
import { ENV, Env } from '../../platform/config/env';
import { OutboxRegistry } from '../../platform/outbox/outbox-runner';
import { SettingsReader } from '../settings';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { ListingQueries } from '../listings';
import { ListingsModule } from '../listings/listings.module';
import { InventoryQueries, InventoryService } from './application/inventory';
import { InventoryCommands } from './application/reservations';
import { PrismaReservationStore } from './infrastructure/reservation-store';
import { PrismaStockRepository, PrismaWarehouseRepository } from './infrastructure/prisma.adapters';
import { InventoryController } from './interface/inventory.controller';

/** Releases lapsed holds on a timer. Correctness does not depend on it: reserving frees lapsed holds first. */
@Injectable()
class ReservationSweeper implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('ReservationSweeper');
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly commands: InventoryCommands,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    const seconds = this.env.RESERVATION_SWEEP_SECONDS;
    if (seconds === 0) return;
    this.timer = setInterval(() => {
      this.commands.releaseExpired().then(
        (count) => count > 0 && this.logger.log(`Released ${count} lapsed stock reservations`),
        (error: unknown) => this.logger.error(error instanceof Error ? error.message : String(error)),
      );
    }, seconds * 1000);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }
}

/** A cancelled order's sold stock goes back on sale. */
@Injectable()
class InventoryReactions implements OnModuleInit {
  constructor(
    private readonly registry: OutboxRegistry,
    private readonly commands: InventoryCommands,
  ) {}

  onModuleInit(): void {
    this.registry.on('OrderCancelled', async (event) => {
      const { orderId, checkoutId, stockTaken } = event.payload;
      if (typeof orderId !== 'string' || typeof checkoutId !== 'string') throw new Error(`OrderCancelled ${event.id} is incomplete`);
      if (stockTaken === false) return;
      await this.commands.restock(checkoutId, orderId);
    });
  }
}

@Module({
  imports: [ListingsModule],
  controllers: [InventoryController],
  providers: [
    {
      provide: InventoryService,
      inject: [PrismaService, ListingQueries],
      useFactory: (prisma: PrismaService, listings: ListingQueries) =>
        new InventoryService(
          new PrismaWarehouseRepository(prisma),
          new PrismaStockRepository(prisma),
          listings,
          { uuid: randomUUID },
          { now: () => new Date() },
        ),
    },
    {
      provide: InventoryCommands,
      inject: [PrismaService, SettingsReader],
      useFactory: (prisma: PrismaService, settings: SettingsReader) =>
        new InventoryCommands(new PrismaReservationStore(prisma), { now: () => new Date() }, settings),
    },
    ReservationSweeper,
    InventoryReactions,
    {
      provide: InventoryQueries,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new InventoryQueries(new PrismaStockRepository(prisma)),
    },
  ],
  exports: [InventoryQueries, InventoryCommands],
})
export class InventoryModule {}
