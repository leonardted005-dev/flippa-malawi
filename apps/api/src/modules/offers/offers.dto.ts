import { z } from 'zod';

export const createOfferSchema = z.object({
  listingId: z.string().uuid(),
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  expiresAt: z.string().datetime().optional(),
});
export type CreateOfferDto = z.output<typeof createOfferSchema>;

export const rejectOfferSchema = z.object({
  reason: z.string().min(1).max(500).optional(),
});
export type RejectOfferDto = z.output<typeof rejectOfferSchema>;
