/**
 * Auction bid rules (Phase 0.17 / docs/OBSERVABILITY_AND_CONCURRENCY.md).
 *
 * Pure functions: no clock reads (the caller passes `now`), no I/O, money is
 * integer minor units. The API layer evaluates these INSIDE the row lock that
 * serialises bids for an auction — never before it.
 */

/** Minimum increment: max(5% of current bid, 100 minor units). */
export const AUCTION_MIN_INCREMENT_BPS = 500;
export const AUCTION_MIN_INCREMENT_MINOR = 100n;

/** Anti-snipe: bids inside this window before close push `endsAt` back. */
export const ANTI_SNIPE_WINDOW_MS = 120_000;
export const ANTI_SNIPE_EXTENSION_MS = 120_000;

export type BidRuleCode =
  | 'BID_NOT_POSITIVE'
  | 'BID_TOO_LOW'
  | 'SELF_BID'
  | 'AUCTION_NOT_LIVE'
  | 'AUCTION_ALREADY_CLOSED'
  | 'AUCTION_NOT_STARTED';

export class BidRuleError extends Error {
  constructor(
    public readonly code: BidRuleCode,
    message: string,
  ) {
    super(message);
    this.name = 'BidRuleError';
  }
}

export interface BidEvaluationInput {
  amountMinor: bigint;
  /** Current top bid, or null when nobody has bid yet. */
  currentBidMinor: bigint | null;
  /** Where the auction is scheduled to end (server clock). */
  endsAt: Date;
  now: Date;
  bidderId: string;
  sellerId: string;
}

export function resolveMinIncrementMinor(currentBidMinor: bigint): bigint {
  const percentage = (currentBidMinor * BigInt(AUCTION_MIN_INCREMENT_BPS)) / 10_000n;
  return percentage > AUCTION_MIN_INCREMENT_MINOR ? percentage : AUCTION_MIN_INCREMENT_MINOR;
}

/**
 * The absolute minimum acceptable next bid (or the opening bid when empty).
 */
export function minimumAcceptableBidMinor(currentBidMinor: bigint | null): bigint {
  if (currentBidMinor === null) {
    return 1n;
  }
  return currentBidMinor + resolveMinIncrementMinor(currentBidMinor);
}

export type BidEvaluation =
  { ok: true; requiredMinor: bigint } | { ok: false; code: BidRuleCode; message: string };

export function evaluateBid(input: BidEvaluationInput): BidEvaluation {
  if (input.sellerId === input.bidderId) {
    return { ok: false, code: 'SELF_BID', message: 'A seller cannot bid on their own listing' };
  }
  if (input.now.getTime() >= input.endsAt.getTime()) {
    return {
      ok: false,
      code: 'AUCTION_ALREADY_CLOSED',
      message: 'Auction has already ended (server clock)',
    };
  }
  if (input.amountMinor <= 0n) {
    return { ok: false, code: 'BID_NOT_POSITIVE', message: 'Bid must be positive' };
  }

  const requiredMinor = minimumAcceptableBidMinor(input.currentBidMinor);
  if (input.amountMinor < requiredMinor) {
    return {
      ok: false,
      code: 'BID_TOO_LOW',
      message: `Bid must be at least ${requiredMinor.toString()} minor units`,
    };
  }

  return { ok: true, requiredMinor };
}

export function assertBidRules(input: BidEvaluationInput): void {
  const result = evaluateBid(input);
  if (!result.ok) {
    throw new BidRuleError(result.code, result.message);
  }
}

/**
 * True when the auction must be extended instead of closed (anti-snipe):
 * the decisive bid landed inside the window before the scheduled end.
 */
export function shouldExtendForAntiSnipe(endsAt: Date, lastBidAt: Date | null, now: Date): boolean {
  void now;
  if (!lastBidAt) {
    return false;
  }
  return lastBidAt.getTime() > endsAt.getTime() - ANTI_SNIPE_WINDOW_MS;
}

export function nextEndsAtAfterExtension(endsAt: Date, now: Date): Date {
  const base = endsAt.getTime() > now.getTime() ? endsAt.getTime() : now.getTime();
  return new Date(base + ANTI_SNIPE_EXTENSION_MS);
}

/** A reserve of null/undefined means "no reserve" (any bid wins). */
export function isReserveMet(
  reserveMinor: bigint | null | undefined,
  currentBidMinor: bigint | null | undefined,
): boolean {
  if (reserveMinor === null || reserveMinor === undefined) {
    return true;
  }
  if (currentBidMinor === null || currentBidMinor === undefined) {
    return false;
  }
  return currentBidMinor >= reserveMinor;
}
