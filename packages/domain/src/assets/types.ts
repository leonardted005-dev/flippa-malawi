/**
 * Digital-asset taxonomy (Phase 0.6 / ADR 0001).
 *
 * There is ONE asset abstraction with a shared identity, plus a typed metadata
 * shape per kind. Types and metric applicability live here so the API and the
 * clients agree on what a given asset kind can express.
 */

export const ASSET_TYPES = [
  'SOFTWARE',
  'WEBSITE',
  'MOBILE_APP',
  'YOUTUBE_CHANNEL',
  'INSTAGRAM_PROFILE',
  'GAME_ACCOUNT',
  'DOMAIN',
  'OTHER',
] as const;

export type AssetType = (typeof ASSET_TYPES)[number];

export function isAssetType(value: unknown): value is AssetType {
  return typeof value === 'string' && (ASSET_TYPES as readonly string[]).includes(value);
}

/** How ownership of this asset kind can be evidenced (executed in Phase 8). */
export const OWNERSHIP_VERIFICATIONS = [
  'NONE',
  'DOMAIN',
  'SOCIAL',
  'STORE',
  'PLATFORM',
  'MANUAL',
] as const;

export type OwnershipVerification = (typeof OWNERSHIP_VERIFICATIONS)[number];

/**
 * Metric slots a listing card / detail page may show. Cards render ONLY the
 * slot(s) that actually apply to the asset kind — never fabricated values.
 */
export const ASSET_METRIC_KEYS = [
  'revenue',
  'traffic',
  'subscribers',
  'views',
  'followers',
  'engagement',
  'installs',
  'levelRank',
  'inventory',
  'technology',
  'age',
] as const;

export type AssetMetricKey = (typeof ASSET_METRIC_KEYS)[number];

export interface AssetValidationIssue {
  path: string;
  message: string;
}

export class AssetValidationError extends Error {
  constructor(public readonly issues: AssetValidationIssue[]) {
    super('Asset metadata validation failed');
    this.name = 'AssetValidationError';
  }
}
