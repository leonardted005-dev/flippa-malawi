import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, type AssetType } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../src/app.module';

/**
 * Tables truncated between e2e tests. `CASCADE` handles dependants, but keeping
 * the list explicit documents the blast radius of a test reset.
 */
export const e2eTables = [
  'idempotency_keys',
  'audit_logs',
  'asset_metadata_software',
  'asset_metadata_website',
  'asset_metadata_mobile',
  'asset_metadata_youtube',
  'asset_metadata_instagram',
  'asset_metadata_game',
  'asset_metadata_domain',
  'digital_assets',
  'categories',
  'social_snapshots',
  'payout_accounts',
  'seller_profiles',
  'seller_tiers',
  'verification_tokens',
  'refresh_tokens',
  'buyer_profiles',
  'users',
  'system_settings',
];

export async function truncateE2E(prisma: PrismaClient): Promise<void> {
  for (const table of e2eTables) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE "${table}" RESTART IDENTITY CASCADE`);
  }
}

export interface E2EBearer {
  accessToken: string;
  refreshToken: string;
}

export async function bootE2EApp(): Promise<{ app: INestApplication; prisma: PrismaClient }> {
  const prisma = new PrismaClient();
  await truncateE2E(prisma);

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();

  return { app, prisma };
}

export async function registerE2EUser(
  server: unknown,
  input: { email: string; password?: string; country?: string },
): Promise<{ status: number; body: Record<string, unknown> }> {
  const response = await request(server as never)
    .post('/api/v1/auth/register')
    .send({
      email: input.email,
      password: input.password ?? 'correct-horse-battery-staple-2',
      country: input.country ?? 'ZM',
    });

  return { status: response.status, body: response.body as Record<string, unknown> };
}

export function bearerFromAuthBody(body: Record<string, unknown>): E2EBearer {
  const tokens = body['tokens'] as { accessToken?: unknown; refreshToken?: unknown };
  if (typeof tokens?.accessToken !== 'string' || typeof tokens?.refreshToken !== 'string') {
    throw new Error('Auth response did not include bearer tokens');
  }
  return { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken };
}

export async function ensureFreeTier(prisma: PrismaClient): Promise<void> {
  await prisma.sellerTier.upsert({
    where: { code: 'FREE_CODER' },
    update: {},
    create: {
      code: 'FREE_CODER',
      name: 'Free Coder',
      storageQuotaBytes: 50n * 1024n * 1024n,
      maxUploadBytesPerFile: 50n * 1024n * 1024n,
      maxActiveListings: 3,
      commissionBps: 1500,
      qualityQueue: 'standard',
      verificationLevel: 'basic',
      features: {},
    },
  });
}

export async function createE2ESeller(
  server: unknown,
  token: string,
  input: { displayName?: string; country?: string } = {},
): Promise<Record<string, unknown>> {
  const response = await request(server as never)
    .post('/api/v1/sellers')
    .set('Authorization', `Bearer ${token}`)
    .send({ displayName: input.displayName ?? 'Zed Crafts', country: input.country ?? 'ZM' })
    .expect(201);
  return response.body as Record<string, unknown>;
}

export async function createE2ECategory(
  prisma: PrismaClient,
  input: { slug: string; name: string; assetTypes: AssetType[] },
): Promise<string> {
  const category = await prisma.category.create({
    data: { slug: input.slug, name: input.name, assetTypes: input.assetTypes, sort: 1 },
  });
  return category.id;
}
