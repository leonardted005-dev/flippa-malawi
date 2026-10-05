import { z } from 'zod';

/** Coerce "true"/"false" strings to booleans (z.coerce.boolean is unsafe here). */
const booleanish = z.preprocess(
  (v) => (typeof v === 'string' ? v.toLowerCase() === 'true' : v),
  z.boolean(),
);

export const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().positive().default(4000),
    WEB_PORT: z.coerce.number().int().positive().default(3000),
    API_BASE_URL: z.string().url().default('http://localhost:4000'),
    WEB_BASE_URL: z.string().url().default('http://localhost:3000'),

    DATABASE_URL: z.string().min(1),
    REDIS_URL: z.string().min(1),

    JWT_ACCESS_SECRET: z.string().min(16),
    JWT_ACCESS_TTL: z.coerce.number().int().positive().default(900),
    JWT_REFRESH_SECRET: z.string().min(16),
    JWT_REFRESH_TTL: z.coerce.number().int().positive().default(2592000),

    /// Base64 key material (>= 32 bytes decoded) for AES-256-GCM field encryption
    /// (e.g. payout account references). Never logged or returned to clients.
    FIELD_ENCRYPTION_KEY: z.string().min(32),

    STORAGE_DRIVER: z.enum(['s3']).default('s3'),
    STORAGE_ENDPOINT: z.string().min(1),
    STORAGE_REGION: z.string().default('auto'),
    STORAGE_BUCKET: z.string().min(1),
    STORAGE_ACCESS_KEY_ID: z.string().min(1),
    STORAGE_SECRET_ACCESS_KEY: z.string().min(1),
    STORAGE_FORCE_PATH_STYLE: booleanish.default(true),
    STORAGE_SIGNED_URL_TTL: z.coerce.number().int().positive().default(900),

    PAYMENTS_DEFAULT_PROVIDER: z.string().default('dpo'),
    /**
     * Enables the deterministic FAKE payment provider (dev/test ONLY).
     * It emits clearly-signed fake webhooks so the orchestrator can be exercised
     * end-to-end before the DPO merchant integration spec arrives. Never enabled
     * in production — enforced below.
     */
    PAYMENTS_FAKE_PROVIDER: booleanish.default(false),
    /// HMAC secret for FAKE-provider webhook signatures (>= 16 chars).
    PAYMENTS_WEBHOOK_SECRET: z.string().min(16).optional(),

    /// Absolute path to the Gitleaks binary (Phase 7). Empty = scanner disabled.
    SCANNERS_GITLEAKS_BIN: z.string().optional(),
    DPO_ENV: z.enum(['sandbox', 'production']).default('sandbox'),
    // DPO-specific credentials remain optional until the official merchant
    // integration specification is provided (audit rule #18 — do not invent fields).
    DPO_MERCHANT_ID: z.string().optional(),
    DPO_API_KEY: z.string().optional(),
    DPO_API_SECRET: z.string().optional(),
    DPO_WEBHOOK_SECRET: z.string().optional(),
  })
  .superRefine((env, ctx) => {
    if (env.PAYMENTS_FAKE_PROVIDER) {
      if (env.NODE_ENV === 'production') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PAYMENTS_FAKE_PROVIDER'],
          message: 'The fake payment provider must never be enabled in production',
        });
      }
      if (!env.PAYMENTS_WEBHOOK_SECRET) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PAYMENTS_WEBHOOK_SECRET'],
          message: 'PAYMENTS_WEBHOOK_SECRET is required when PAYMENTS_FAKE_PROVIDER=true',
        });
      }
    }
  });

export type AppEnv = z.infer<typeof envSchema>;

export function parseEnv(source: NodeJS.ProcessEnv = process.env): AppEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}
