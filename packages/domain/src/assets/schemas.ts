import { z } from 'zod';

/**
 * Per-kind metadata schemas — the client-facing shape ONLY.
 *
 * Fields produced by the platform (scanner findings, ownership/analytics
 * verification, retained provider snapshots) are deliberately absent here:
 * clients can never set them.
 */

const currencySchema = z
  .string()
  .regex(/^[A-Za-z]{3}$/, 'currency must be ISO-4217 alpha-3')
  .transform((value) => value.toUpperCase());

const hostnamePattern = /^(?=.{3,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,}$/i;

const domainSchema = z.string().max(253).regex(hostnamePattern, 'must be a valid hostname');

const nonNegativeInt = z.number().int().nonnegative();

export const softwareMetadataSchema = z.object({
  language: z.string().min(1).max(60).optional(),
  framework: z.string().min(1).max(100).optional(),
  runtime: z.string().min(1).max(100).optional(),
  sourceRepo: z.string().url().max(2048).optional(),
  packageSizeBytes: z.number().int().positive(),
  dependencyCount: nonNegativeInt.default(0),
  licenseSpdx: z.string().min(1).max(60).optional(),
});
export type SoftwareMetadataInput = z.output<typeof softwareMetadataSchema>;

export const websiteMetadataSchema = z
  .object({
    domain: domainSchema,
    monthlyTraffic: nonNegativeInt.optional(),
    technology: z.array(z.string().min(1).max(60)).max(50).default([]),
    hosting: z.string().min(1).max(120).optional(),
    monthlyRevenueMinor: nonNegativeInt.optional(),
    revenueCurrency: currencySchema.optional(),
    analyticsProvider: z.string().min(1).max(60).optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.monthlyRevenueMinor ?? 0) > 0 && value.revenueCurrency === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['revenueCurrency'],
        message: 'revenueCurrency is required when a revenue amount is provided',
      });
    }
  });
export type WebsiteMetadataInput = z.output<typeof websiteMetadataSchema>;

export const mobileAppMetadataSchema = z
  .object({
    platforms: z
      .array(z.enum(['IOS', 'ANDROID', 'WEB']))
      .min(1)
      .max(3),
    bundleId: z.string().min(3).max(200).optional(),
    storeLinks: z.array(z.string().url().max(2048)).max(5).default([]),
    installs: nonNegativeInt.optional(),
    monthlyRevenueMinor: nonNegativeInt.optional(),
    revenueCurrency: currencySchema.optional(),
    appVersion: z.string().min(1).max(40).optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.monthlyRevenueMinor ?? 0) > 0 && value.revenueCurrency === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['revenueCurrency'],
        message: 'revenueCurrency is required when a revenue amount is provided',
      });
    }
  });
export type MobileAppMetadataInput = z.output<typeof mobileAppMetadataSchema>;

export const youtubeMetadataSchema = z
  .object({
    channelId: z.string().min(3).max(120),
    subscribers: nonNegativeInt.optional(),
    totalViews: nonNegativeInt.optional(),
    videoCount: nonNegativeInt.optional(),
    channelAgeDays: nonNegativeInt.optional(),
    monetized: z.boolean().default(false),
    monthlyRevenueMinor: nonNegativeInt.optional(),
    revenueCurrency: currencySchema.optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.monthlyRevenueMinor ?? 0) > 0 && value.revenueCurrency === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['revenueCurrency'],
        message: 'revenueCurrency is required when a revenue amount is provided',
      });
    }
  });
export type YouTubeMetadataInput = z.output<typeof youtubeMetadataSchema>;

export const instagramMetadataSchema = z.object({
  accountId: z.string().min(2).max(120),
  followers: nonNegativeInt.optional(),
  engagementBps: z.number().int().min(0).max(10_000).optional(),
  mediaCount: nonNegativeInt.optional(),
  accountAgeDays: nonNegativeInt.optional(),
});
export type InstagramMetadataInput = z.output<typeof instagramMetadataSchema>;

export const gameAccountMetadataSchema = z.object({
  game: z.string().min(2).max(120),
  platform: z.string().min(2).max(60),
  accountRef: z.string().min(2).max(200),
  levelRank: z.string().min(1).max(120).optional(),
  inventory: z.array(z.string().min(1).max(120)).max(200).default([]),
  banState: z.enum(['CLEAR', 'WARNING', 'BANNED', 'UNKNOWN']).default('CLEAR'),
  transferable: z.boolean().default(true),
});
export type GameAccountMetadataInput = z.output<typeof gameAccountMetadataSchema>;

export const domainMetadataSchema = z.object({
  domainName: domainSchema,
  registrar: z.string().min(2).max(120).optional(),
  expiresAt: z.string().datetime().optional(),
  transferLocked: z.boolean().default(false),
  dns: z.array(z.string().min(1).max(200)).max(100).default([]),
});
export type DomainMetadataInput = z.output<typeof domainMetadataSchema>;

/** Free-form assets always require a human-readable description + manual review. */
export const otherMetadataSchema = z.object({
  description: z.string().min(10).max(5000),
});
export type OtherMetadataInput = z.output<typeof otherMetadataSchema>;
