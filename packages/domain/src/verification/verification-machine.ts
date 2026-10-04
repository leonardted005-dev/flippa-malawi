/**
 * Verification case state machine (Phase 8).
 *
 * PURE domain code: no NestJS, no Prisma, no I/O. All decisions take an
 * explicit clock so tests are deterministic.
 *
 * Lifecycle:
 *   OPEN ──► SUBMITTED ──► APPROVED ──► (terminal)
 *     │          │            └── VERIFIED is derived, see below
 *     │          └──► REJECTED ──► (terminal; seller may open a NEW case)
 *     └──► EXPIRED (challenge TTL elapsed) ──► (terminal; open a NEW case)
 *
 * `verificationStatus` on the DigitalAsset is a DERIVED projection of the
 * latest non-expired case outcome:
 *   - an APPROVED case        → VERIFIED
 *   - a SUBMITTED/OPEN case   → IN_REVIEW
 *   - a REJECTED case (latest)→ REJECTED
 *   - no case at all          → UNVERIFIED
 *
 * Invariants:
 * - Only one OPEN/SUBMITTED case may exist per asset at a time (mirrored by
 *   a partial-unique DB constraint; the machine guards the transition too).
 * - A VERIFIED asset stays VERIFIED until a newer case supersedes it or an
 *   admin explicitly revokes it — submitting a new case does NOT un-verify.
 * - Verification NEVER trusts the network: challenge checks run server-side
 *   against freshly fetched evidence, never against client claims.
 */

export const VERIFICATION_CASE_STATUSES = [
  'OPEN',
  'SUBMITTED',
  'APPROVED',
  'REJECTED',
  'EXPIRED',
] as const;

export type VerificationCaseStatus = (typeof VERIFICATION_CASE_STATUSES)[number];

export const VERIFICATION_METHODS = [
  'DNS_TXT',
  'HTTP_TOKEN',
  'SOCIAL_PROOF',
  'STORE_PROOF',
  'MANUAL',
] as const;

export type VerificationMethod = (typeof VERIFICATION_METHODS)[number];

/** Asset verification states surfaced on the DigitalAsset row. */
export const ASSET_VERIFICATION_STATUSES = [
  'UNVERIFIED',
  'IN_REVIEW',
  'VERIFIED',
  'REJECTED',
] as const;

export type AssetVerificationStatus = (typeof ASSET_VERIFICATION_STATUSES)[number];

export class VerificationTransitionError extends Error {
  constructor(
    public readonly from: VerificationCaseStatus,
    public readonly to: VerificationCaseStatus,
  ) {
    super(`Cannot transition verification case from ${from} to ${to}`);
    this.name = 'VerificationTransitionError';
  }
}

const ALLOWED_TRANSITIONS: Record<VerificationCaseStatus, VerificationCaseStatus[]> = {
  OPEN: ['SUBMITTED', 'EXPIRED'],
  SUBMITTED: ['APPROVED', 'REJECTED', 'EXPIRED'],
  APPROVED: [],
  REJECTED: [],
  EXPIRED: [],
};

/** Throws VerificationTransitionError when `to` is not reachable from `from`. */
export function assertVerificationTransition(
  from: VerificationCaseStatus,
  to: VerificationCaseStatus,
): void {
  if (from === to) {
    return;
  }
  if (!ALLOWED_TRANSITIONS[from].includes(to)) {
    throw new VerificationTransitionError(from, to);
  }
}

/** Whether a case in this status still occupies the "one active case" slot. */
export function isActiveVerificationCase(status: VerificationCaseStatus): boolean {
  return status === 'OPEN' || status === 'SUBMITTED';
}

/**
 * Derives the asset-level verificationStatus from the latest case outcome.
 * Terminal APPROVED/REJECTED outcomes persist until superseded — IN_REVIEW
 * only applies while a case is actually open/submitted.
 */
export function deriveAssetVerificationStatus(
  latest: { status: VerificationCaseStatus } | null,
): AssetVerificationStatus {
  if (!latest) {
    return 'UNVERIFIED';
  }
  switch (latest.status) {
    case 'APPROVED':
      return 'VERIFIED';
    case 'REJECTED':
      return 'REJECTED';
    case 'OPEN':
    case 'SUBMITTED':
      return 'IN_REVIEW';
    case 'EXPIRED':
      return 'UNVERIFIED';
  }
}

/**
 * Which verification methods are valid for each asset kind. The server picks
 * the method — the client may only supply the EVIDENCE for an already-issued
 * challenge (never the verdict).
 */
export const VERIFICATION_METHOD_BY_ASSET: Record<string, VerificationMethod[]> = {
  WEBSITE: ['DNS_TXT', 'HTTP_TOKEN', 'MANUAL'],
  DOMAIN: ['DNS_TXT', 'MANUAL'],
  YOUTUBE_CHANNEL: ['SOCIAL_PROOF', 'MANUAL'],
  INSTAGRAM_PROFILE: ['SOCIAL_PROOF', 'MANUAL'],
  MOBILE_APP: ['STORE_PROOF', 'MANUAL'],
  SOFTWARE: ['MANUAL'],
  GAME_ACCOUNT: ['MANUAL'],
  OTHER: ['MANUAL'],
};

/** Challenge TTL by method (ms). DNS/HTTP propagate slowly; social is manual. */
export const CHALLENGE_TTL_MS: Record<VerificationMethod, number> = {
  DNS_TXT: 72 * 3_600_000,
  HTTP_TOKEN: 72 * 3_600_000,
  SOCIAL_PROOF: 7 * 24 * 3_600_000,
  STORE_PROOF: 7 * 24 * 3_600_000,
  MANUAL: 30 * 24 * 3_600_000,
};

/** Max completed check attempts before a case must be re-opened. */
export const MAX_VERIFICATION_ATTEMPTS = 10;
