import request from 'supertest';

import {
  bearerFromAuthBody,
  bootE2EApp,
  createE2ESeller,
  createReadyAsset,
  ensureFreeTier,
  publishListing,
  registerAdmin,
  registerE2EUser,
  truncateE2E,
} from './e2e-helpers';

describe('Offers (e2e)', () => {
  let app: Awaited<ReturnType<typeof bootE2EApp>>['app'];
  let prisma: Awaited<ReturnType<typeof bootE2EApp>>['prisma'];

  let sellerToken: string;
  let buyerToken: string;
  let otherBuyerToken: string;
  let adminToken: string;
  let listingId: string;

  beforeEach(async () => {
    ({ app, prisma } = await bootE2EApp());
    await truncateE2E(prisma);
    await ensureFreeTier(prisma);

    const server = app.getHttpServer();
    sellerToken = bearerFromAuthBody(
      (await registerE2EUser(server, { email: 'offer-seller@example.com' })).body,
    ).accessToken;
    await createE2ESeller(server, sellerToken);

    buyerToken = bearerFromAuthBody(
      (await registerE2EUser(server, { email: 'offer-buyer@example.com' })).body,
    ).accessToken;
    otherBuyerToken = bearerFromAuthBody(
      (await registerE2EUser(server, { email: 'offer-buyer-2@example.com' })).body,
    ).accessToken;
    adminToken = (await registerAdmin(server, prisma, 'offer-admin@example.com')).accessToken;

    const assetId = await createReadyAsset(server, sellerToken, { title: 'Offerable asset' });
    listingId = await publishListing(server, sellerToken, adminToken, assetId, {
      priceMinor: 500_000,
    });
  });

  afterEach(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('places an offer below the ask and rejects invalid offers', async () => {
    const server = app.getHttpServer();

    const created = await request(server)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId, amountMinor: 400_000 })
      .expect(201);
    expect(created.body).toMatchObject({
      status: 'PLACED',
      amountMinor: '400000',
      currency: 'ZMW',
    });

    const selfOffer = await request(server)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ listingId, amountMinor: 300_000 })
      .expect(403);
    expect(selfOffer.body).toMatchObject({ code: 'SELLER_CANNOT_OFFER' });

    const duplicate = await request(server)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId, amountMinor: 450_000 })
      .expect(409);
    expect(duplicate.body).toMatchObject({ code: 'OFFER_ALREADY_EXISTS' });

    const atAsk = await request(server)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${otherBuyerToken}`)
      .send({ listingId, amountMinor: 500_000 })
      .expect(400);
    expect(atAsk.body).toMatchObject({ code: 'OFFER_MUST_BE_BELOW_ASK' });

    await request(server).post('/api/v1/offers').send({ listingId, amountMinor: 1 }).expect(401);
  });

  it('lets a buyer withdraw their own offer but not someone else’s', async () => {
    const server = app.getHttpServer();

    const created = await request(server)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId, amountMinor: 250_000 })
      .expect(201);
    const offerId = created.body['id'] as string;

    await request(server)
      .post(`/api/v1/offers/${offerId}/withdraw`)
      .set('Authorization', `Bearer ${otherBuyerToken}`)
      .expect(404);

    const withdrawn = await request(server)
      .post(`/api/v1/offers/${offerId}/withdraw`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(201);
    expect(withdrawn.body).toMatchObject({ status: 'WITHDRAWN' });

    // Once withdrawn the buyer may offer again.
    await request(server)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId, amountMinor: 260_000 })
      .expect(201);
  });

  it('accepting an offer sells the listing, lapses rivals and blocks re-decision', async () => {
    const server = app.getHttpServer();

    const winner = await request(server)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId, amountMinor: 480_000 })
      .expect(201);
    const winnerId = winner.body['id'] as string;

    await request(server)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${otherBuyerToken}`)
      .send({ listingId, amountMinor: 300_000 })
      .expect(201);

    // A non-seller cannot accept.
    await request(server)
      .post(`/api/v1/offers/${winnerId}/accept`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(404);

    const accepted = await request(server)
      .post(`/api/v1/offers/${winnerId}/accept`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(201);
    expect(accepted.body).toMatchObject({ status: 'ACCEPTED' });

    const listing = await prisma.listing.findUniqueOrThrow({ where: { id: listingId } });
    expect(listing.status).toBe('SOLD');

    // The rival offer lapsed rather than staying pending.
    const all = await prisma.offer.findMany({ where: { listingId } });
    expect(all.filter((offer) => offer.status === 'PLACED')).toHaveLength(0);

    const redeciede = await request(server)
      .post(`/api/v1/offers/${winnerId}/accept`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(409);
    expect(redeciede.body).toMatchObject({ code: 'OFFER_NOT_DECIDED' });
  });

  it('supports rejecting with a reason and exposes buyer/seller views', async () => {
    const server = app.getHttpServer();

    const created = await request(server)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId, amountMinor: 120_000 })
      .expect(201);
    const offerId = created.body['id'] as string;

    const rejected = await request(server)
      .post(`/api/v1/offers/${offerId}/reject`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ reason: 'Price too low for this asset' })
      .expect(201);
    expect(rejected.body).toMatchObject({
      status: 'REJECTED',
      decisionReason: 'Price too low for this asset',
    });

    const mine = await request(server)
      .get('/api/v1/offers/mine')
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(200);
    expect((mine.body as Array<{ id: string }>).map((offer) => offer.id)).toContain(offerId);

    const received = await request(server)
      .get('/api/v1/offers/received')
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    expect((received.body as Array<{ id: string }>).map((offer) => offer.id)).toContain(offerId);
  });

  it('rejects offers on auction listings', async () => {
    const server = app.getHttpServer();

    const auctionAsset = await createReadyAsset(server, sellerToken, { title: 'Auction only' });
    const created = await request(server)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        assetId: auctionAsset,
        mode: 'AUCTION',
        endsAt: new Date(Date.now() + 3600_000).toISOString(),
        priceMinor: 10_000,
      })
      .expect(201);
    await request(server)
      .post(`/api/v1/listings/${created.body['id']}/submit`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(201);
    await request(server)
      .patch(`/api/v1/admin/listings/${created.body['id']}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const res = await request(server)
      .post('/api/v1/offers')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: created.body['id'], amountMinor: 5_000 })
      .expect(409);
    expect(res.body).toMatchObject({ code: 'OFFER_NOT_ALLOWED' });
  });
});
