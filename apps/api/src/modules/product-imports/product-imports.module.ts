import { Inject, Injectable, Logger, Module, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ENV, Env } from '../../platform/config/env';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { CatalogueService, ProductMediaService } from '../catalogue';
import { CatalogueModule } from '../catalogue/catalogue.module';
import { InventoryService } from '../inventory';
import { InventoryModule } from '../inventory/inventory.module';
import { ListingService } from '../listings';
import { ListingsModule } from '../listings/listings.module';
import { SettingsReader } from '../settings';
import { ImportRunner } from './application/import-runner';
import { ProductImportService } from './application/import.service';
import { PrismaImportRepository } from './infrastructure/prisma-import.repository';
import { sha256 } from './infrastructure/sha256';
import { ProductImportsController } from './interface/imports.controller';

/**
 * Runs queued imports in the background. One product at a time, so an import never competes
 * with shoppers for the database; several API instances share the work safely.
 */
@Injectable()
export class ImportPoller implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('ProductImports');
  private timer: NodeJS.Timeout | undefined;
  private busy = false;

  constructor(
    private readonly runner: ImportRunner,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.IMPORT_POLL_MS === 0) return;
    this.timer = setInterval(() => void this.tick(), this.env.IMPORT_POLL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  async tick(): Promise<void> {
    if (this.busy) return;
    this.busy = true;
    try {
      while (await this.runner.runOnce()) {
        // Keep going while jobs are waiting.
      }
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : String(error));
    } finally {
      this.busy = false;
    }
  }
}

@Module({
  imports: [CatalogueModule, ListingsModule, InventoryModule],
  controllers: [ProductImportsController],
  providers: [
    {
      provide: ProductImportService,
      inject: [PrismaService, CatalogueService, InventoryService, SettingsReader],
      useFactory: (prisma: PrismaService, catalogue: CatalogueService, inventory: InventoryService, settings: SettingsReader) =>
        new ProductImportService(new PrismaImportRepository(prisma), catalogue, inventory, settings, { sha256 }, { uuid: randomUUID }, { now: () => new Date() }),
    },
    {
      provide: ImportRunner,
      inject: [PrismaService, CatalogueService, ProductMediaService, ListingService, InventoryService, SettingsReader],
      useFactory: (
        prisma: PrismaService,
        catalogue: CatalogueService,
        media: ProductMediaService,
        listings: ListingService,
        inventory: InventoryService,
        settings: SettingsReader,
      ) => {
        const logger = new Logger('ProductImports');
        return new ImportRunner(new PrismaImportRepository(prisma), catalogue, media, listings, inventory, settings, { now: () => new Date() }, {
          error: (message) => logger.error(message),
        });
      },
    },
    ImportPoller,
  ],
})
export class ProductImportsModule {}
