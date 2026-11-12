import { createHmac, timingSafeEqual } from 'node:crypto';
import { Money } from '../../../shared-kernel';
import { InitializePaymentRequest, InvalidWebhookSignature, PaymentProviderPort, ProviderUnavailable, WebhookNotice } from '../application/ports';
import { ProviderVerification } from '../domain/payment';
import { callGateway } from './http';

interface Envelope<T> {
  status: boolean;
  message?: string;
  data: T;
}

/**
 * Paystack, per its published OpenAPI description (PaystackOSS/openapi, checked 11 Nov 2026):
 * amounts are integers in kobo; verify is GET /transaction/verify/{reference}.
 * Webhooks carry x-paystack-signature, an HMAC-SHA512 of the raw body keyed with the secret key.
 */
export class PaystackProvider implements PaymentProviderPort {
  readonly name = 'paystack';

  constructor(
    private readonly apiBaseUrl: string,
    private readonly secretKey: string,
  ) {}

  async initialize(request: InitializePaymentRequest): Promise<{ redirectUrl: string }> {
    const body = await this.call<Envelope<{ authorization_url?: string }>>('POST', '/transaction/initialize', {
      email: request.customerEmail,
      amount: Number(request.amount.minor),
      currency: request.amount.currency,
      reference: request.reference,
      callback_url: request.callbackUrl,
    });
    const url = body.data?.authorization_url;
    if (!url || !/^https:\/\//.test(url)) throw new ProviderUnavailable('Paystack did not return a payment page');
    return { redirectUrl: url };
  }

  async verify(reference: string): Promise<ProviderVerification> {
    const body = await this.call<Envelope<{ id?: number; status?: string; amount?: number; currency?: string; reference?: string }>>(
      'GET',
      `/transaction/verify/${encodeURIComponent(reference)}`,
    );
    const data = body.data ?? {};
    if (data.reference && data.reference !== reference) throw new ProviderUnavailable('Paystack returned a different transaction');
    // success is final; failed and reversed are final failures; everything else (abandoned, ongoing, pending...) may still complete.
    const outcome = data.status === 'success' ? 'succeeded' : data.status === 'failed' || data.status === 'reversed' ? 'failed' : 'pending';
    if (typeof data.amount !== 'number' || !Number.isSafeInteger(data.amount) || !data.currency) {
      if (outcome === 'pending') return { outcome, amount: Money.zero('NGN'), providerTransactionId: '' };
      throw new ProviderUnavailable('Paystack returned an incomplete transaction');
    }
    return { outcome, amount: Money.of(BigInt(data.amount), data.currency.toUpperCase()), providerTransactionId: String(data.id ?? '') };
  }

  parseWebhook(rawBody: Uint8Array, headers: Record<string, string>): WebhookNotice {
    const given = headers['x-paystack-signature'] ?? '';
    const expected = createHmac('sha512', this.secretKey).update(rawBody).digest('hex');
    if (given.length !== expected.length || !timingSafeEqual(Buffer.from(given), Buffer.from(expected))) throw new InvalidWebhookSignature();
    const payload = JSON.parse(Buffer.from(rawBody).toString('utf8')) as { event?: string; data?: { id?: number; reference?: string } };
    return { eventId: `${payload.event ?? 'unknown'}:${payload.data?.id ?? payload.data?.reference ?? 'none'}`, reference: payload.data?.reference ?? '' };
  }

  async refund(providerTransactionId: string, amount: Money): Promise<{ providerRefundId: string }> {
    const body = await this.call<Envelope<{ id?: number }>>('POST', '/refund', { transaction: providerTransactionId, amount: Number(amount.minor), currency: amount.currency });
    return { providerRefundId: String(body.data?.id ?? '') };
  }

  async testConnection(): Promise<void> {
    await this.call('GET', '/balance');
  }

  private call<T>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
    return callGateway<T>('Paystack', `${this.apiBaseUrl}${path}`, { method, secret: this.secretKey, body });
  }
}
