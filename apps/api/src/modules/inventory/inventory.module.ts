import { Inject, Injectable, Logger, Module, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ENV, Env } from '../../platform/config/env';
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
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new InventoryCommands(new PrismaReservationStore(prisma), { now: () => new Date() }),
    },
    ReservationSweeper,
    {
      provide: InventoryQueries,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new InventoryQueries(new PrismaStockRepository(prisma)),
    },
  ],
  exports: [InventoryQueries, InventoryCommands],
})
export class InventoryModule {}
