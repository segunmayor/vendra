import type { PrismaClient } from '@prisma/client';
import { WebhookInbox } from '../application/ports';

export class PrismaWebhookInbox implements WebhookInbox {
  constructor(private readonly prisma: PrismaClient) {}

  async begin(provider: string, eventId: string): Promise<boolean> {
    const row = await this.prisma.webhookEvent.upsert({
      where: { provider_providerEventId: { provider, providerEventId: eventId } },
      create: { provider, providerEventId: eventId },
      update: {},
    });
    return row.processedAt === null;
  }

  async complete(provider: string, eventId: string): Promise<void> {
    await this.prisma.webhookEvent.update({
      where: { provider_providerEventId: { provider, providerEventId: eventId } },
      data: { processedAt: new Date() },
    });
  }
}
