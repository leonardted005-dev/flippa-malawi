import type { AssetMetricKey, AssetType } from '@fa/domain';
import { metricsForAssetType } from '@fa/domain';

import { serializeValue } from '../catalog/catalog.mapper';

type MetadataRow = Record<string, unknown> | null | undefined;

/** The single type-specific metadata row attached to an asset (one is non-null). */
export function pickMetadata(asset: Record<string, unknown>): MetadataRow {
  return (asset['software'] ??
    asset['website'] ??
    asset['mobile'] ??
    asset['youtube'] ??
    asset['instagram'] ??
    asset['game'] ??
    asset['domain']) as MetadataRow;
}

/**
 * Builds the metrics block for a listing card.
 *
 * Phase-0.5 rule: render ONLY the metric slots that (a) are declared for this
 * asset kind by the domain registry and (b) actually carry a value. Never a
 * placeholder, never a zero-filled slot.
 */
export function extractCardMetrics(asset: Record<string, unknown>): Record<string, unknown> {
  const type = asset['type'] as AssetType;
  const allowed = metricsForAssetType(type);
  const meta = pickMetadata(asset) ?? {};
  const metrics: Record<string, unknown> = {};

  const put = (key: AssetMetricKey, value: unknown): void => {
    if (!allowed.includes(key)) {
      return; // metric not applicable to this kind
    }
    if (value === undefined || value === null) {
      return; // no real value -> hide the slot entirely
    }
    if (Array.isArray(value) && value.length === 0) {
      return; // an empty collection is not a value -> hide the slot
    }
    if (typeof value === 'string' && value.trim().length === 0) {
      return;
    }
    metrics[key] = serializeValue(value);
  };

  put('revenue', meta['monthlyRevenueMinor']);
  put('traffic', meta['monthlyTraffic']);
  put('subscribers', meta['subscribers']);
  put('views', meta['totalViews']);
  put('followers', meta['followers']);
  put('engagement', meta['engagementBps']);
  put('installs', meta['installs']);
  put('levelRank', meta['levelRank']);
  put('technology', meta['technology']);

  if (typeof meta['channelAgeDays'] === 'number') {
    put('age', meta['channelAgeDays']);
  }
  if (typeof meta['accountAgeDays'] === 'number') {
    put('age', meta['accountAgeDays']);
  }

  return metrics;
}

/**
 * Card projection per docs/MARKETPLACE_UX_ARCHITECTURE.md §3: dense, scannable
 * and information-honest. `heroImageUrl` is a short-lived signed URL issued by
 * the caller (never a permanent bucket link).
 */
export function toListingCardView(listing: Record<string, unknown>): Record<string, unknown> {
  const asset = listing['asset'] as Record<string, unknown>;
  const seller = listing['seller'] as Record<string, unknown> | null;
  const attachments = (listing['attachments'] as Array<Record<string, unknown>>) ?? [];
  const hero = attachments[0];
  const storageObject = hero?.['storageObject'] as Record<string, unknown> | undefined;

  return {
    id: listing['id'],
    mode: listing['mode'],
    status: listing['status'],
    priceMinor: serializeValue(listing['priceMinor'] ?? null),
    currency: listing['currency'],
    startsAt: serializeValue(listing['startsAt'] ?? null),
    endsAt: serializeValue(listing['endsAt'] ?? null),
    publishedAt: serializeValue(listing['publishedAt'] ?? null),
    featured:
      listing['featuredUntil'] !== null && listing['featuredUntil'] !== undefined
        ? new Date(String(listing['featuredUntil'])).getTime() > Date.now()
        : false,
    asset: {
      id: asset['id'],
      type: asset['type'],
      slug: asset['slug'],
      title: asset['title'],
      country: asset['country'],
      verificationStatus: asset['verificationStatus'],
      qualityStatus: asset['qualityStatus'],
    },
    seller: seller
      ? {
          id: seller['id'],
          displayName: seller['displayName'],
          tierCode: seller['tierCode'],
          country: seller['country'],
          ratingAvgBp: seller['ratingAvgBp'],
          ratingCount: seller['ratingCount'],
        }
      : null,
    metrics: extractCardMetrics(asset),
    attachmentCount: attachments.length,
    heroImage: storageObject
      ? {
          storageObjectId: storageObject['id'],
          width: storageObject['width'] ?? null,
          height: storageObject['height'] ?? null,
          format: storageObject['imageFormat'] ?? null,
        }
      : null,
  };
}
