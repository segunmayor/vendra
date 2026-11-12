import { Module } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { ENV, Env } from '../../platform/config/env';
import { createSealer } from '../../platform/crypto/sealer';
import { OutboxRunner } from '../../platform/outbox/outbox-runner';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { CheckoutService } from '../checkout';
import { CheckoutModule } from '../checkout/checkout.module';
import { AuthService } from '../identity';
import { IdentityModule } from '../identity/identity.module';
import { SettingsReader } from '../settings';
import { GatewayService } from './application/gateways';
import { PaymentService } from './application/payment.service';
import { RefundService } from './application/refunds';
import { GatewayProviderFactory, PrismaGatewayRepository } from './infrastructure/gateway.adapters';
import { PrismaPaymentRepository, PrismaRefundRepository } from './infrastructure/prisma-payment.repository';
import { PrismaWebhookInbox } from './infrastructure/prisma-webhook-inbox';
import { AdminPaymentsController, AdminRefundsController, GatewaysController, StorePaymentsController, WebhooksController } from './interface/payments.controller';

@Module({
  imports: [CheckoutModule, IdentityModule],
  controllers: [GatewaysController, AdminPaymentsController, AdminRefundsController, StorePaymentsController, WebhooksController],
  providers: [
    {
      provide: GatewayService,
      inject: [PrismaService, ENV],
      useFactory: (prisma: PrismaService, env: Env) =>
        new GatewayService(new PrismaGatewayRepository(prisma), createSealer(env.SETTINGS_ENCRYPTION_KEY, 'gateway credentials'), new GatewayProviderFactory(), { uuid: randomUUID }),
    },
    {
      provide: PaymentService,
      inject: [PrismaService, GatewayService, CheckoutService, AuthService, SettingsReader, OutboxRunner],
      useFactory: (prisma: PrismaService, gateways: GatewayService, checkout: CheckoutService, auth: AuthService, settings: SettingsReader, outbox: OutboxRunner) =>
        new PaymentService(
          new PrismaPaymentRepository(prisma),
          gateways,
          checkout,
          { emailOf: (id) => auth.emailOf(id) },
          new PrismaWebhookInbox(prisma),
          settings,
          { uuid: randomUUID },
          { now: () => new Date() },
          () => outbox.drain(),
        ),
    },
    {
      provide: RefundService,
      inject: [PrismaService, GatewayService, OutboxRunner],
      useFactory: (prisma: PrismaService, gateways: GatewayService, outbox: OutboxRunner) =>
        new RefundService(new PrismaPaymentRepository(prisma), new PrismaRefundRepository(prisma), gateways, { uuid: randomUUID }, { now: () => new Date() }, () => outbox.drain()),
    },
  ],
  exports: [PaymentService],
})
export class PaymentsModule {}
