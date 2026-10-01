/**
 * Seller-tier policy (Phase 0.11).
 *
 * Tier limits and commissions are CONFIGURATION, never hard-coded across the
 * application. Feature code resolves a PlanPolicy from a tier config row and
 * enforces it. Pure domain logic: no I/O, no framework.
 */

export const TIER_CODES = ['FREE_CODER', 'PRO_CODER', 'CORPORATE_SELLER'] as const;
export type TierCode = (typeof TIER_CODES)[number];

export const QUALITY_QUEUES = ['standard', 'priority'] as const;
export type QualityQueue = (typeof QUALITY_QUEUES)[number];

export const VERIFICATION_LEVELS = ['basic', 'enhanced', 'enterprise'] as const;
export type VerificationLevel = (typeof VERIFICATION_LEVELS)[number];

export class PlanPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'PlanPolicyError';
  }
}

/** Raw, configuration-provided tier definition (e.g. a seller_tiers row). */
export interface TierConfig {
  code: string;
  name: string;
  storageQuotaBytes: bigint | null; // null = unlimited
  maxUploadBytesPerFile: bigint;
  maxActiveListings: number | null; // null = unlimited
  commissionBps: number; // basis points, 1500 = 15.00%
  qualityQueue: string;
  verificationLevel: string;
  features?: Record<string, boolean>;
}

/** Validated, normalised policy consumed by feature code. */
export interface PlanPolicy {
  code: string;
  name: string;
  storageQuotaBytes: bigint | null;
  maxUploadBytesPerFile: bigint;
  maxActiveListings: number | null;
  commissionBps: number;
  qualityQueue: QualityQueue;
  verificationLevel: VerificationLevel;
  features: Record<string, boolean>;
}

const MAX_BPS = 10_000;

export function resolvePlanPolicy(config: TierConfig): PlanPolicy {
  if (!config.code) {
    throw new PlanPolicyError('Tier config requires a code');
  }
  if (
    !Number.isInteger(config.commissionBps) ||
    config.commissionBps < 0 ||
    config.commissionBps > MAX_BPS
  ) {
    throw new PlanPolicyError(`commissionBps must be an integer in [0, ${MAX_BPS}]`);
  }
  if (config.storageQuotaBytes !== null && config.storageQuotaBytes < 0n) {
    throw new PlanPolicyError('storageQuotaBytes must be >= 0 or null (unlimited)');
  }
  if (config.maxUploadBytesPerFile <= 0n) {
    throw new PlanPolicyError('maxUploadBytesPerFile must be > 0');
  }
  if (config.maxActiveListings !== null && config.maxActiveListings < 0) {
    throw new PlanPolicyError('maxActiveListings must be >= 0 or null (unlimited)');
  }
  if (!QUALITY_QUEUES.includes(config.qualityQueue as QualityQueue)) {
    throw new PlanPolicyError(`Unknown qualityQueue: ${config.qualityQueue}`);
  }
  if (!VERIFICATION_LEVELS.includes(config.verificationLevel as VerificationLevel)) {
    throw new PlanPolicyError(`Unknown verificationLevel: ${config.verificationLevel}`);
  }

  return {
    code: config.code,
    name: config.name,
    storageQuotaBytes: config.storageQuotaBytes,
    maxUploadBytesPerFile: config.maxUploadBytesPerFile,
    maxActiveListings: config.maxActiveListings,
    commissionBps: config.commissionBps,
    qualityQueue: config.qualityQueue as QualityQueue,
    verificationLevel: config.verificationLevel as VerificationLevel,
    features: config.features ?? {},
  };
}

/**
 * Platform fee in MINOR units, computed with integer math only (floored).
 * The seller receives `amount - fee`. Never uses floating point.
 */
export function computePlatformFeeMinor(amountMinor: bigint, commissionBps: number): bigint {
  if (amountMinor < 0n) {
    throw new PlanPolicyError('amountMinor must be >= 0');
  }
  if (!Number.isInteger(commissionBps) || commissionBps < 0 || commissionBps > MAX_BPS) {
    throw new PlanPolicyError(`commissionBps must be an integer in [0, ${MAX_BPS}]`);
  }
  return (amountMinor * BigInt(commissionBps)) / BigInt(MAX_BPS);
}

/** True when a proposed upload is permitted by the policy. */
export function isUploadAllowed(policy: PlanPolicy, fileSizeBytes: bigint): boolean {
  if (fileSizeBytes <= 0n) {
    return false;
  }
  if (fileSizeBytes > policy.maxUploadBytesPerFile) {
    return false;
  }
  return true;
}

/** True when adding one more active listing is permitted. */
export function canAddActiveListing(policy: PlanPolicy, currentActiveCount: number): boolean {
  if (currentActiveCount < 0) {
    return false;
  }
  return policy.maxActiveListings === null || currentActiveCount < policy.maxActiveListings;
}
