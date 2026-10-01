import { z } from 'zod';

import { ASSET_TYPES, type AssetType } from '@fa/domain';

const countrySchema = z
  .string()
  .regex(/^[A-Za-z]{2}$/, 'country must be ISO-3166 alpha-2')
  .transform((value) => value.toUpperCase());

const currencySchema = z
  .string()
  .regex(/^[A-Za-z]{3}$/, 'currency must be ISO-4217 alpha-3')
  .transform((value) => value.toUpperCase());

const assetTypeSchema = z.enum(ASSET_TYPES as unknown as [AssetType, ...AssetType[]]);

/**
 * The type-specific `metadata` payload is validated against the domain
 * registry schema for `type` inside the service (not here), because it depends
 * on the sibling discriminator field.
 */
export const createAssetSchema = z.object({
  type: assetTypeSchema,
  title: z.string().min(3).max(200),
  summary: z.string().max(1000).optional(),
  country: countrySchema,
  currency: currencySchema,
  categoryId: z.string().uuid().optional(),
  metadata: z.record(z.unknown()),
});
export type CreateAssetDto = z.output<typeof createAssetSchema>;

export const updateAssetSchema = z
  .object({
    title: z.string().min(3).max(200).optional(),
    summary: z.string().max(1000).nullable().optional(),
    currency: currencySchema.optional(),
    categoryId: z.string().uuid().nullable().optional(),
    metadata: z.record(z.unknown()).optional(),
    expectedVersion: z.number().int().nonnegative(),
  })
  .refine(
    (value) =>
      value.title !== undefined ||
      value.summary !== undefined ||
      value.currency !== undefined ||
      value.categoryId !== undefined ||
      value.metadata !== undefined,
    { message: 'at least one field must be provided' },
  );
export type UpdateAssetDto = z.output<typeof updateAssetSchema>;
