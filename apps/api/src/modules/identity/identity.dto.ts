import { z } from 'zod';

const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .email('a valid email address is required')
  .max(254);

const countrySchema = z
  .string()
  .regex(/^[A-Za-z]{2}$/, 'country must be ISO-3166 alpha-2')
  .transform((value) => value.toUpperCase());

const currencySchema = z
  .string()
  .regex(/^[A-Za-z]{3}$/, 'currency must be ISO-4217 alpha-3')
  .transform((value) => value.toUpperCase());

const passwordSchema = z.string().min(12, 'password must be at least 12 characters').max(200);

export const registerSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  displayName: z.string().min(2).max(80).optional(),
  country: countrySchema.optional(),
  currency: currencySchema.optional(),
});
export type RegisterDto = z.output<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(200),
});
export type LoginDto = z.output<typeof loginSchema>;

export const refreshSchema = z.object({
  refreshToken: z.string().min(20).max(4096),
});
export type RefreshDto = z.output<typeof refreshSchema>;

export const emailRequestSchema = z.object({ email: emailSchema });
export type EmailRequestDto = z.output<typeof emailRequestSchema>;

export const tokenConfirmSchema = z.object({ token: z.string().min(10).max(200) });
export type TokenConfirmDto = z.output<typeof tokenConfirmSchema>;

export const resetPasswordSchema = z.object({
  token: z.string().min(10).max(200),
  password: passwordSchema,
});
export type ResetPasswordDto = z.output<typeof resetPasswordSchema>;
