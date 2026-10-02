import { z } from 'zod';

export const LISTING_STATUSES = [
  'DRAFT',
  'PENDING_REVIEW',
  'ACTIVE',
  'SOLD',
  'PAUSED',
  'EXPIRED',
  'WITHDRAWN',
] as const;

export type ListingStatus = (typeof LISTING_STATUSES)[number];

export const LISTING_MODES = ['FIXED_PRICE', 'AUCTION'] as const;

export type ListingMode = (typeof LISTING_MODES)[number];

const currencySchema = z
  .string()
  .regex(/^[A-Za-z]{3}$/, 'currency must be ISO-4217 alpha-3')
  .transform((value) => value.toUpperCase());

const priceMinorSchema = z.number().int().positive().max(Number.MAX_SAFE_INTEGER);

/**
 * Client-supplied listing payload. Amounts and timing are SERVER-VALIDATED —
 * clients can never smuggle an auction state (rule #10).
 */
export const createListingSchema = z.object({
  assetId: z.string().uuid(),
  mode: z.enum(LISTING_MODES).default('FIXED_PRICE'),
  priceMinor: priceMinorSchema.optional(),
  currency: currencySchema.optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().optional(),
});
export type CreateListingInput = z.output<typeof createListingSchema>;

export const updateListingBaseSchema = z.object({
  priceMinor: priceMinorSchema.optional(),
  currency: currencySchema.optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  expectedVersion: z.number().int().nonnegative(),
});

export const updateListingSchema = updateListingBaseSchema.refine(
  (value) =>
    value.priceMinor !== undefined ||
    value.currency !== undefined ||
    value.startsAt !== undefined ||
    value.endsAt !== undefined,
  { message: 'at least one field must be provided' },
);
export type UpdateListingInput = z.output<typeof updateListingSchema>;

const allowedTransitions: Record<ListingStatus, readonly ListingStatus[]> = {
  DRAFT: ['PENDING_REVIEW', 'WITHDRAWN'],
  PENDING_REVIEW: ['ACTIVE', 'DRAFT', 'WITHDRAWN'],
  ACTIVE: ['PAUSED', 'SOLD', 'WITHDRAWN', 'EXPIRED'],
  PAUSED: ['ACTIVE', 'WITHDRAWN'],
  SOLD: [],
  EXPIRED: ['ACTIVE', 'WITHDRAWN'],
  WITHDRAWN: [],
};

export class ListingTransitionError extends Error {
  constructor(
    public readonly from: ListingStatus,
    public readonly to: ListingStatus,
  ) {
    super(`Listing cannot transition from ${from} to ${to}`);
    this.name = 'ListingTransitionError';
  }
}

export function assertListingTransition(from: ListingStatus, to: ListingStatus): void {
  if (!allowedTransitions[from].includes(to)) {
    throw new ListingTransitionError(from, to);
  }
}

export function nextListingStatuses(from: ListingStatus): readonly ListingStatus[] {
  return allowedTransitions[from];
}

export function expiryFromPublishedAt(endsAt: Date | undefined, now = new Date()): boolean {
  return endsAt !== undefined && endsAt.getTime() <= now.getTime();
}
