import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { AuthService } from '../identity';
import { IdentityModule } from '../identity/identity.module';
import { SettingsReader } from '../settings';
import { VendorsService } from './application/vendors.service';
import { PrismaSellerApplicationRepository } from './infrastructure/prisma-seller-application.repository';
import { AdminSellersController, VendorApplicationController } from './interface/vendors.controller';

/** Seller registration and verification. At launch approved sellers wait for marketplace selling to open. */
@Module({
  imports: [IdentityModule],
  controllers: [VendorApplicationController, AdminSellersController],
  providers: [
    {
      provide: VendorsService,
      inject: [PrismaService, SettingsReader, AuthService],
      useFactory: (prisma: PrismaService, settings: SettingsReader, auth: AuthService) =>
        new VendorsService(new PrismaSellerApplicationRepository(prisma), settings, { emailOf: (id) => auth.emailOf(id) }, { uuid: randomUUID }, { now: () => new Date() }),
    },
  ],
  exports: [VendorsService],
})
export class VendorsModule {}
