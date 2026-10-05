import { createHmac, timingSafeEqual } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import type { AppEnv } from '@fa/config';
import {
  ProviderNotConfiguredError,
  type CreateIntentCommand,
  type PaymentProvider,
  type ProviderIntentResult,
  type ProviderStatusResult,
  type RefundCommand,
  type RefundResult,
  type WebhookVerification,
} from '@fa/domain';

import { APP_ENV } from '../../common/config/config.module';

/**
 * FAKE payment provider — dev/test ONLY.
 *
 * A deterministic conformance double for the PaymentProvider port: it keeps an
 * in-memory ledger of provider-side states and signs its webhooks with
 * HMAC-SHA256, so the orchestrator's verification + idempotency path is
 * exercised exactly like a real provider's.
 *
 * Never enabled in production (refused at construction AND by config
 * validation). Checkout URLs use the reserved `.invalid` TLD so they can
 * never be mistaken for a working payment page.
 *
 * Webhook contract (documented here AND in the e2e suite):
 * - body: JSON `{ eventId, providerRef, status, occurredAt }`
 * - headers: `x-fake-signature: sha256=<hex(HMAC(secret, timestamp + "." + rawBody))>`
 * -          `x-fake-timestamp: <unix seconds>` (replay window: ±300s)
 */
@Injectable()
export class FakePaymentProvider implements PaymentProvider {
  readonly code = 'fake';

  private readonly secret: string;
  private readonly states = new Map<string, string>();

  constructor(@Inject(APP_ENV) env: AppEnv) {
    if (env.NODE_ENV === 'production') {
      throw new ProviderNotConfiguredError(
        'The fake payment provider is unavailable in production',
      );
    }
    if (!env.PAYMENTS_WEBHOOK_SECRET) {
      throw new ProviderNotConfiguredError(
        'PAYMENTS_WEBHOOK_SECRET is required when PAYMENTS_FAKE_PROVIDER=true',
      );
    }
    this.secret = env.PAYMENTS_WEBHOOK_SECRET;
  }

  /** Signs a webhook payload — also used by the e2e suite to emit fake events. */
  signWebhook(rawBody: string, timestamp: number): string {
    return `sha256=${createHmac('sha256', this.secret).update(`${timestamp}.${rawBody}`, 'utf8').digest('hex')}`;
  }

  async createPaymentIntent(cmd: CreateIntentCommand): Promise<ProviderIntentResult> {
    const providerRef = `fake_${cmd.reference}`;
    this.states.set(providerRef, 'PENDING');
    return {
      providerRef,
      status: 'PENDING',
      checkoutUrl: `https://checkout.fake-provider.invalid/pay/${providerRef}`,
    };
  }

  async getPaymentStatus(providerRef: string): Promise<ProviderStatusResult> {
    const raw = this.states.get(providerRef);
    if (!raw) {
      throw new ProviderNotConfiguredError(`Unknown fake provider reference "${providerRef}"`);
    }
    return { providerRef, status: raw as ProviderStatusResult['status'], observedAt: new Date() };
  }

  async refund(cmd: RefundCommand): Promise<RefundResult> {
    if (!this.states.has(cmd.providerRef)) {
      throw new ProviderNotConfiguredError(`Unknown fake provider reference "${cmd.providerRef}"`);
    }
    return { providerRefundId: `fake_refund_${cmd.providerRef}`, providerStatus: 'CAPTURED' };
  }

  async verifyWebhook(
    rawBody: Buffer,
    headers: Record<string, string>,
  ): Promise<WebhookVerification> {
    const signature = headers['x-fake-signature'];
    const timestampRaw = headers['x-fake-timestamp'];
    if (!signature || !timestampRaw) {
      return { valid: false, invalidReason: 'MISSING_SIGNATURE_HEADERS' };
    }
    const timestamp = Number(timestampRaw);
    if (!Number.isFinite(timestamp)) {
      return { valid: false, invalidReason: 'MALFORMED_TIMESTAMP' };
    }
    const skew = Math.abs(Date.now() / 1000 - timestamp);
    if (skew > 300) {
      return { valid: false, invalidReason: 'TIMESTAMP_OUTSIDE_REPLAY_WINDOW' };
    }
    const expected = this.signWebhook(rawBody.toString('utf8'), timestamp);
    if (!safeEqual(signature, expected)) {
      return { valid: false, invalidReason: 'SIGNATURE_MISMATCH' };
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      return { valid: false, invalidReason: 'MALFORMED_PAYLOAD' };
    }
    const body = parsed as Record<string, unknown>;
    const eventId = body['eventId'];
    const providerRef = body['providerRef'];
    const status = body['status'];
    if (
      typeof eventId !== 'string' ||
      typeof providerRef !== 'string' ||
      typeof status !== 'string'
    ) {
      return { valid: false, invalidReason: 'MALFORMED_PAYLOAD' };
    }
    // Record the provider-side state so getPaymentStatus reflects it —
    // the provider has now "processed" the event.
    this.states.set(providerRef, status);
    return {
      valid: true,
      eventId,
      providerRef,
      status: status as WebhookVerification['status'],
      occurredAt:
        typeof body['occurredAt'] === 'string' ? new Date(body['occurredAt']) : new Date(),
    };
  }
}

function safeEqual(a: string, b: string): boolean {
  const aBuf = Buffer.from(a, 'utf8');
  const bBuf = Buffer.from(b, 'utf8');
  if (aBuf.length !== bBuf.length) {
    return false;
  }
  return timingSafeEqual(aBuf, bBuf);
}
