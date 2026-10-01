import type { AssetType } from '@fa/domain';

type Payload = Record<string, unknown>;

function str(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function num(value: unknown): number | undefined {
  return typeof value === 'number' ? value : undefined;
}

function bool(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function strArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === 'string')
    : [];
}

/** Maps a validated domain payload to the Prisma metadata row for `type`. */
export function toMetadataRow(type: AssetType, payload: Payload): Record<string, unknown> {
  switch (type) {
    case 'SOFTWARE':
      return {
        language: str(payload.language) ?? null,
        framework: str(payload.framework) ?? null,
        runtime: str(payload.runtime) ?? null,
        sourceRepo: str(payload.sourceRepo) ?? null,
        packageSizeBytes: BigInt(num(payload.packageSizeBytes) ?? 0),
        dependencyCount: num(payload.dependencyCount) ?? 0,
        licenseSpdx: str(payload.licenseSpdx) ?? null,
      };
    case 'WEBSITE':
      return {
        domain: String(payload.domain ?? ''),
        monthlyTraffic: num(payload.monthlyTraffic) ?? null,
        technology: strArray(payload.technology),
        hosting: str(payload.hosting) ?? null,
        monthlyRevenueMinor:
          num(payload.monthlyRevenueMinor) === undefined
            ? null
            : BigInt(num(payload.monthlyRevenueMinor) as number),
        revenueCurrency: str(payload.revenueCurrency) ?? null,
        analyticsProvider: str(payload.analyticsProvider) ?? null,
      };
    case 'MOBILE_APP':
      return {
        platforms: strArray(payload.platforms),
        bundleId: str(payload.bundleId) ?? null,
        storeLinks: strArray(payload.storeLinks),
        installs: num(payload.installs) ?? null,
        monthlyRevenueMinor:
          num(payload.monthlyRevenueMinor) === undefined
            ? null
            : BigInt(num(payload.monthlyRevenueMinor) as number),
        revenueCurrency: str(payload.revenueCurrency) ?? null,
        appVersion: str(payload.appVersion) ?? null,
      };
    case 'YOUTUBE_CHANNEL':
      return {
        channelId: String(payload.channelId ?? ''),
        subscribers: num(payload.subscribers) ?? null,
        totalViews:
          num(payload.totalViews) === undefined ? null : BigInt(num(payload.totalViews) as number),
        videoCount: num(payload.videoCount) ?? null,
        channelAgeDays: num(payload.channelAgeDays) ?? null,
        monetized: bool(payload.monetized, false),
        monthlyRevenueMinor:
          num(payload.monthlyRevenueMinor) === undefined
            ? null
            : BigInt(num(payload.monthlyRevenueMinor) as number),
        revenueCurrency: str(payload.revenueCurrency) ?? null,
      };
    case 'INSTAGRAM_PROFILE':
      return {
        accountId: String(payload.accountId ?? ''),
        followers: num(payload.followers) ?? null,
        engagementBps: num(payload.engagementBps) ?? null,
        mediaCount: num(payload.mediaCount) ?? null,
        accountAgeDays: num(payload.accountAgeDays) ?? null,
      };
    case 'GAME_ACCOUNT':
      return {
        game: String(payload.game ?? ''),
        platform: String(payload.platform ?? ''),
        accountRef: String(payload.accountRef ?? ''),
        levelRank: str(payload.levelRank) ?? null,
        inventory: strArray(payload.inventory),
        banState: str(payload.banState) ?? 'CLEAR',
        transferable: bool(payload.transferable, true),
      };
    case 'DOMAIN':
      return {
        domainName: String(payload.domainName ?? ''),
        registrar: str(payload.registrar) ?? null,
        expiresAt: str(payload.expiresAt) ? new Date(String(payload.expiresAt)) : null,
        transferLocked: bool(payload.transferLocked, false),
        dns: strArray(payload.dns),
      };
    case 'OTHER':
    default:
      return { description: str(payload.description) ?? '' };
  }
}

/** Prisma relation key that holds the metadata row for a given asset type. */
export function metadataRelation(type: AssetType): string | null {
  switch (type) {
    case 'SOFTWARE':
      return 'software';
    case 'WEBSITE':
      return 'website';
    case 'MOBILE_APP':
      return 'mobile';
    case 'YOUTUBE_CHANNEL':
      return 'youtube';
    case 'INSTAGRAM_PROFILE':
      return 'instagram';
    case 'GAME_ACCOUNT':
      return 'game';
    case 'DOMAIN':
      return 'domain';
    case 'OTHER':
    default:
      return null; // free-form description is stored on `extra`
  }
}

/** Nested Prisma create/update payload for the type's metadata relation. */
export function toNestedMetadata(
  type: AssetType,
  payload: Payload,
  mode: 'create' | 'update',
): Record<string, unknown> {
  const row = toMetadataRow(type, payload);
  const relation = metadataRelation(type);
  if (!relation) {
    // Free-form assets keep their description in the validated `extra` JSON column.
    return { extra: row };
  }
  return mode === 'create' ? { [relation]: { create: row } } : { [relation]: { update: row } };
}

/** Recursively converts bigint/Date to JSON-safe values. */
export function serializeValue(value: unknown): unknown {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (Array.isArray(value)) {
    return value.map(serializeValue);
  }
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      if (key === 'assetId') {
        continue;
      }
      out[key] = serializeValue(entry);
    }
    return out;
  }
  return value;
}
