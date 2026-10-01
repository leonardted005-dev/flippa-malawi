import type { ZodSchema } from 'zod';

import {
  domainMetadataSchema,
  gameAccountMetadataSchema,
  instagramMetadataSchema,
  mobileAppMetadataSchema,
  otherMetadataSchema,
  softwareMetadataSchema,
  websiteMetadataSchema,
  youtubeMetadataSchema,
} from './schemas';
import {
  AssetValidationError,
  type AssetMetricKey,
  type AssetType,
  type AssetValidationIssue,
  type OwnershipVerification,
} from './types';

export interface AssetTypeDescriptor {
  type: AssetType;
  label: string;
  /** Zod schema validating the client-supplied metadata payload for this kind. */
  schema: ZodSchema;
  /** Evidence path used to verify the seller owns the asset (Phase 8). */
  ownershipVerification: OwnershipVerification;
  /** `OTHER` (and anything unusual) must be reviewed by a human. */
  requiresManualReview: boolean;
  /** Metric slots that meaningfully apply to this kind (cards show only these). */
  metrics: readonly AssetMetricKey[];
  /** Property on the metadata payload that acts as the asset's natural key. */
  naturalKey: string;
}

export const ASSET_TYPE_REGISTRY: Record<AssetType, AssetTypeDescriptor> = {
  SOFTWARE: {
    type: 'SOFTWARE',
    label: 'Software / Source code',
    schema: softwareMetadataSchema,
    ownershipVerification: 'PLATFORM',
    requiresManualReview: false,
    metrics: ['technology', 'age'],
    naturalKey: 'sourceRepo',
  },
  WEBSITE: {
    type: 'WEBSITE',
    label: 'Website',
    schema: websiteMetadataSchema,
    ownershipVerification: 'DOMAIN',
    requiresManualReview: false,
    metrics: ['revenue', 'traffic', 'technology', 'age'],
    naturalKey: 'domain',
  },
  MOBILE_APP: {
    type: 'MOBILE_APP',
    label: 'Mobile app',
    schema: mobileAppMetadataSchema,
    ownershipVerification: 'STORE',
    requiresManualReview: false,
    metrics: ['revenue', 'installs', 'technology', 'age'],
    naturalKey: 'bundleId',
  },
  YOUTUBE_CHANNEL: {
    type: 'YOUTUBE_CHANNEL',
    label: 'YouTube channel',
    schema: youtubeMetadataSchema,
    ownershipVerification: 'SOCIAL',
    requiresManualReview: false,
    metrics: ['revenue', 'subscribers', 'views', 'age'],
    naturalKey: 'channelId',
  },
  INSTAGRAM_PROFILE: {
    type: 'INSTAGRAM_PROFILE',
    label: 'Instagram profile',
    schema: instagramMetadataSchema,
    ownershipVerification: 'SOCIAL',
    requiresManualReview: false,
    metrics: ['followers', 'engagement', 'age'],
    naturalKey: 'accountId',
  },
  GAME_ACCOUNT: {
    type: 'GAME_ACCOUNT',
    label: 'Gaming account',
    schema: gameAccountMetadataSchema,
    ownershipVerification: 'PLATFORM',
    requiresManualReview: false,
    metrics: ['levelRank', 'inventory', 'age'],
    naturalKey: 'accountRef',
  },
  DOMAIN: {
    type: 'DOMAIN',
    label: 'Domain name',
    schema: domainMetadataSchema,
    ownershipVerification: 'DOMAIN',
    requiresManualReview: false,
    metrics: ['age'],
    naturalKey: 'domainName',
  },
  OTHER: {
    type: 'OTHER',
    label: 'Other digital asset',
    schema: otherMetadataSchema,
    ownershipVerification: 'MANUAL',
    requiresManualReview: true,
    metrics: [],
    naturalKey: 'description',
  },
};

export function getAssetTypeDescriptor(type: AssetType): AssetTypeDescriptor {
  return ASSET_TYPE_REGISTRY[type];
}

export function listAssetTypeDescriptors(): AssetTypeDescriptor[] {
  return Object.values(ASSET_TYPE_REGISTRY);
}

export type AssetMetadataValidation =
  { ok: true; value: Record<string, unknown> } | { ok: false; issues: AssetValidationIssue[] };

/** Validates a client payload against the schema for `type`. */
export function validateAssetMetadata(type: AssetType, payload: unknown): AssetMetadataValidation {
  const result = getAssetTypeDescriptor(type).schema.safeParse(payload);
  if (result.success) {
    return { ok: true, value: result.data as Record<string, unknown> };
  }
  return {
    ok: false,
    issues: result.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    })),
  };
}

/** Same as validateAssetMetadata but throws AssetValidationError on failure. */
export function parseAssetMetadata(type: AssetType, payload: unknown): Record<string, unknown> {
  const result = validateAssetMetadata(type, payload);
  if (!result.ok) {
    throw new AssetValidationError(result.issues);
  }
  return result.value;
}

/** Metric slots to render for a kind — everything else must stay hidden. */
export function metricsForAssetType(type: AssetType): readonly AssetMetricKey[] {
  return getAssetTypeDescriptor(type).metrics;
}

/** Owner-controlled fields only; verification/scanner fields are platform-owned. */
export function isPlatformOwnedMetric(key: string): boolean {
  return key === 'qualityScore' || key === 'analyticsVerified' || key === 'snapshotId';
}
