import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OutboxRegistry } from '../../platform/outbox/outbox-runner';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { Money } from '../../shared-kernel';
import { SettingsReader } from '../settings';
import { PostOrderDelivered, PostPaymentReceived, PostRefundPaid } from './application/post-payment';
import { PrismaJournalRepository } from './infrastructure/prisma-journal.repository';

@Injectable()
class LedgerReactions implements OnModuleInit {
  constructor(
    private readonly registry: OutboxRegistry,
    private readonly postPayment: PostPaymentReceived,
    private readonly postRefund: PostRefundPaid,
    private readonly postDelivered: PostOrderDelivered,
  ) {}

  onModuleInit(): void {
    this.registry.on('PaymentSucceeded', async (event) => {
      const { amountMinor, currency } = event.payload;
      if (typeof amountMinor !== 'string' || typeof currency !== 'string') throw new Error(`PaymentSucceeded ${event.id} has no amount`);
      await this.postPayment.execute(event.aggregateId, Money.of(BigInt(amountMinor), currency), new Date(event.occurredAt));
    });
    this.registry.on('PaymentRefunded', async (event) => {
      const { refundId, amountMinor, currency } = event.payload;
      if (typeof refundId !== 'string' || typeof amountMinor !== 'string' || typeof currency !== 'string') throw new Error(`PaymentRefunded ${event.id} is incomplete`);
      await this.postRefund.execute(refundId, event.aggregateId, Money.of(BigInt(amountMinor), currency), new Date(event.occurredAt));
    });
    this.registry.on('OrderFulfilled', async (event) => {
      const { orderId, paymentId, subtotalMinor, deliveryMinor, currency } = event.payload;
      if (typeof orderId !== 'string' || typeof paymentId !== 'string' || typeof subtotalMinor !== 'string' || typeof deliveryMinor !== 'string' || typeof currency !== 'string') {
        throw new Error(`OrderFulfilled ${event.id} is incomplete`);
      }
      const amounts = { subtotal: Money.of(BigInt(subtotalMinor), currency), delivery: Money.of(BigInt(deliveryMinor), currency) };
      await this.postDelivered.execute(orderId, paymentId, amounts, new Date(event.occurredAt));
    });
  }
}

@Module({
  providers: [
    {
      provide: PostPaymentReceived,
      inject: [PrismaService, SettingsReader],
      useFactory: (prisma: PrismaService, settings: SettingsReader) => new PostPaymentReceived(new PrismaJournalRepository(prisma), settings, { uuid: randomUUID }),
    },
    {
      provide: PostRefundPaid,
      inject: [PrismaService, SettingsReader],
      useFactory: (prisma: PrismaService, settings: SettingsReader) => new PostRefundPaid(new PrismaJournalRepository(prisma), settings, { uuid: randomUUID }),
    },
    {
      provide: PostOrderDelivered,
      inject: [PrismaService, SettingsReader],
      useFactory: (prisma: PrismaService, settings: SettingsReader) => new PostOrderDelivered(new PrismaJournalRepository(prisma), settings, { uuid: randomUUID }),
    },
    LedgerReactions,
  ],
})
export class LedgerModule {}
