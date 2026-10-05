import type { PaymentStatus } from './payment-machine';

/**
 * PaymentProvider PORT (PAYMENT_ARCHITECTURE §1/§3).
 *
 * The marketplace owns this interface; adapters (DPO, future providers) live
 * behind it in infrastructure. NO provider-specific field name, header, URL,
 * or signature scheme ever appears here or anywhere in domain code (rule #18).
 *
 * `verifyWebhook` is the ONLY path that confirms payment — a browser redirect
 * is never treated as confirmation (rule #11). Every webhook is verified and
 * carries a provider-unique event id for idempotent processing (rule #12).
 */

/** Thrown by an adapter when the provider/spec/credentials are unavailable. */
export class ProviderNotConfiguredError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderNotConfiguredError';
  }
}

export class WebhookSignatureError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'WebhookSignatureError';
  }
}

export interface CreateIntentCommand {
  /** OUR payment intent id — sent back as the provider's client reference. */
  reference: string;
  amountMinor: bigint;
  /** ISO-4217, uppercase. Validated against the listing before this call. */
  currency: string;
  description: string;
  /** Where the provider may send the browser AFTER checkout (UI only). */
  returnUrl: string;
  metadata?: Record<string, string>;
}

/** The provider's handoff descriptor (PaymentSession) — opaque to the domain. */
export interface ProviderIntentResult {
  providerRef: string;
  status: PaymentStatus;
  /** Hosted checkout URL (or null when the provider uses an SDK/token flow). */
  checkoutUrl: string | null;
}

export interface ProviderStatusResult {
  providerRef: string;
  status: PaymentStatus;
  /** Server-to-server timestamp when the provider last observed this state. */
  observedAt: Date;
}

export interface RefundCommand {
  providerRef: string;
  amountMinor: bigint;
  reason?: string;
}

export interface RefundResult {
  providerRefundId: string | null;
  /** The provider's own view of the payment status after the refund call. */
  providerStatus: PaymentStatus;
}

/** Normalized webhook verification — adapters map their raw payload to this. */
export interface WebhookVerification {
  valid: boolean;
  /** Populated when valid === false (never logged with secrets). */
  invalidReason?: string;
  /** Provider-unique event id (idempotency key: UQ(provider, event_id)). */
  eventId?: string;
  /** Provider reference of the payment this event is about. */
  providerRef?: string;
  /** Canonical status the event reports (adapter-normalized). */
  status?: PaymentStatus;
  occurredAt?: Date;
}

export interface PaymentProvider {
  readonly code: string;

  createPaymentIntent(cmd: CreateIntentCommand): Promise<ProviderIntentResult>;
  /** Server-to-server truth check (reconciliation + redirect recovery). */
  getPaymentStatus(providerRef: string): Promise<ProviderStatusResult>;
  authorize?(providerRef: string, amountMinor: bigint): Promise<ProviderIntentResult>;
  capture?(providerRef: string, amountMinor: bigint): Promise<ProviderIntentResult>;
  void?(providerRef: string): Promise<ProviderIntentResult>;
  refund(cmd: RefundCommand): Promise<RefundResult>;
  /** Verifies signature/timestamp over the RAW body, then normalizes the event. */
  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): Promise<WebhookVerification>;
}
