export * from './money';
export * from './result';
export * from './policies/plan-policy';
export * from './ports';
export * from './assets/types';
export * from './assets/schemas';
export * from './assets/registry';
export * from './listings/listing-machine';
export * from './auctions/bid-rules';
export * from './quality/security-finding';
export * from './quality/quality-policy';
export * from './quality/scanner';
export * from './verification/verification-machine';
export * from './verification/evidence';

/**
 * Bumped when foundational domain primitives change incompatibly.
 * NOTE: Phase 1 exposes only primitives (Money, Result). Marketplace
 * business rules are intentionally NOT implemented yet.
 */
export const DOMAIN_FOUNDATION_VERSION = '0.0.0';
