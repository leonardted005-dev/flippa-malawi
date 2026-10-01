import request from 'supertest';

import { bearerFromAuthBody, bootE2EApp, registerE2EUser, truncateE2E } from './e2e-helpers';

describe('Sellers (e2e)', () => {
  let app: Awaited<ReturnType<typeof bootE2EApp>>['app'];
  let prisma: Awaited<ReturnType<typeof bootE2EApp>>['prisma'];

  beforeAll(async () => {
    ({ app, prisma } = await bootE2EApp());
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
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  beforeEach(async () => {
    await truncateE2E(prisma);
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
  });

  it('creates a seller once and replays the same idempotency key', async () => {
    const server = app.getHttpServer();
    const { body } = await registerE2EUser(server, { email: 'seller@example.com' });
    const bearer = bearerFromAuthBody(body);
    const payload = { displayName: 'Zed Crafts', country: 'ZM' };

    const first = await request(server)
      .post('/api/v1/sellers')
      .set('Authorization', `Bearer ${bearer.accessToken}`)
      .set('Idempotency-Key', 'seller-key-1')
      .send(payload)
      .expect(201);
    expect(first.body).toMatchObject({ tierCode: 'FREE_CODER', country: 'ZM' });

    const replay = await request(server)
      .post('/api/v1/sellers')
      .set('Authorization', `Bearer ${bearer.accessToken}`)
      .set('Idempotency-Key', 'seller-key-1')
      .send(payload)
      .expect(201);
    expect(replay.body).toEqual(first.body);

    const withoutKey = await request(server)
      .post('/api/v1/sellers')
      .set('Authorization', `Bearer ${bearer.accessToken}`)
      .send(payload)
      .expect(409);
    expect(withoutKey.body).toMatchObject({ code: 'ALREADY_SELLER' });
  });

  it('exposes the configured tier policy and rejects concurrent writes', async () => {
    const server = app.getHttpServer();
    const { body } = await registerE2EUser(server, { email: 'policy@example.com' });
    const bearer = bearerFromAuthBody(body);

    await request(server)
      .post('/api/v1/sellers')
      .set('Authorization', `Bearer ${bearer.accessToken}`)
      .send({ displayName: 'Policy Works', country: 'ZM' })
      .expect(201);

    const policy = await request(server)
      .get('/api/v1/sellers/me/tier')
      .set('Authorization', `Bearer ${bearer.accessToken}`)
      .expect(200);
    expect(policy.body).toMatchObject({
      code: 'FREE_CODER',
      commissionBps: 1500,
      storageQuotaBytes: (50n * 1024n * 1024n).toString(),
    });

    const profile = await request(server)
      .get('/api/v1/sellers/me')
      .set('Authorization', `Bearer ${bearer.accessToken}`)
      .expect(200);

    await request(server)
      .patch('/api/v1/sellers/me')
      .set('Authorization', `Bearer ${bearer.accessToken}`)
      .send({ displayName: 'Policy Works 2', expectedVersion: profile.body['version'] })
      .expect(200);

    const stale = await request(server)
      .patch('/api/v1/sellers/me')
      .set('Authorization', `Bearer ${bearer.accessToken}`)
      .send({ displayName: 'Stale Write', expectedVersion: profile.body['version'] })
      .expect(409);
    expect(stale.body).toMatchObject({ code: 'VERSION_MISMATCH' });
  });
});
