import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AppEnv } from '@fa/config';
import {
  assertPaymentTransition,
  deriveRefundStatus,
  isRefundablePaymentStatus,
  ProviderNotConfiguredError,
  type PaymentProvider,
  type PaymentStatus,
  type WebhookVerification,
} from '@fa/domain';

import { APP_ENV } from '../../common/config/config.module';
import { AuditService } from '../../common/audit/audit.service';
import type { RequestMeta } from '../../common/http/request-meta';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { PAYMENT_PROVIDERS } from '../../common/tokens';
import { ListingRepository } from '../listings/listings.repository';
import { SellerRepository } from '../sellers/sellers.repository';
import { PaymentsRepository } from './payments.repository';

/**
 * Payment Orchestrator (Phase 9) — marketplace owns every decision.
 *
 * - Amounts/currency always come from server-side listing state (rule #9).
 * - Only verified webhooks (or a server-to-server status fetch) move an
 *   intent forward; browser redirects never do (rule #11).
 * - Webhook ingestion is idempotent via UQ(provider, event_id) (rule #12).
 * - Money uses integer minor units; refunds are computed from immutable
 *   `refundedMinor` accounting (compensating ledger entries in Phase 11).
 * - Auction checkout closes through ORDERS (Phase 10); this phase covers
 *   fixed-price purchase only.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly payments: PaymentsRepository,
    private readonly listings: ListingRepository,
    private readonly sellers: SellerRepository,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
    @Inject(PAYMENT_PROVIDERS) private readonly providers: PaymentProvider[],
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  private provider(code: string): PaymentProvider {
    const adapter = this.providers.find((candidate) => candidate.code === code);
    if (!adapter) {
      throw new NotFoundException({
        code: 'PAYMENT_PROVIDER_UNKNOWN',
        message: `Unknown provider "${code}"`,
      });
    }
    return adapter;
  }

  /** Active provider for new intents (fails loudly when unconfigured). */
  private activeProvider(): PaymentProvider {
    const code = this.env.PAYMENTS_FAKE_PROVIDER ? 'fake' : this.env.PAYMENTS_DEFAULT_PROVIDER;
    return this.provider(code);
  }

  // ------------------------------------------------------------ intents

  async createIntent(
    userId: string,
    listingId: string,
    idempotencyKey: string | undefined,
    meta: RequestMeta,
  ) {
    const result = await this.idempotency.run(
      `payments:intent:${userId}`,
      idempotencyKey,
      IdempotencyService.hashRequest({ listingId }),
      async () => {
        const listing = await this.listings.findById(listingId);
        // IDOR-safe: foreign/draft listings are 404.
        if (!listing || listing.status !== 'ACTIVE') {
          throw new NotFoundException({
            code: 'LISTING_NOT_AVAILABLE',
            message: 'This listing cannot be purchased right now',
          });
        }
        if (listing.mode !== 'FIXED_PRICE') {
          throw new ConflictException({
            code: 'AUCTION_CHECKOUT_NOT_ENABLED',
            message: 'Auction checkout closes through orders (Phase 10)',
          });
        }
        if (listing.priceMinor === null || listing.currency === null) {
          throw new ConflictException({
            code: 'LISTING_NOT_PRICED',
            message: 'This listing has no server-side price',
          });
        }
        const own = await this.sellers.findByUserId(userId);
        if (own && listing.sellerId === own.id) {
          throw new ConflictException({
            code: 'SELF_PURCHASE_FORBIDDEN',
            message: 'Sellers cannot purchase their own listings',
          });
        }

        const adapter = this.activeProvider();
        const intent = await this.payments.createIntent({
          provider: adapter.code,
          buyerId: userId,
          listingId: listing.id,
          amountMinor: listing.priceMinor,
          currency: listing.currency,
          expiresAt: new Date(Date.now() + 30 * 60_000),
        });

        let providerResult;
        try {
          providerResult = await adapter.createPaymentIntent({
            reference: intent.id,
            amountMinor: listing.priceMinor,
            currency: listing.currency,
            description: `Marketplace purchase ${listing.id}`,
            returnUrl: `${this.env.WEB_BASE_URL}/payments/return`,
            metadata: { listingId: listing.id },
          });
        } catch (error) {
          if (error instanceof ProviderNotConfiguredError) {
            await this.payments.setStatus(intent.id, 'FAILED');
            throw new ConflictException({
              code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
              message: error instanceof Error ? error.message : 'Payment provider not configured',
            });
          }
          throw error;
        }

        const confirmed = await this.payments.client.paymentIntent.update({
          where: { id: intent.id },
          data: {
            providerRef: providerResult.providerRef,
            checkoutUrl: providerResult.checkoutUrl,
            status: 'PENDING',
            version: { increment: 1 },
          },
        });

        await this.audit.record({
          actorId: userId,
          actorType: 'USER',
          action: 'PAYMENT_INTENT_CREATED',
          entityType: 'PaymentIntent',
          entityId: intent.id,
          // Amount + currency only — no provider refs or session URLs in logs.
          after: {
            listingId: listing.id,
            amountMinor: listing.priceMinor.toString(),
            currency: listing.currency,
          },
          ...meta,
        });

        return { statusCode: 201, body: toIntentView(confirmed) };
      },
    );
    return result.body;
  }

  async getIntent(userId: string, id: string, isAdmin: boolean) {
    const intent = await this.payments.findIntentById(id);
    if (!intent || (!isAdmin && intent.buyerId !== userId)) {
      throw new NotFoundException({
        code: 'PAYMENT_INTENT_NOT_FOUND',
        message: 'Payment not found',
      });
    }
    return toIntentView(intent);
  }

  async listMine(userId: string) {
    return (await this.payments.listByBuyer(userId)).map(toIntentView);
  }

  async listRecent(adminId: string, limit: number, cursor?: string) {
    void adminId;
    const rows = await this.payments.listRecent(limit, cursor);
    const hasMore = rows.length > limit;
    // Ops view strips checkoutUrl: hosted checkout links are bearer-capability
    // URLs — monitoring surfaces must never leak them.
    const items = (hasMore ? rows.slice(0, limit) : rows).map((row) => {
      const view = toIntentView(row);
      delete view['checkoutUrl'];
      return view;
    });
    const last = items[items.length - 1];
    return { items, nextCursor: hasMore && last ? (last['id'] as string) : null };
  }

  /**
   * Redirect recovery: re-reads truth SERVER-SIDE from the provider. The
   * redirect's own query params are never trusted (rule #11).
   */
  async syncIntent(userId: string, id: string, meta: RequestMeta) {
    const intent = await this.payments.findIntentById(id);
    if (!intent || intent.buyerId !== userId) {
      throw new NotFoundException({
        code: 'PAYMENT_INTENT_NOT_FOUND',
        message: 'Payment not found',
      });
    }
    if (!intent.providerRef) {
      throw new ConflictException({
        code: 'PAYMENT_NOT_SUBMITTED',
        message: 'This payment has not reached a provider yet',
      });
    }
    const truth = await this.provider(intent.provider).getPaymentStatus(intent.providerRef);
    return this.applyStatus(intent.id, truth.status, 'PAYMENT_SYNCED', userId, 'USER', meta);
  }

  /**
   * Ingests one verified webhook. Replays return `{ duplicate: true }`.
   * Unknown provider refs are recorded as IGNORED and answered 200 so the
   * provider stops retrying a payment we will never own.
   */
  async applyProviderEvent(
    providerCode: string,
    verification: WebhookVerification,
    meta: RequestMeta,
  ): Promise<{ received: boolean; duplicate: boolean }> {
    if (!verification.eventId || !verification.providerRef || !verification.status) {
      throw new BadRequestException({
        code: 'WEBHOOK_UNRECOGNIZED',
        message: 'Verified event is missing its identity/status',
      });
    }
    const payload: Record<string, unknown> = {
      eventId: verification.eventId,
      providerRef: verification.providerRef,
      status: verification.status,
      ...(verification.occurredAt ? { occurredAt: verification.occurredAt.toISOString() } : {}),
    };

    let eventId: string;
    try {
      const created = await this.payments.recordEvent({
        provider: providerCode,
        providerEventId: verification.eventId,
        intentId: null,
        payload,
        status: 'RECEIVED',
      });
      eventId = created.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        // Replay: acknowledge without touching the intent (rule #12).
        await this.audit.record({
          actorType: 'SYSTEM',
          action: 'PAYMENT_WEBHOOK_DUPLICATE',
          entityType: 'PaymentEvent',
          after: { provider: providerCode, eventId: verification.eventId },
          ...meta,
        });
        return { received: true, duplicate: true };
      }
      throw error;
    }

    const intent = await this.payments.findIntentByProviderRef(
      providerCode,
      verification.providerRef,
    );
    if (!intent) {
      await this.payments.markEvent(eventId, 'IGNORED');
      await this.audit.record({
        actorType: 'SYSTEM',
        action: 'PAYMENT_WEBHOOK_UNMATCHED',
        entityType: 'PaymentEvent',
        entityId: eventId,
        after: { provider: providerCode, providerRef: redactRef(verification.providerRef) },
        ...meta,
      });
      return { received: true, duplicate: false };
    }

    await this.payments.client.paymentEvent.update({
      where: { id: eventId },
      data: { intentId: intent.id },
    });
    await this.applyStatus(
      intent.id,
      verification.status,
      'PAYMENT_WEBHOOK_APPLIED',
      null,
      'SYSTEM',
      meta,
      {
        eventId: verification.eventId,
        provider: providerCode,
      },
    );
    await this.payments.markEvent(eventId, 'PROCESSED');
    return { received: true, duplicate: false };
  }

  /** One status move under the intent row lock; stale/out-of-order events only acknowledge. */
  private async applyStatus(
    intentId: string,
    to: PaymentStatus,
    action: string,
    actorId: string | null,
    actorType: 'USER' | 'ADMIN' | 'SYSTEM',
    meta: RequestMeta,
    after?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    const updated = await this.payments.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM payment_intents WHERE id = ${intentId}::uuid FOR UPDATE`;
      const fresh = await tx.paymentIntent.findUnique({ where: { id: intentId } });
      if (!fresh) {
        throw new NotFoundException({
          code: 'PAYMENT_INTENT_NOT_FOUND',
          message: 'Payment not found',
        });
      }
      try {
        assertPaymentTransition(fresh.status, to);
      } catch {
        // Stale or out-of-order delivery past a terminal state: keep the
        // authoritative state and acknowledge the provider anyway.
        return fresh;
      }
      return tx.paymentIntent.update({
        where: { id: intentId },
        data: { status: to, version: { increment: 1 } },
      });
    });

    await this.audit.record({
      actorId,
      actorType,
      action,
      entityType: 'PaymentIntent',
      entityId: intentId,
      after: { status: updated.status, ...(after ?? {}) },
      ...meta,
    });
    return toIntentView(updated);
  }

  /**
   * Admin-initiated refund (orchestrator-owned; ledger entries in Phase 11).
   * The provider call moves the money; the STATUS comes from OUR
   * `refundedMinor` accounting (never client input).
   */
  async refund(
    adminId: string,
    intentId: string,
    amountMinor: number | undefined,
    meta: RequestMeta,
  ) {
    const refunded = await this.payments.client.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT id FROM payment_intents WHERE id = ${intentId}::uuid FOR UPDATE`;
      const fresh = await tx.paymentIntent.findUnique({ where: { id: intentId } });
      if (!fresh || !fresh.providerRef) {
        throw new NotFoundException({
          code: 'PAYMENT_INTENT_NOT_FOUND',
          message: 'Payment not found',
        });
      }
      if (!isRefundablePaymentStatus(fresh.status)) {
        throw new ConflictException({
          code: 'PAYMENT_NOT_REFUNDABLE',
          message: `Payments in ${fresh.status} cannot be refunded`,
        });
      }
      const remaining = fresh.amountMinor - fresh.refundedMinor;
      const requested = amountMinor === undefined ? remaining : BigInt(amountMinor);
      if (requested <= 0n || requested > remaining) {
        throw new BadRequestException({
          code: 'REFUND_AMOUNT_INVALID',
          message: `Refundable balance is ${remaining.toString()} minor units`,
        });
      }
      // Provider call happens INSIDE the lock so two concurrent refunds cannot
      // spend the same balance twice.
      const receipt = await this.provider(fresh.provider).refund({
        providerRef: fresh.providerRef,
        amountMinor: requested,
        reason: 'admin-refund',
      });
      const nextRefunded = fresh.refundedMinor + requested;
      const target = deriveRefundStatus(nextRefunded, fresh.amountMinor);
      assertPaymentTransition(fresh.status, target);
      const updated = await tx.paymentIntent.update({
        where: { id: intentId },
        data: { refundedMinor: nextRefunded, status: target, version: { increment: 1 } },
      });
      return { updated, requested, providerRefundId: receipt.providerRefundId };
    });

    await this.audit.record({
      actorId: adminId,
      actorType: 'ADMIN',
      action: 'PAYMENT_REFUNDED',
      entityType: 'PaymentIntent',
      entityId: intentId,
      // Receipt id only — never secrets or account data.
      after: {
        refundedMinor: refunded.requested.toString(),
        status: refunded.updated.status,
        providerRefundId: refunded.providerRefundId,
      },
      ...meta,
    });
    return toIntentView(refunded.updated);
  }

  /** Verifies + normalizes an inbound webhook; throws 401 on any failure. */
  async verifyInboundWebhook(
    providerCode: string,
    rawBody: Buffer | undefined,
    headers: Record<string, string>,
  ): Promise<WebhookVerification> {
    if (!rawBody || rawBody.length === 0) {
      throw new BadRequestException({
        code: 'WEBHOOK_BODY_MISSING',
        message: 'Webhook body is required for signature verification',
      });
    }
    let adapter: PaymentProvider;
    try {
      adapter = this.provider(providerCode);
    } catch {
      throw new NotFoundException({
        code: 'PAYMENT_PROVIDER_UNKNOWN',
        message: `Unknown provider "${providerCode}"`,
      });
    }
    let verification: WebhookVerification;
    try {
      verification = await adapter.verifyWebhook(rawBody, headers);
    } catch (error) {
      if (error instanceof ProviderNotConfiguredError) {
        throw new ConflictException({
          code: 'PAYMENT_PROVIDER_NOT_CONFIGURED',
          message: error instanceof Error ? error.message : 'Payment provider not configured',
        });
      }
      throw error;
    }
    if (!verification.valid) {
      throw new UnauthorizedException({
        code: 'WEBHOOK_SIGNATURE_INVALID',
        message: verification.invalidReason ?? 'Webhook signature verification failed',
      });
    }
    return verification;
  }
}

function toIntentView(intent: {
  id: string;
  provider: string;
  status: string;
  buyerId: string;
  listingId: string;
  amountMinor: bigint;
  currency: string;
  refundedMinor: bigint;
  checkoutUrl: string | null;
  version: number;
  expiresAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}): Record<string, unknown> {
  return {
    id: intent.id,
    provider: intent.provider,
    status: intent.status,
    buyerId: intent.buyerId,
    listingId: intent.listingId,
    amountMinor: intent.amountMinor.toString(),
    currency: intent.currency,
    refundedMinor: intent.refundedMinor.toString(),
    checkoutUrl: intent.checkoutUrl,
    version: intent.version,
    expiresAt: intent.expiresAt ? intent.expiresAt.toISOString() : null,
    createdAt: intent.createdAt.toISOString(),
    updatedAt: intent.updatedAt.toISOString(),
  };
}

/** Provider refs are operational, not secret — but logs keep only a suffix. */
function redactRef(ref: string): string {
  return ref.length > 8 ? `…${ref.slice(-8)}` : '…';
}
