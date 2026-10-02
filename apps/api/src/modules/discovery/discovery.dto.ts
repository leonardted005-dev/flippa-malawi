import { z } from 'zod';

import { ASSET_TYPES } from '@fa/domain';

const assetType = z.enum(
  ASSET_TYPES as unknown as [(typeof ASSET_TYPES)[number], ...(typeof ASSET_TYPES)[number][]],
);

const upper = (length: number, pattern: RegExp, message: string) =>
  z
    .string()
    .regex(pattern, message)
    .transform((value) => value.toUpperCase());

/**
 * Marketplace browse query. Everything is validated and coerced server-side —
 * clients can only ask questions, never inject them (params become Prisma
 * filters, never raw SQL).
 */
export const discoveryQuerySchema = z.object({
  assetType: assetType.optional(),
  categorySlug: z.string().min(1).max(80).optional(),
  country: upper(2, /^[A-Za-z]{2}$/, 'country must be ISO-3166 alpha-2').optional(),
  currency: upper(3, /^[A-Za-z]{3}$/, 'currency must be ISO-4217 alpha-3').optional(),
  mode: z.enum(['FIXED_PRICE', 'AUCTION']).optional(),
  q: z.string().trim().max(120).optional(),
  minPriceMinor: z.coerce.number().int().nonnegative().optional(),
  maxPriceMinor: z.coerce.number().int().nonnegative().optional(),
  verificationStatus: z.enum(['UNVERIFIED', 'IN_REVIEW', 'VERIFIED', 'REJECTED']).optional(),
  qualityStatus: z.enum(['PENDING', 'PASS', 'REVIEW', 'FAIL']).optional(),
  featured: z
    .enum(['true', 'false'])
    .optional()
    .transform((value) => (value === undefined ? undefined : value === 'true')),
  /** Return only listings ending within this many hours (e.g. `endingSoonHours=24`). */
  endingSoonHours: z.coerce
    .number()
    .int()
    .positive()
    .max(24 * 365)
    .optional(),
  sort: z.enum(['newest', 'ending_soon', 'price_asc', 'price_desc']).default('newest'),
  cursor: z.string().uuid().optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
});

export type DiscoveryQueryDto = z.output<typeof discoveryQuerySchema>;
