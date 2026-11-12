import { timingSafeEqual } from 'node:crypto';
import { Money } from '../../../shared-kernel';
import { InitializePaymentRequest, InvalidWebhookSignature, PaymentProviderPort, ProviderUnavailable, WebhookNotice } from '../application/ports';
import { ProviderVerification } from '../domain/payment';
import { callGateway, majorToMinor, minorToMajor } from './http';

interface Envelope<T> {
  status: string;
  message?: string;
  data: T;
}

/**
 * Flutterwave v3, per developer.flutterwave.com (checked 11 Nov 2026): Standard checkout is
 * POST /payments with the amount in major units, returning data.link; verify is
 * GET /transactions/verify_by_reference?tx_ref=; webhooks carry the merchant's secret hash
 * in a verif-hash header (a plain comparison, not a signature over the body).
 */
export class FlutterwaveProvider implements PaymentProviderPort {
  readonly name = 'flutterwave';

  constructor(
    private readonly apiBaseUrl: string,
    private readonly secretKey: string,
    private readonly webhookHash: string,
  ) {}

  async initialize(request: InitializePaymentRequest): Promise<{ redirectUrl: string }> {
    const body = await this.call<Envelope<{ link?: string }>>('POST', '/payments', {
      tx_ref: request.reference,
      amount: minorToMajor(request.amount.minor),
      currency: request.amount.currency,
      redirect_url: request.callbackUrl,
      customer: { email: request.customerEmail },
    });
    const url = body.data?.link;
    if (!url || !/^https:\/\//.test(url)) throw new ProviderUnavailable('Flutterwave did not return a payment page');
    return { redirectUrl: url };
  }

  async verify(reference: string): Promise<ProviderVerification> {
    let body: Envelope<{ id?: number; status?: string; amount?: number | string; currency?: string; tx_ref?: string }>;
    try {
      body = await this.call('GET', `/transactions/verify_by_reference?tx_ref=${encodeURIComponent(reference)}`);
    } catch (error) {
      // No transaction yet means the customer has not paid: not an error, just pending.
      if (error instanceof ProviderUnavailable && /No transaction/i.test(error.message)) return { outcome: 'pending', amount: Money.zero('NGN'), providerTransactionId: '' };
      throw error;
    }
    const data = body.data ?? {};
    if (data.tx_ref && data.tx_ref !== reference) throw new ProviderUnavailable('Flutterwave returned a different transaction');
    const outcome = data.status === 'successful' ? 'succeeded' : data.status === 'failed' ? 'failed' : 'pending';
    if (data.amount === undefined || !data.currency) {
      if (outcome === 'pending') return { outcome, amount: Money.zero('NGN'), providerTransactionId: '' };
      throw new ProviderUnavailable('Flutterwave returned an incomplete transaction');
    }
    return { outcome, amount: Money.of(majorToMinor(data.amount), data.currency.toUpperCase()), providerTransactionId: String(data.id ?? '') };
  }

  parseWebhook(rawBody: Uint8Array, headers: Record<string, string>): WebhookNotice {
    const given = Buffer.from(headers['verif-hash'] ?? '');
    const expected = Buffer.from(this.webhookHash);
    if (!this.webhookHash || given.length !== expected.length || !timingSafeEqual(given, expected)) throw new InvalidWebhookSignature();
    const payload = JSON.parse(Buffer.from(rawBody).toString('utf8')) as { event?: string; data?: { id?: number; tx_ref?: string; status?: string } };
    return { eventId: `${payload.event ?? 'unknown'}:${payload.data?.id ?? 'none'}:${payload.data?.status ?? ''}`, reference: payload.data?.tx_ref ?? '' };
  }

  async refund(providerTransactionId: string, amount: Money): Promise<{ providerRefundId: string }> {
    const body = await this.call<Envelope<{ id?: number }>>('POST', `/transactions/${encodeURIComponent(providerTransactionId)}/refund`, {
      amount: Number(minorToMajor(amount.minor)),
    });
    return { providerRefundId: String(body.data?.id ?? '') };
  }

  async testConnection(): Promise<void> {
    await this.call('GET', '/balances');
  }

  private call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    return callGateway<T>('Flutterwave', `${this.apiBaseUrl}${path}`, { method, secret: this.secretKey, body });
  }
}
