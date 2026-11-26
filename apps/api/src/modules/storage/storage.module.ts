import { Inject, Injectable, Logger, Module, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ENV, Env } from '../../platform/config/env';
import { createSealer } from '../../platform/crypto/sealer';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { DriverPool } from './application/drivers';
import { FileHolders } from './application/file-holders';
import { FileStorage } from './application/file-storage';
import { StorageMoveRunner, StorageMoveService } from './application/moves';
import { StorageLocationService } from './application/locations';
import { DriverFactory } from './application/ports';
import { StorageDriverFactory } from './infrastructure/driver-factory';
import { PrismaMoveRepository, sha256Hasher } from './infrastructure/prisma-move.repository';
import { PrismaLocationRepository, PrismaObjectRepository } from './infrastructure/prisma-storage.repository';
import { StorageController } from './interface/storage.controller';
import { StorageMovesController } from './interface/storage-moves.controller';

/** Talks to storage services. Tests replace it so they never leave the machine. */
export const STORAGE_DRIVERS = Symbol('STORAGE_DRIVERS');

const clock = { now: () => new Date() };
const ids = { uuid: randomUUID };

/**
 * Runs file moves in the background. Files are copied one at a time, so a move never competes
 * with shoppers for much; several API instances share the work safely.
 */
@Injectable()
export class StorageMovePoller implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('StorageMoves');
  private timer: NodeJS.Timeout | undefined;
  private busy = false;

  constructor(
    private readonly runner: StorageMoveRunner,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.STORAGE_MOVE_POLL_MS === 0) return;
    this.timer = setInterval(() => void this.tick(), this.env.STORAGE_MOVE_POLL_MS);
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
        // Keep going while moves are waiting.
      }
    } catch (error) {
      this.logger.error(error instanceof Error ? error.message : String(error));
    } finally {
      this.busy = false;
    }
  }
}

@Module({
  controllers: [StorageController, StorageMovesController],
  providers: [
    FileHolders,
    StorageMovePoller,
    {
      provide: StorageMoveService,
      inject: [PrismaService, FileHolders],
      useFactory: (prisma: PrismaService, holders: FileHolders) =>
        new StorageMoveService(new PrismaMoveRepository(prisma), new PrismaLocationRepository(prisma), new PrismaObjectRepository(prisma), holders, ids, clock),
    },
    {
      provide: StorageMoveRunner,
      inject: [PrismaService, FileStorage, FileHolders],
      useFactory: (prisma: PrismaService, files: FileStorage, holders: FileHolders) => {
        const logger = new Logger('StorageMoves');
        return new StorageMoveRunner(new PrismaMoveRepository(prisma), new PrismaLocationRepository(prisma), files, holders, sha256Hasher, clock, { error: (message) => logger.error(message) });
      },
    },
    { provide: STORAGE_DRIVERS, useFactory: (): DriverFactory => new StorageDriverFactory() },
    {
      provide: DriverPool,
      inject: [PrismaService, ENV, STORAGE_DRIVERS],
      useFactory: (prisma: PrismaService, env: Env, drivers: DriverFactory) => {
        const locations = new PrismaLocationRepository(prisma);
        return new DriverPool(drivers, createSealer(env.SETTINGS_ENCRYPTION_KEY, 'storage credentials'), (id) => locations.sealedSecrets(id));
      },
    },
    {
      provide: FileStorage,
      inject: [PrismaService, DriverPool],
      useFactory: (prisma: PrismaService, pool: DriverPool) =>
        new FileStorage(new PrismaLocationRepository(prisma), new PrismaObjectRepository(prisma), pool, ids, clock),
    },
    {
      provide: StorageLocationService,
      inject: [PrismaService, ENV, DriverPool, FileStorage],
      useFactory: (prisma: PrismaService, env: Env, pool: DriverPool, files: FileStorage) =>
        new StorageLocationService(
          new PrismaLocationRepository(prisma),
          createSealer(env.SETTINGS_ENCRYPTION_KEY, 'storage credentials'),
          pool,
          ids,
          clock,
          () => files.invalidate(),
        ),
    },
  ],
  exports: [FileStorage, FileHolders],
})
export class StorageModule {}
