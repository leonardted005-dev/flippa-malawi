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
 * DPO Pay adapter — documented INTEGRATION SEAM (audit rule #18).
 *
 * This class owns the DPO boundary: when the official DPO merchant
 * integration specification arrives, its field names, endpoint URLs, and
 * signature scheme live ONLY here. Until then every operation throws
 * `ProviderNotConfiguredError` with a precise pointer at what is missing.
 *
 * Nothing is fabricated: no endpoint URLs, no header names, no request/
 * response shapes, no webhook signature algorithm, and NO multi-merchant
 * split-settlement payload shape. See `DPO_SPEC_REQUIRED` + PAYMENT_ARCHITECTURE.md §3.
 */
export const DPO_SPEC_REQUIRED = [
  'DPO merchant API base URL + sandbox base URL',
  'Authentication mechanism (API key header name / signature scheme / OAuth)',
  'Intent creation: HTTP method, endpoint, and request/response field names',
  'Client reference field (how our intent id is echoed back)',
  'Webhook format: event naming, payload shape, and delivery retries',
  'Webhook verification: signature header name + algorithm + timestamp handling',
  'Server-to-server status lookup: endpoint + field names',
  'Capture/void/refund endpoints + field names',
  'Multi-merchant split-settlement payload shape (platform fee + seller proceeds)',
  'Supported currency/country/payment-method matrix',
] as const;

/** Injection token for the DPO adapter (registered alongside the registry). */
export const DPO_PAYMENT_PROVIDER = Symbol('DPO_PAYMENT_PROVIDER');

const TODO_SPEC = `DPO merchant integration specification is required (${DPO_SPEC_REQUIRED.length} open items — see DPO_SPEC_REQUIRED). DPO API fields must not be invented.`;

@Injectable()
export class DpoPaymentProvider implements PaymentProvider {
  readonly code = 'dpo';

  constructor(@Inject(APP_ENV) private readonly env: AppEnv) {
    void this.env;
  }

  /** Describes the integration boundary without inventing any of it. */
  static boundary(): { code: 'dpo'; status: 'spec-pending'; required: readonly string[] } {
    return { code: 'dpo', status: 'spec-pending', required: DPO_SPEC_REQUIRED };
  }

  async createPaymentIntent(_cmd: CreateIntentCommand): Promise<ProviderIntentResult> {
    throw new ProviderNotConfiguredError(`createPaymentIntent: ${TODO_SPEC}`);
  }

  async getPaymentStatus(_providerRef: string): Promise<ProviderStatusResult> {
    throw new ProviderNotConfiguredError(`getPaymentStatus: ${TODO_SPEC}`);
  }

  async refund(_cmd: RefundCommand): Promise<RefundResult> {
    throw new ProviderNotConfiguredError(`refund: ${TODO_SPEC}`);
  }

  async verifyWebhook(
    _rawBody: Buffer,
    _headers: Record<string, string>,
  ): Promise<WebhookVerification> {
    throw new ProviderNotConfiguredError(`verifyWebhook: ${TODO_SPEC}`);
  }
}
