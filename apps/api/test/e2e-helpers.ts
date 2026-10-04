import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { PrismaClient, type AssetType } from '@prisma/client';
import request from 'supertest';

import { AppModule } from '../src/app.module';
import { DNS_EVIDENCE_READER, HTTP_EVIDENCE_READER } from '../src/common/tokens';
import { StubEvidenceReaders } from '../src/integrations/evidence/stub-evidence-readers';

/**
 * Tables truncated between e2e tests. `CASCADE` handles dependants, but keeping
 * the list explicit documents the blast radius of a test reset.
 */
export const e2eTables = [
  'idempotency_keys',
  'audit_logs',
  'kyc_answers',
  'ownership_challenges',
  'verification_cases',
  'quality_reports',
  'security_findings',
  'scanner_runs',
  'quality_policies',
  'bids',
  'offers',
  'auctions',
  'watchlist_items',
  'watchlists',
  'asset_metadata_software',
  'asset_metadata_website',
  'asset_metadata_mobile',
  'asset_metadata_youtube',
  'asset_metadata_instagram',
  'asset_metadata_game',
  'asset_metadata_domain',
  'listing_attachments',
  'listings',
  'storage_objects',
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

export interface BootE2EOptions {
  /**
   * When provided, the live DNS/HTTP evidence readers are replaced with this
   * deterministic stub — verification tests publish fake TXT/well-known data
   * without touching real DNS or the internet.
   */
  evidence?: StubEvidenceReaders;
}

export async function bootE2EApp(options: BootE2EOptions = {}): Promise<{
  app: INestApplication;
  prisma: PrismaClient;
  evidence?: StubEvidenceReaders;
}> {
  const prisma = new PrismaClient();
  await truncateE2E(prisma);

  const builder = Test.createTestingModule({ imports: [AppModule] });
  if (options.evidence) {
    builder
      .overrideProvider(DNS_EVIDENCE_READER)
      .useValue(options.evidence)
      .overrideProvider(HTTP_EVIDENCE_READER)
      .useValue(options.evidence);
  }
  const moduleRef = await builder.compile();
  const app = moduleRef.createNestApplication();
  app.setGlobalPrefix('api/v1');
  await app.init();

  return { app, prisma, evidence: options.evidence };
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

/** The active quality policy is configuration (Phase 7) — re-seeded each test. */
export async function ensureQualityPolicy(prisma: PrismaClient): Promise<void> {
  await prisma.qualityPolicy.upsert({
    where: { version: 1 },
    update: { isActive: true },
    create: {
      version: 1,
      name: 'Default marketplace quality policy',
      rules: {
        failOn: ['CRITICAL', 'HIGH'],
        reviewOn: ['MEDIUM'],
        failCategories: [],
        reviewCategories: ['secret', 'malware'],
      },
      isActive: true,
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

/** Creates a seller profile for the given bearer token. */
export async function prepareSeller(server: unknown, token: string): Promise<void> {
  await createE2ESeller(server, token);
}

/** Creates an asset and publishes it (status READY). */
export async function createReadyAsset(
  server: unknown,
  token: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const created = await request(server as never)
    .post('/api/v1/assets')
    .set('Authorization', `Bearer ${token}`)
    .send({
      type: 'SOFTWARE',
      title: 'E2E test asset',
      country: 'ZM',
      currency: 'ZMW',
      metadata: { packageSizeBytes: 2048, framework: 'NestJS' },
      ...overrides,
    })
    .expect(201);

  const id = (created.body as Record<string, unknown>)['id'] as string;
  await request(server as never)
    .post(`/api/v1/assets/${id}/ready`)
    .set('Authorization', `Bearer ${token}`)
    .expect(201);

  return id;
}

/**
 * Opens an AUCTION-mode listing: create (with endsAt) -> submit -> admin approve.
 * Returns the derived auction id once the listing is ACTIVE.
 */
export async function publishAuction(
  server: unknown,
  sellerToken: string,
  adminToken: string,
  assetId: string,
  overrides: Record<string, unknown> = {},
): Promise<{ listingId: string; auctionId: string }> {
  const endsAt = overrides['endsAt'] ?? new Date(Date.now() + 60 * 60 * 1000).toISOString();
  const listingId = await publishListing(server, sellerToken, adminToken, assetId, {
    mode: 'AUCTION',
    endsAt,
    priceMinor: overrides['priceMinor'] ?? 50_000,
    ...overrides,
  });

  // Approving an AUCTION listing materialises the auction; the seller's own
  // listing view exposes it.
  const listing = await request(server as never)
    .get(`/api/v1/listings/${listingId}`)
    .set('Authorization', `Bearer ${sellerToken}`)
    .expect(200);

  const auction = (listing.body as Record<string, unknown>)['auction'] as
    { id?: string } | null | undefined;

  if (!auction?.id) {
    throw new Error('Auction was not materialised for the approved auction listing');
  }
  return { listingId, auctionId: auction.id };
}

/** Registers a user, promotes them to ADMIN out-of-band, then logs in again. */
export async function registerAdmin(
  server: unknown,
  prisma: PrismaClient,
  email: string,
): Promise<E2EBearer> {
  const registered = await registerE2EUser(server, { email });
  await prisma.user.update({
    where: { email },
    data: { roles: { push: 'ADMIN' } },
  });

  const login = await request(server as never)
    .post('/api/v1/auth/login')
    .send({ email, password: 'correct-horse-battery-staple-2' })
    .expect(200);

  return bearerFromAuthBody(login.body as Record<string, unknown>);
}

/**
 * Creates a listing for an asset, submits it, and has an admin approve it —
 * i.e. drives it to ACTIVE so it appears in public discovery.
 */
export async function publishListing(
  server: unknown,
  sellerToken: string,
  adminToken: string,
  assetId: string,
  overrides: Record<string, unknown> = {},
): Promise<string> {
  const created = await request(server as never)
    .post('/api/v1/listings')
    .set('Authorization', `Bearer ${sellerToken}`)
    .send({ assetId, priceMinor: 100_000, currency: 'ZMW', ...overrides })
    .expect(201);
  const listingId = (created.body as Record<string, unknown>)['id'] as string;

  await request(server as never)
    .post(`/api/v1/listings/${listingId}/submit`)
    .set('Authorization', `Bearer ${sellerToken}`)
    .expect(201);

  await request(server as never)
    .patch(`/api/v1/admin/listings/${listingId}/approve`)
    .set('Authorization', `Bearer ${adminToken}`)
    .expect(200);

  return listingId;
}
