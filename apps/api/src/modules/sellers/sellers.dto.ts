import { z } from 'zod';

const countrySchema = z
  .string()
  .regex(/^[A-Za-z]{2}$/, 'country must be ISO-3166 alpha-2')
  .transform((value) => value.toUpperCase());

const currencySchema = z
  .string()
  .regex(/^[A-Za-z]{3}$/, 'currency must be ISO-4217 alpha-3')
  .transform((value) => value.toUpperCase());

export const createSellerSchema = z.object({
  displayName: z.string().min(2).max(80),
  country: countrySchema,
  payoutCurrency: currencySchema.optional(),
});
export type CreateSellerDto = z.output<typeof createSellerSchema>;

export const updateSellerSchema = z
  .object({
    displayName: z.string().min(2).max(80).optional(),
    country: countrySchema.optional(),
    payoutCurrency: currencySchema.optional(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .refine(
    (value) =>
      value.displayName !== undefined ||
      value.country !== undefined ||
      value.payoutCurrency !== undefined,
    { message: 'at least one field must be provided' },
  );
export type UpdateSellerDto = z.output<typeof updateSellerSchema>;

export const createPayoutAccountSchema = z.object({
  provider: z.string().min(2).max(40),
  accountRef: z.string().min(4).max(120),
  country: countrySchema,
  currency: currencySchema,
});
export type CreatePayoutAccountDto = z.output<typeof createPayoutAccountSchema>;

export const changeTierSchema = z.object({
  tierCode: z.string().min(1).max(40),
});
export type ChangeTierDto = z.output<typeof changeTierSchema>;
