import { Money } from '../../../shared-kernel';
import { Payment, ProviderVerification } from '../domain/payment';
import { GatewayRefundResult } from '../domain/refund';

export interface InitializePaymentRequest {
  readonly reference: string;
  readonly amount: Money;
  readonly customerEmail: string;
  readonly callbackUrl: string;
}

export interface RefundRequest {
  /** The gateway's id for the original transaction. */
  readonly transactionId: string;
  /** Our reference for the original transaction. */
  readonly reference: string;
  readonly amount: Money;
  /** True when this returns everything that was paid. */
  readonly full: boolean;
  /** Why, for the gateway's records. */
  readonly note: string;
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
  /**
   * Asks the gateway to return money. Throws `ProviderRejected` when the gateway clearly
   * refused, and `ProviderUnavailable` when it is unclear whether the request arrived.
   */
  refund(request: RefundRequest): Promise<GatewayRefundResult>;
  /** The gateway's current word on a refund. */
  refundStatus(providerRefundId: string): Promise<GatewayRefundResult>;
  /** Makes a harmless authenticated call, so staff can check the credentials work. */
  testConnection(): Promise<void>;
}

/** The gateway could not be reached, timed out, or rejected the request. Safe to show to staff. */
export class ProviderUnavailable extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUnavailable';
  }
}

/** The gateway answered and refused the request, so nothing happened there. */
export class ProviderRejected extends ProviderUnavailable {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderRejected';
  }
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
