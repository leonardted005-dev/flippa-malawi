/**
 * Canonical, provider-independent payment lifecycle (PAYMENT_ARCHITECTURE §2).
 *
 * PURE domain code: no NestJS, no Prisma, no provider field names. The
 * orchestrator is the ONLY writer of these transitions; clients and browser
 * redirects never decide payment state (rules #9 and #11).
 *
 *   INITIATED → PENDING → AUTHORIZED → CAPTURED → (REFUNDED | PARTIALLY_REFUNDED)
 *        └──────────┴──────────┴────→ DECLINED | FAILED | EXPIRED | VOIDED
 *
 * `CAPTURED → PARTIALLY_REFUNDED` may repeat while refunds remain partial;
 * a final full refund lands on REFUNDED. Terminal states never resurrect.
 */

export const PAYMENT_STATUSES = [
  'INITIATED',
  'PENDING',
  'AUTHORIZED',
  'CAPTURED',
  'REFUNDED',
  'PARTIALLY_REFUNDED',
  'DECLINED',
  'FAILED',
  'EXPIRED',
  'VOIDED',
] as const;

export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];

export function isPaymentStatus(value: unknown): value is PaymentStatus {
  return typeof value === 'string' && (PAYMENT_STATUSES as readonly string[]).includes(value);
}

const ALLOWED_TRANSITIONS: Record<PaymentStatus, PaymentStatus[]> = {
  INITIATED: ['PENDING', 'DECLINED', 'FAILED', 'EXPIRED'],
  PENDING: ['AUTHORIZED', 'CAPTURED', 'DECLINED', 'FAILED', 'EXPIRED'],
  AUTHORIZED: ['CAPTURED', 'VOIDED', 'DECLINED', 'FAILED', 'EXPIRED'],
  CAPTURED: ['REFUNDED', 'PARTIALLY_REFUNDED'],
  // More partial refunds may follow until the captured amount is exhausted.
  PARTIALLY_REFUNDED: ['PARTIALLY_REFUNDED', 'REFUNDED'],
  REFUNDED: [],
  DECLINED: [],
  FAILED: [],
  EXPIRED: [],
  VOIDED: [],
};

export class PaymentTransitionError extends Error {
  constructor(
    public readonly from: PaymentStatus,
    public readonly to: PaymentStatus,
  ) {
    super(`Invalid payment transition ${from} → ${to}`);
    this.name = 'PaymentTransitionError';
  }
}

/** Throws PaymentTransitionError when `to` is not reachable from `from`. */
export function assertPaymentTransition(from: PaymentStatus, to: PaymentStatus): void {
  if (from === to) {
    return;
  }
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new PaymentTransitionError(from, to);
  }
}

export function isTerminalPaymentStatus(status: PaymentStatus): boolean {
  return ALLOWED_TRANSITIONS[status].length === 0;
}

/** Only captured funds can be refunded (server-side accounting guards the rest). */
export function isRefundablePaymentStatus(status: PaymentStatus): boolean {
  return status === 'CAPTURED' || status === 'PARTIALLY_REFUNDED';
}

/**
 * Derives the post-refund status from immutable accounting: how much of the
 * captured amount has been returned so far. Never inferred from client input.
 */
export function deriveRefundStatus(refundedMinor: bigint, capturedMinor: bigint): PaymentStatus {
  if (refundedMinor <= 0n) {
    return 'CAPTURED';
  }
  return refundedMinor >= capturedMinor ? 'REFUNDED' : 'PARTIALLY_REFUNDED';
}
