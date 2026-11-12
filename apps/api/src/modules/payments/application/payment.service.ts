import { ApplicationError, Money, Principal } from '../../../shared-kernel';
import { SettingsReader } from '../../settings';
import { Payment, PaymentStatus } from '../domain/payment';
import { GatewayService, GatewayState } from './gateways';
import { Clock, InvalidWebhookSignature, PaymentProviderPort, PaymentRepository, ProviderUnavailable, WebhookInbox } from './ports';
import { ProcessPaymentWebhook, WebhookOutcome } from './process-webhook';

/** What payments needs from checkout, provided by the checkout module's contract. */
export interface CheckoutGateway {
  payable(customerId: string, checkoutId: string): Promise<{ id: string; total: Money }>;
  ownerOf(checkoutId: string): Promise<string | null>;
}

export interface CustomerDirectory {
  emailOf(accountId: string): Promise<string | null>;
}

export interface PaymentQueries {
  findOpenForCheckout(checkoutId: string, gatewayId: string): Promise<Payment | null>;
  recent(limit: number, status?: string): Promise<PaymentSummary[]>;
}

export interface PaymentSummary {
  readonly id: string;
  readonly reference: string;
  readonly checkoutId: string;
  readonly provider: string;
  readonly gatewayId: string | null;
  readonly amountMinor: bigint;
  readonly currency: string;
  readonly status: string;
  readonly createdAt: Date;
}

export interface StartedPayment {
  readonly reference: string;
  readonly redirectUrl: string;
}

export interface PaymentOption {
  readonly id: string;
  readonly name: string;
  readonly type: string;
}

const unavailable = (error: unknown) =>
  new ApplicationError('unavailable', 'payment.gateway_unavailable', error instanceof ProviderUnavailable ? error.message : 'The payment gateway could not be reached');

/** A unique reference safe for every supported gateway: letters and digits only. */
function newReference(uuid: string): string {
  return `VND${uuid.replace(/-/g, '').toUpperCase().slice(0, 20)}`;
}

export class PaymentService {
  constructor(
    private readonly payments: PaymentRepository & PaymentQueries,
    private readonly gateways: GatewayService,
    private readonly checkout: CheckoutGateway,
    private readonly customers: CustomerDirectory,
    private readonly inbox: WebhookInbox,
    private readonly settings: SettingsReader,
    private readonly ids: { uuid(): string },
    private readonly clock: Clock,
    /** Delivers committed events at once, so the order is confirmed before the customer's page loads. */
    private readonly deliverEvents: () => Promise<void>,
  ) {}

  /** For staff: the latest payments, newest first. */
  recent(status?: string): Promise<PaymentSummary[]> {
    return this.payments.recent(100, status);
  }

  /** Enabled gateways, in the order staff chose. */
  async options(): Promise<PaymentOption[]> {
    return (await this.gateways.list())
      .filter((gateway) => gateway.enabled)
      .sort((a, b) => a.position - b.position || a.name.localeCompare(b.name))
      .map((gateway) => ({ id: gateway.id, name: gateway.name, type: gateway.type }));
  }

  /**
   * Sends the customer to the chosen gateway for an open checkout. Choosing the same gateway
   * again reuses the payment already started, so a double click never charges twice.
   */
  async start(principal: Principal, checkoutId: string, gatewayId: string): Promise<StartedPayment> {
    const checkout = await this.checkout.payable(principal.accountId, checkoutId);
    const gateway = await this.enabledGateway(gatewayId);

    const existing = await this.payments.findOpenForCheckout(checkout.id, gateway.id);
    if (existing && existing.snapshot.amount.equals(checkout.total) && existing.snapshot.redirectUrl) {
      return { reference: existing.snapshot.reference, redirectUrl: existing.snapshot.redirectUrl };
    }

    const email = await this.customers.emailOf(principal.accountId);
    if (!email) throw new ApplicationError('not_found', 'payment.customer_not_found', 'Your account could not be found');
    const { provider } = await this.providerOrUnavailable(gateway.id);

    const payment = Payment.initiate({
      id: this.ids.uuid(),
      checkoutId: checkout.id,
      reference: newReference(this.ids.uuid()),
      provider: gateway.type,
      gatewayId: gateway.id,
      amount: checkout.total,
    });
    await this.payments.save(payment);

    const storefront = await this.settings.get('payments.storefrontUrl');
    const callbackUrl = `${storefront}/checkout/${checkout.id}/return?ref=${payment.snapshot.reference}`;
    let redirectUrl: string;
    try {
      ({ redirectUrl } = await provider.initialize({ reference: payment.snapshot.reference, amount: checkout.total, customerEmail: email, callbackUrl }));
    } catch (error) {
      throw unavailable(error);
    }
    payment.attachRedirect(redirectUrl);
    await this.payments.save(payment);
    return { reference: payment.snapshot.reference, redirectUrl };
  }

