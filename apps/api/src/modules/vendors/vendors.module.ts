import { Module, OnModuleInit } from '@nestjs/common';
import { FileHolders, FileStorage } from '../storage';
import { StorageModule } from '../storage/storage.module';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { AuthService } from '../identity';
import { IdentityModule } from '../identity/identity.module';
import { SettingsReader } from '../settings';
import { VendorsService } from './application/vendors.service';
import { PrismaSellerApplicationRepository, SellerDocumentFiles } from './infrastructure/prisma-seller-application.repository';
import { AdminSellersController, VendorApplicationController } from './interface/vendors.controller';

/** Seller registration and verification. At launch approved sellers wait for marketplace selling to open. */
@Module({
  imports: [IdentityModule, StorageModule],
  controllers: [VendorApplicationController, AdminSellersController],
  providers: [
    {
      provide: VendorsService,
      inject: [PrismaService, SettingsReader, AuthService, FileStorage],
      useFactory: (prisma: PrismaService, settings: SettingsReader, auth: AuthService, files: FileStorage) =>
        new VendorsService(new PrismaSellerApplicationRepository(prisma, files), settings, { emailOf: (id) => auth.emailOf(id) }, { uuid: randomUUID }, { now: () => new Date() }),
    },
  ],
  exports: [VendorsService],
})
export class VendorsModule implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly holders: FileHolders,
  ) {}

  /** Seller documents can be moved between storage locations. */
  onModuleInit(): void {
    this.holders.register(new SellerDocumentFiles(this.prisma));
  }
}
