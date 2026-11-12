import { Inject, Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown } from '@nestjs/common';
import { ENV, Env } from '../config/env';
import { PrismaService } from '../prisma/prisma.service';
import { OutboxHandler, OutboxRelay } from './outbox-relay';

/**
 * Where modules register reactions to each other's events, from their own composition
 * file. Platform never imports a module: modules come to it.
 */
@Injectable()
export class OutboxRegistry {
  private readonly handlers: Record<string, OutboxHandler[]> = {};

  on(type: string, handler: OutboxHandler): void {
    (this.handlers[type] ??= []).push(handler);
  }

  snapshot(): Readonly<Record<string, readonly OutboxHandler[]>> {
    return this.handlers;
  }
}

/** Delivers committed events on a timer, and on demand right after an important change. */
@Injectable()
export class OutboxRunner implements OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger('OutboxRunner');
  private timer: NodeJS.Timeout | undefined;
  private running: Promise<void> | null = null;
  private queued: Promise<void> | null = null;

  constructor(
    private readonly prisma: PrismaService,
    private readonly registry: OutboxRegistry,
    @Inject(ENV) private readonly env: Env,
  ) {}

  onApplicationBootstrap(): void {
    if (this.env.OUTBOX_POLL_MS === 0) return;
    this.timer = setInterval(() => void this.drain().catch((error: unknown) => this.logger.error(String(error))), this.env.OUTBOX_POLL_MS);
    this.timer.unref();
  }

  onApplicationShutdown(): void {
    clearInterval(this.timer);
  }

  /**
   * Delivers everything pending, including events committed just before the call. A pass
   * already under way may have started before those events existed, so callers arriving
   * during it wait for exactly one more pass rather than sharing the old one.
   */
  drain(): Promise<void> {
    if (!this.running) {
      this.running = this.pass().finally(() => {
        this.running = null;
      });
      return this.running;
    }
    this.queued ??= this.running.then(() => {
      this.queued = null;
      return this.drain();
    });
    return this.queued;
  }

  private async pass(): Promise<void> {
    const relay = new OutboxRelay(this.prisma, this.registry.snapshot());
    for (let round = 0; round < 20; round += 1) {
      const { published, failed } = await relay.runOnce();
      if (failed > 0) this.logger.warn(`${failed} events failed and will be retried`);
      if (published === 0) break;
    }
  }
}
