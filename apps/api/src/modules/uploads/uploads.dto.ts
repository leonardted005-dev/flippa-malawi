import { z } from 'zod';

export const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] as const;

export const presignUploadSchema = z.object({
  contentType: z.enum(ALLOWED_IMAGE_TYPES),
  sizeBytes: z.number().int().positive(),
});
export type PresignUploadDto = z.output<typeof presignUploadSchema>;
