import { Money } from '../../../shared-kernel';
import { Payment, ProviderVerification } from '../domain/payment';

export interface InitializePaymentRequest {
  readonly reference: string;
  readonly amount: Money;
  readonly customerEmail: string;
  readonly callbackUrl: string;
}

/** A signature-checked webhook. It says which payment to re-verify, and nothing more. */
export interface WebhookNotice {
  readonly eventId: string;
  readonly reference: string;
}

export interface PaymentProviderPort {
  readonly name: string;
  initialize(request: InitializePaymentRequest): Promise<{ redirectUrl: string }>;
  verify(reference: string): Promise<ProviderVerification>;
  /** Must throw `InvalidWebhookSignature` when the signature does not match. */
  parseWebhook(rawBody: Uint8Array, headers: Record<string, string>): WebhookNotice;
  refund(providerTransactionId: string, amount: Money): Promise<{ providerRefundId: string }>;
}

export interface PaymentRepository {
  findByReference(reference: string): Promise<Payment | null>;
  /** Commits state and pulled events atomically. Must reject a stale `version`. */
  save(payment: Payment): Promise<void>;
}

export interface WebhookInbox {
  /** Returns false only when this event has already been fully processed. */
  begin(provider: string, eventId: string): Promise<boolean>;
  complete(provider: string, eventId: string): Promise<void>;
}

export interface Clock {
  now(): Date;
}

export class InvalidWebhookSignature extends Error {
  constructor() {
    super('Invalid webhook signature');
    this.name = 'InvalidWebhookSignature';
  }
}
