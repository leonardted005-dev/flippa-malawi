import { apiBaseUrl } from './api';

/** Card metrics are already filtered server-side to slots applicable to the kind. */
export interface ListingCardMetrics {
  revenue?: string;
  traffic?: number;
  subscribers?: number;
  views?: string;
  followers?: number;
  engagement?: number;
  installs?: number;
  levelRank?: string;
  technology?: string[];
  age?: number;
}

export interface ListingCardDto {
  id: string;
  mode: 'FIXED_PRICE' | 'AUCTION';
  status: string;
  priceMinor: string | null;
  currency: string | null;
  endsAt: string | null;
  publishedAt: string | null;
  featured: boolean;
  asset: {
    id: string;
    type: string;
    slug: string;
    title: string;
    country: string;
    verificationStatus: string;
    qualityStatus: string;
  };
  seller: {
    id: string;
    displayName: string;
    tierCode: string;
    country: string;
    ratingAvgBp: number;
    ratingCount: number;
  } | null;
  metrics: ListingCardMetrics;
  attachmentCount: number;
  heroImageUrl: string | null;
}

export interface BrowseResponse {
  results: ListingCardDto[];
  pageInfo: {
    limit: number;
    hasMore: boolean;
    nextCursor: string | null;
    sort: string;
  };
}

export interface BrowseParams {
  assetType?: string;
  country?: string;
  q?: string;
  sort?: string;
  minPriceMinor?: number;
  maxPriceMinor?: number;
  limit?: number;
}

/**
 * Server-side browse. Filtering, sorting and pagination all happen in the API —
 * the web client never filters a truncated set locally.
 */
export async function fetchBrowse(params: BrowseParams = {}): Promise<BrowseResponse> {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== null && `${value}`.length > 0) {
      search.set(key, String(value));
    }
  }
  const query = search.toString();
  const url = `${apiBaseUrl}/api/v1/discover/listings${query ? `?${query}` : ''}`;

  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) {
    throw new Error(`Browse request failed with status ${res.status}`);
  }
  return (await res.json()) as BrowseResponse;
}

/** Formats integer minor units for display only (never used for arithmetic). */
export function formatMoney(amountMinor: string | null, currency: string | null): string {
  if (amountMinor === null) {
    return 'No price set';
  }
  const value = Number(amountMinor) / 100;
  try {
    return new Intl.NumberFormat('en-ZM', {
      style: 'currency',
      currency: currency ?? 'ZMW',
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    return `${value.toLocaleString()} ${currency ?? ''}`.trim();
  }
}

export function formatCount(value: number | string | undefined): string | null {
  if (value === undefined) {
    return null;
  }
  const n = typeof value === 'string' ? Number(value) : value;
  if (!Number.isFinite(n)) {
    return null;
  }
  return new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}
