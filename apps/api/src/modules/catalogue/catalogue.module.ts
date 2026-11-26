import { Module, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { FileHolders, FileStorage } from '../storage';
import { StorageModule } from '../storage/storage.module';
import { CatalogueQueries } from './application/catalogue.queries';
import { CatalogueService } from './application/catalogue.service';
import { StorefrontCatalogue } from './application/storefront';
import {
  PrismaBrandRepository,
  PrismaCategoryRepository,
  PrismaProductRepository,
} from './infrastructure/prisma.adapters';
import { PostgresProductSearch } from './infrastructure/product-search';
import { SettingsReader } from '../settings';
import { CatalogueController } from './interface/catalogue.controller';
import { MediaController } from './interface/media.controller';
import { ProductPhotosController } from './interface/product-photos.controller';
import { ProductMediaService } from './application/media';
import { PrismaMediaStore, ProductMediaFiles, sha256Hasher } from './infrastructure/prisma-media.store';
import { SafeRemoteFiles } from './infrastructure/safe-remote-files';

/** Downloads photos from the internet. Tests replace it so they never leave the machine. */
export const REMOTE_FILES = Symbol('REMOTE_FILES');

@Module({
  imports: [StorageModule],
  controllers: [CatalogueController, ProductPhotosController, MediaController],
  providers: [
    {
      provide: CatalogueService,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) =>
        new CatalogueService(
          new PrismaCategoryRepository(prisma),
          new PrismaBrandRepository(prisma),
          new PrismaProductRepository(prisma),
          { uuid: randomUUID },
          { now: () => new Date() },
        ),
    },
    { provide: REMOTE_FILES, useFactory: () => new SafeRemoteFiles() },
    {
      provide: ProductMediaService,
      inject: [PrismaService, REMOTE_FILES, FileStorage],
      useFactory: (prisma: PrismaService, remote: SafeRemoteFiles, files: FileStorage) =>
        new ProductMediaService(new PrismaMediaStore(prisma, files), remote, sha256Hasher, { uuid: randomUUID }),
    },
    {
      provide: CatalogueQueries,
      inject: [PrismaService],
      useFactory: (prisma: PrismaService) => new CatalogueQueries(new PrismaProductRepository(prisma)),
    },
    {
      provide: StorefrontCatalogue,
      inject: [PrismaService, SettingsReader],
      useFactory: (prisma: PrismaService, settings: SettingsReader) =>
        new StorefrontCatalogue(new PostgresProductSearch(prisma, settings), new PrismaCategoryRepository(prisma)),
    },
  ],
  exports: [CatalogueQueries, StorefrontCatalogue, CatalogueService, ProductMediaService],
})
export class CatalogueModule implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly holders: FileHolders,
  ) {}

  /** Product photos can be moved between storage locations. */
  onModuleInit(): void {
    this.holders.register(new ProductMediaFiles(this.prisma));
  }
}
