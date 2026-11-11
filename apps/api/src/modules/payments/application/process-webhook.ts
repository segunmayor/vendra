import { Clock, PaymentProviderPort, PaymentRepository, WebhookInbox } from './ports';

export type WebhookOutcome = 'processed' | 'duplicate' | 'unknown_payment';

export class ProcessPaymentWebhook {
  constructor(
    private readonly provider: PaymentProviderPort,
    private readonly payments: PaymentRepository,
    private readonly inbox: WebhookInbox,
    private readonly clock: Clock,
  ) {}

  async execute(rawBody: Uint8Array, headers: Record<string, string>): Promise<WebhookOutcome> {
    const notice = this.provider.parseWebhook(rawBody, headers);

    if (!(await this.inbox.begin(this.provider.name, notice.eventId))) return 'duplicate';

    const payment = await this.payments.findByReference(notice.reference);
    if (!payment) {
      await this.inbox.complete(this.provider.name, notice.eventId);
      return 'unknown_payment';
    }

    // The webhook only prompts this check. The provider's direct answer is the evidence.
    const verification = await this.provider.verify(notice.reference);
    payment.applyVerification(verification, this.clock.now());
    await this.payments.save(payment);

    // Last, so a failure above leaves the event open for the provider's retry.
    await this.inbox.complete(this.provider.name, notice.eventId);
    return 'processed';
  }
}