  /**
   * Asks the gateway directly whether a payment succeeded. Called when the customer comes back;
   * the webhook does the same independently. The answer from the gateway is the only evidence.
   */
  async verify(principal: Principal, reference: string): Promise<{ status: PaymentStatus; checkoutId: string }> {
    const payment = await this.payments.findByReference(reference);
    if (!payment || (await this.checkout.ownerOf(payment.snapshot.checkoutId)) !== principal.accountId) {
      throw new ApplicationError('not_found', 'payment.not_found', 'Payment not found');
    }
    if (payment.snapshot.status === 'initiated' && payment.snapshot.gatewayId) {
      const { provider } = await this.providerOrUnavailable(payment.snapshot.gatewayId);
      let result;
      try {
        result = await provider.verify(reference);
      } catch (error) {
        throw unavailable(error);
      }
      payment.applyVerification(result, this.clock.now());
      await this.payments.save(payment);
      await this.deliverEvents();
    }
    return { status: payment.snapshot.status, checkoutId: payment.snapshot.checkoutId };
  }

  /** A gateway's webhook. Its signature is checked with that gateway's own credentials. */
  async webhook(gatewayId: string, rawBody: Uint8Array, headers: Record<string, string>): Promise<WebhookOutcome> {
    let provider: PaymentProviderPort;
    try {
      ({ provider } = await this.gateways.provider(gatewayId));
    } catch (error) {
      if (error instanceof ApplicationError) throw error;
      // A gateway without credentials cannot have sent a genuine webhook.
      throw new InvalidWebhookSignature();
    }
    const scoped: PaymentRepository = {
      // A webhook from one gateway can only touch payments made through that gateway.
      findByReference: async (reference) => {
        const payment = await this.payments.findByReference(reference);
        return payment && payment.snapshot.gatewayId === gatewayId ? payment : null;
      },
      save: (payment) => this.payments.save(payment),
    };
    // Webhook events are de-duplicated per configured gateway, so two accounts of one type never collide.
    const named: PaymentProviderPort = {
      name: `gateway:${gatewayId}`,
      initialize: (request) => provider.initialize(request),
      verify: (reference) => provider.verify(reference),
      parseWebhook: (body, values) => provider.parseWebhook(body, values),
      refund: (id, amount) => provider.refund(id, amount),
      testConnection: () => provider.testConnection(),
    };
    const outcome = await new ProcessPaymentWebhook(named, scoped, this.inbox, this.clock).execute(rawBody, headers);
    if (outcome === 'processed') await this.deliverEvents();
    return outcome;
  }

  private async enabledGateway(id: string): Promise<GatewayState> {
    const gateway = (await this.gateways.list()).find((entry) => entry.id === id && entry.enabled);
    if (!gateway) throw new ApplicationError('not_found', 'payment.gateway_not_available', 'This payment method is not available. Choose another.');
    return gateway;
  }

  private async providerOrUnavailable(gatewayId: string) {
    try {
      return await this.gateways.provider(gatewayId);
    } catch (error) {
      if (error instanceof ProviderUnavailable) throw unavailable(error);
      throw error;
    }
  }
}
