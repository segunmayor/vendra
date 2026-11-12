import { Injectable, Module, OnModuleInit } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { OutboxRegistry } from '../../platform/outbox/outbox-runner';
import { PrismaService } from '../../platform/prisma/prisma.service';
import { Money } from '../../shared-kernel';
import { SettingsReader } from '../settings';
import { PostPaymentReceived, PostRefundPaid } from './application/post-payment';
import { PrismaJournalRepository } from './infrastructure/prisma-journal.repository';

@Injectable()
class LedgerReactions implements OnModuleInit {
  constructor(
    private readonly registry: OutboxRegistry,
    private readonly postPayment: PostPaymentReceived,
    private readonly postRefund: PostRefundPaid,
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
      await this.postRefund.execute(refundId, Money.of(BigInt(amountMinor), currency), new Date(event.occurredAt));
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
    LedgerReactions,
  ],
})
export class LedgerModule {}
