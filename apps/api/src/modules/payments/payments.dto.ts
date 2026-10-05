import { z } from 'zod';

export const createPaymentIntentSchema = z.object({
  /// The listing the buyer is paying for. Amount/currency always come from
  /// server-side listing state — never from the client (rule #9).
  listingId: z.string().uuid(),
});
export type CreatePaymentIntentDto = z.output<typeof createPaymentIntentSchema>;

export const refundPaymentIntentSchema = z.object({
  /// Minor units to return; when omitted the full remaining balance is used.
  amountMinor: z.number().int().positive().optional(),
});
export type RefundPaymentIntentDto = z.output<typeof refundPaymentIntentSchema>;
