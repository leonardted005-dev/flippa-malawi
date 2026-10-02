import request from 'supertest';

import {
  bearerFromAuthBody,
  bootE2EApp,
  createE2ESeller,
  createReadyAsset,
  ensureFreeTier,
  registerAdmin,
  registerE2EUser,
  truncateE2E,
} from './e2e-helpers';

describe('Listings (e2e)', () => {
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

  it('runs the full fixed-price lifecycle with admin review', async () => {
    const server = app.getHttpServer();

    const register = await registerE2EUser(server, { email: 'seller-listing@example.com' });
    const seller = bearerFromAuthBody(register.body);
    await createE2ESeller(server, seller.accessToken);
    const assetId = await createReadyAsset(server, seller.accessToken);

    const created = await request(server)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ assetId, mode: 'FIXED_PRICE', priceMinor: 250000, currency: 'ZMW' })
      .expect(201);
    expect(created.body).toMatchObject({
      status: 'DRAFT',
      mode: 'FIXED_PRICE',
      priceMinor: '250000',
      currency: 'ZMW',
    });
    const listingId = created.body['id'] as string;

    const submitted = await request(server)
      .post(`/api/v1/listings/${listingId}/submit`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(201);
    expect(submitted.body).toMatchObject({ status: 'PENDING_REVIEW' });

    const admin = await registerAdmin(server, prisma, 'reviewer@example.com');
    const approved = await request(server)
      .patch(`/api/v1/admin/listings/${listingId}/approve`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(approved.body).toMatchObject({ status: 'ACTIVE' });
    expect(typeof approved.body['publishedAt']).toBe('string');

    // A published listing is visible to other authenticated users.
    const reader = await registerE2EUser(server, { email: 'reader@example.com' });
    await request(server)
      .get(`/api/v1/listings/${listingId}`)
      .set('Authorization', `Bearer ${bearerFromAuthBody(reader.body).accessToken}`)
      .expect(200);

    const paused = await request(server)
      .post(`/api/v1/listings/${listingId}/pause`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(201);
    expect(paused.body).toMatchObject({ status: 'PAUSED' });

    const resumed = await request(server)
      .post(`/api/v1/listings/${listingId}/resume`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(201);
    expect(resumed.body).toMatchObject({ status: 'ACTIVE' });

    const withdrawn = await request(server)
      .post(`/api/v1/listings/${listingId}/withdraw`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(201);
    expect(withdrawn.body).toMatchObject({ status: 'WITHDRAWN' });

    // Terminal state: submission is rejected by the domain state machine.
    const illegal = await request(server)
      .post(`/api/v1/listings/${listingId}/submit`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(409);
    expect(illegal.body).toMatchObject({ code: 'INVALID_TRANSITION' });
  });

  it('enforces listing guards: asset readiness, currency, price, ownership', async () => {
    const server = app.getHttpServer();

    const register = await registerE2EUser(server, { email: 'guarded@example.com' });
    const seller = bearerFromAuthBody(register.body);
    await createE2ESeller(server, seller.accessToken);

    // Asset is still DRAFT (not READY) -> cannot be listed.
    const draftAsset = await request(server)
      .post('/api/v1/assets')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({
        type: 'SOFTWARE',
        title: 'Draft asset',
        country: 'ZM',
        currency: 'ZMW',
        metadata: { packageSizeBytes: 1024 },
      })
      .expect(201);
    const notReady = await request(server)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ assetId: draftAsset.body['id'], priceMinor: 100 })
      .expect(409);
    expect(notReady.body).toMatchObject({ code: 'ASSET_NOT_READY' });

    const assetId = await createReadyAsset(server, seller.accessToken);

    // Listing currency must match the asset currency (no mixing).
    const wrongCurrency = await request(server)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ assetId, priceMinor: 100, currency: 'USD' })
      .expect(400);
    expect(wrongCurrency.body).toMatchObject({ code: 'CURRENCY_MISMATCH' });

    // Create WITHOUT a price is allowed as a DRAFT, but cannot be submitted.
    const noPrice = await request(server)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ assetId })
      .expect(201);
    expect(noPrice.body['priceMinor']).toBeNull();

    const priceRequired = await request(server)
      .post(`/api/v1/listings/${noPrice.body['id']}/submit`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(400);
    expect(priceRequired.body).toMatchObject({ code: 'LISTING_PRICE_REQUIRED' });

    // The asset is now occupied -> a second listing is rejected.
    const duplicate = await request(server)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ assetId, priceMinor: 500 })
      .expect(409);
    expect(duplicate.body).toMatchObject({ code: 'ASSET_ALREADY_LISTED' });

    // IDOR: another user cannot see or mutate the DRAFT.
    const stranger = await registerE2EUser(server, { email: 'stranger@example.com' });
    const other = bearerFromAuthBody(stranger.body);
    await request(server)
      .get(`/api/v1/listings/${noPrice.body['id']}`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(404);
    await request(server)
      .post(`/api/v1/listings/${noPrice.body['id']}/withdraw`)
      .set('Authorization', `Bearer ${other.accessToken}`)
      .expect(404);

    // Admin rejection returns it to DRAFT with a mandatory reason.
    const admin = await registerAdmin(server, prisma, 'rejector@example.com');
    await request(server)
      .patch(`/api/v1/admin/listings/${noPrice.body['id']}/approve`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(409); // INVALID_TRANSITION: DRAFT cannot be approved directly

    const missingReason = await request(server)
      .patch(`/api/v1/admin/listings/${noPrice.body['id']}/reject`)
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .send({})
      .expect(400);
    expect(missingReason.body).toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
