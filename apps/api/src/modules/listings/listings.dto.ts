import { z } from 'zod';

import { createListingSchema, updateListingBaseSchema } from '@fa/domain';

const attachmentIds = z.array(z.string().uuid()).max(10);

export const apiCreateListingSchema = createListingSchema.extend({
  attachmentIds: attachmentIds.default([]),
});
export type ApiCreateListingDto = z.output<typeof apiCreateListingSchema>;

export const apiUpdateListingSchema = updateListingBaseSchema
  .extend({
    attachmentIds: attachmentIds.optional(),
  })
  .refine(
    (value) =>
      value.priceMinor !== undefined ||
      value.currency !== undefined ||
      value.startsAt !== undefined ||
      value.endsAt !== undefined ||
      value.attachmentIds !== undefined,
    { message: 'at least one field must be provided' },
  );
export type ApiUpdateListingDto = z.output<typeof apiUpdateListingSchema>;

export const rejectListingSchema = z.object({
  reason: z.string().min(3).max(500),
});
export type RejectListingDto = z.output<typeof rejectListingSchema>;
