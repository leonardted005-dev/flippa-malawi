import { z } from 'zod';

export const placeBidSchema = z.object({
  amountMinor: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
});
export type PlaceBidDto = z.output<typeof placeBidSchema>;
