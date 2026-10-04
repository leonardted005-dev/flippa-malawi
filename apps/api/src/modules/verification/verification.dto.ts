import { z } from 'zod';

const verificationMethodSchema = z.enum([
  'DNS_TXT',
  'HTTP_TOKEN',
  'SOCIAL_PROOF',
  'STORE_PROOF',
  'MANUAL',
]);

export const openVerificationCaseSchema = z.object({
  /** Required for ASSET cases; forbidden for SELLER cases. */
  assetId: z.string().uuid().optional(),
  targetType: z.enum(['ASSET', 'SELLER']).default('ASSET'),
  method: verificationMethodSchema,
});
export type OpenVerificationCaseDto = z.output<typeof openVerificationCaseSchema>;

export const submitKycSchema = z.object({
  answers: z
    .array(
      z.object({
        question: z.string().min(2).max(200),
        answer: z.string().min(1).max(2000),
        /** Private StorageObject id holding a document image (optional). */
        evidenceObjectId: z.string().uuid().optional(),
      }),
    )
    .min(1)
    .max(20),
  expectedVersion: z.number().int().nonnegative(),
});
export type SubmitKycDto = z.output<typeof submitKycSchema>;

export const decideVerificationCaseSchema = z.object({
  decision: z.enum(['APPROVED', 'REJECTED']),
  note: z.string().max(2000).optional(),
  expectedVersion: z.number().int().nonnegative(),
});
export type DecideVerificationCaseDto = z.output<typeof decideVerificationCaseSchema>;
