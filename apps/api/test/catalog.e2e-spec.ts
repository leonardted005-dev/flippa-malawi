import request from 'supertest';

import {
  bearerFromAuthBody,
  bootE2EApp,
  createE2ECategory,
  createE2ESeller,
  ensureFreeTier,
  registerE2EUser,
  truncateE2E,
} from './e2e-helpers';

describe('Catalog (e2e)', () => {
  let app: Awaited<ReturnType<typeof bootE2EApp>>['app'];
  let prisma: Awaited<ReturnType<typeof bootE2EApp>>['prisma'];

  beforeAll(async () => {
    ({ app, prisma } = await bootE2EApp());
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateE2E(prisma);
    await ensureFreeTier(prisma);
  });

  it('exposes the asset-type registry with per-kind metric applicability', async () => {
    const server = app.getHttpServer();
    const res = await request(server).get('/api/v1/asset-types').expect(200);

    const types = res.body as Array<Record<string, unknown>>;
    expect(types).toHaveLength(8);

    const website = types.find((entry) => entry['type'] === 'WEBSITE');
    expect(website).toMatchObject({ ownershipVerification: 'DOMAIN', requiresManualReview: false });
    expect(website?.['metrics']).toEqual(['revenue', 'traffic', 'technology', 'age']);

    const other = types.find((entry) => entry['type'] === 'OTHER');
    expect(other).toMatchObject({ requiresManualReview: true });
    expect(other?.['metrics']).toEqual([]);
  });

  it('requires a seller profile before creating assets', async () => {
    const server = app.getHttpServer();
    const { body } = await registerE2EUser(server, { email: 'noseller@example.com' });
    const bearer = bearerFromAuthBody(body);

    const res = await request(server)
      .post('/api/v1/assets')
      .set('Authorization', `Bearer ${bearer.accessToken}`)
      .send({
        type: 'SOFTWARE',
        title: 'Ledger engine',
        country: 'ZM',
        currency: 'ZMW',
        metadata: { packageSizeBytes: 2048 },
      })
      .expect(409);
    expect(res.body).toMatchObject({ code: 'SELLER_PROFILE_REQUIRED' });
  });

  it('validates per-kind metadata and serialises bigint metrics safely', async () => {
    const server = app.getHttpServer();
    const { body } = await registerE2EUser(server, { email: 'maker@example.com' });
    const bearer = bearerFromAuthBody(body);
    await createE2ESeller(server, bearer.accessToken);

    const created = await request(server)
      .post('/api/v1/assets')
      .set('Authorization', `Bearer ${bearer.accessToken}`)
      .send({
        type: 'SOFTWARE',
        title: 'Payments SDK',
        country: 'zm',
        currency: 'zmw',
        metadata: { packageSizeBytes: 1048576, framework: 'NestJS' },
      })
      .expect(201);

    expect(created.body).toMatchObject({
      type: 'SOFTWARE',
      status: 'DRAFT',
      country: 'ZM',
      currency: 'ZMW',
      qualityStatus: 'PENDING',
      verificationStatus: 'UNVERIFIED',
    });
    expect(typeof created.body['slug']).toBe('string');
    // bigint columns must never be sent as raw JSON numbers
    expect(created.body['metadata']).toMatchObject({
      packageSizeBytes: '1048576',
      framework: 'NestJS',
      dependencyCount: 0,
    });

    // revenue without a currency is rejected, with a precise issue path
    const bad = await request(server)
      .post('/api/v1/assets')
      .set('Authorization', `Bearer ${bearer.accessToken}`)
      .send({
        type: 'WEBSITE',
        title: 'Traffic site',
        country: 'ZM',
        currency: 'ZMW',
        metadata: { domain: 'example.co.zm', monthlyRevenueMinor: 1000 },
      })
      .expect(400);
    expect(bad.body).toMatchObject({ code: 'ASSET_METADATA_INVALID' });
    expect(bad.body['problems']).toEqual([
      {
        path: 'revenueCurrency',
        message: 'revenueCurrency is required when a revenue amount is provided',
      },
    ]);
  });

  it('enforces category/type compatibility and ownership isolation', async () => {
    const server = app.getHttpServer();
    const ownerAuth = await registerE2EUser(server, { email: 'owner@example.com' });
    const owner = bearerFromAuthBody(ownerAuth.body);
    await createE2ESeller(server, owner.accessToken);

    const websiteCategoryId = await createE2ECategory(prisma, {
      slug: 'e2e-websites',
      name: 'E2E Websites',
      assetTypes: ['WEBSITE'],
    });

    const mismatch = await request(server)
      .post('/api/v1/assets')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        type: 'DOMAIN',
        title: 'brand.co.zm',
        country: 'ZM',
        currency: 'ZMW',
        categoryId: websiteCategoryId,
        metadata: { domainName: 'brand.co.zm' },
      })
      .expect(400);
    expect(mismatch.body).toMatchObject({ code: 'CATEGORY_TYPE_MISMATCH' });

    const created = await request(server)
      .post('/api/v1/assets')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({
        type: 'DOMAIN',
        title: 'brand.co.zm',
        country: 'ZM',
        currency: 'ZMW',
        metadata: { domainName: 'brand.co.zm', registrar: 'Example Registrar' },
      })
      .expect(201);
    const assetId = created.body['id'] as string;

    // A DRAFT is invisible to anyone else (no existence leak).
    const otherAuth = await registerE2EUser(server, { email: 'other@example.com' });
    const other = bearerFromAuthBody(otherAuth.body);
    await request(server)
      .get(`/api/v1/assets/${assetId}`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(404);

    await request(server)
      .get(`/api/v1/assets/${assetId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(200);

    // Malformed ids are a 400, never a 500.
    await request(server)
      .get('/api/v1/assets/not-a-uuid')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(400);

    // Publication makes it readable, and stale writes are rejected.
    const ready = await request(server)
      .post(`/api/v1/assets/${assetId}/ready`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(201);
    expect(ready.body).toMatchObject({ status: 'READY' });

    await request(server)
      .get(`/api/v1/assets/${assetId}`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(200);

    const stale = await request(server)
      .patch(`/api/v1/assets/${assetId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ title: 'Renamed domain', expectedVersion: 0 })
      .expect(409);
    expect(stale.body).toMatchObject({ code: 'VERSION_MISMATCH' });

    const renamed = await request(server)
      .patch(`/api/v1/assets/${assetId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ title: 'Renamed domain', expectedVersion: ready.body['version'] })
      .expect(200);
    expect(renamed.body).toMatchObject({ title: 'Renamed domain' });

    const archived = await request(server)
      .post(`/api/v1/assets/${assetId}/archive`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .expect(201);
    expect(archived.body).toMatchObject({ status: 'ARCHIVED' });

    const modifyArchived = await request(server)
      .patch(`/api/v1/assets/${assetId}`)
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ title: 'Too late', expectedVersion: archived.body['version'] })
      .expect(409);
    expect(modifyArchived.body).toMatchObject({ code: 'ASSET_ARCHIVED' });
  });
});
