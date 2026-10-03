import request from 'supertest';

import {
  bearerFromAuthBody,
  bootE2EApp,
  createE2ESeller,
  createReadyAsset,
  ensureFreeTier,
  publishAuction,
  registerAdmin,
  registerE2EUser,
} from './e2e-helpers';

describe('Auctions & bids (e2e)', () => {
  let app: Awaited<ReturnType<typeof bootE2EApp>>['app'];
  let prisma: Awaited<ReturnType<typeof bootE2EApp>>['prisma'];

  let sellerToken: string;
  let bidderAToken: string;
  let bidderBToken: string;
  let adminToken: string;
  let auctionId: string;
  let listingId: string;
  let reserveAuctionId: string;

  beforeAll(async () => {
    ({ app, prisma } = await bootE2EApp());
    await ensureFreeTier(prisma);
    const server = app.getHttpServer();

    const sellerReg = await registerE2EUser(server, { email: 'auction-seller@example.com' });
    sellerToken = bearerFromAuthBody(sellerReg.body).accessToken;
    await createE2ESeller(server, sellerToken);

    bidderAToken = bearerFromAuthBody(
      (await registerE2EUser(server, { email: 'bidder-a@example.com' })).body,
    ).accessToken;
    bidderBToken = bearerFromAuthBody(
      (await registerE2EUser(server, { email: 'bidder-b@example.com' })).body,
    ).accessToken;
    adminToken = (await registerAdmin(server, prisma, 'auction-admin@example.com')).accessToken;

    const assetId = await createReadyAsset(server, sellerToken, { title: 'Auction asset' });
    ({ listingId, auctionId } = await publishAuction(server, sellerToken, adminToken, assetId, {
      priceMinor: 100_000, // reserve = asking price
    }));

    // A second auction with NO reserve (priceMinor omitted).
    const noReserveAsset = await createReadyAsset(server, sellerToken, {
      title: 'No reserve asset',
    });
    const created = await request(server)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        assetId: noReserveAsset,
        mode: 'AUCTION',
        endsAt: new Date(Date.now() + 3600_000).toISOString(),
      })
      .expect(201);
    const noReserveListingId = created.body['id'] as string;
    await request(server)
      .post(`/api/v1/listings/${noReserveListingId}/submit`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(201);
    await request(server)
      .patch(`/api/v1/admin/listings/${noReserveListingId}/approve`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const view = await request(server)
      .get(`/api/v1/listings/${noReserveListingId}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    reserveAuctionId = ((view.body as Record<string, unknown>)['auction'] as { id: string }).id;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('materialises exactly one auction when an auction listing is approved', async () => {
    const auctions = await prisma.auction.findMany({ where: { listingId } });
    expect(auctions).toHaveLength(1);
    expect(auctions[0]!.status).toBe('LIVE');
    expect(auctions[0]!.currentBidMinor).toBeNull();
    expect(auctions[0]!.bidCount).toBe(0);
  });

  it('enforces bid rules: opening bid, increment, self-bid', async () => {
    const server = app.getHttpServer();

    const opening = await request(server)
      .post(`/api/v1/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${bidderAToken}`)
      .send({ amountMinor: 100_000 })
      .expect(201);
    expect(opening.body).toMatchObject({ amountMinor: '100000', currency: 'ZMW', bidder: 'you' });

    // 5% of 100000 = 5000 -> 104_000 is below the required 105_000.
    const tooLow = await request(server)
      .post(`/api/v1/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${bidderBToken}`)
      .send({ amountMinor: 104_000 })
      .expect(400);
    expect(tooLow.body).toMatchObject({ code: 'BID_TOO_LOW' });

    const selfBid = await request(server)
      .post(`/api/v1/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ amountMinor: 200_000 })
      .expect(403);
    expect(selfBid.body).toMatchObject({ code: 'SELF_BID' });

    const accepted = await request(server)
      .post(`/api/v1/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${bidderBToken}`)
      .send({ amountMinor: 105_000 })
      .expect(201);
    expect(accepted.body).toMatchObject({ amountMinor: '105000' });

    const state = await prisma.auction.findUnique({ where: { id: auctionId } });
    expect(state?.currentBidMinor).toBe(105_000n);
    expect(state?.bidCount).toBe(2);

    const bids = await request(server)
      .get(`/api/v1/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${bidderAToken}`)
      .expect(200);
    const list = bids.body as Array<Record<string, unknown>>;
    expect(list).toHaveLength(2);
    expect(list[0]!['amountMinor']).toBe('105000');
    expect(list[1]!['status']).toBe('OUTBID');
    // bidder pseudonyms never leak raw account ids
    expect(list.some((bid) => String(bid['bidder']).includes('@'))).toBe(false);
  });

  it('replays the same Idempotency-Key without creating a second bid', async () => {
    const server = app.getHttpServer();

    const first = await request(server)
      .post(`/api/v1/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${bidderAToken}`)
      .set('Idempotency-Key', 'bid-replay-1')
      .send({ amountMinor: 120_000 })
      .expect(201);

    const replay = await request(server)
      .post(`/api/v1/auctions/${auctionId}/bids`)
      .set('Authorization', `Bearer ${bidderAToken}`)
      .set('Idempotency-Key', 'bid-replay-1')
      .send({ amountMinor: 120_000 })
      .expect(201);

    expect(replay.body['id']).toBe(first.body['id']);
    expect(replay.body['replayed']).toBe(true);

    const count = await prisma.bid.count({ where: { auctionId, idempotencyKey: 'bid-replay-1' } });
    expect(count).toBe(1);
  });

  it('serialises concurrent bids so only one becomes the current bid', async () => {
    const server = app.getHttpServer();
    const before = await prisma.auction.findUniqueOrThrow({ where: { id: reserveAuctionId } });
    const accepted =
      before.currentBidMinor === null ? 10_000 : Number(before.currentBidMinor) + 1000;

    // Fire 5 simultaneous bids for the SAME amount.
    const attempts = await Promise.all(
      Array.from({ length: 5 }, () =>
        request(server)
          .post(`/api/v1/auctions/${reserveAuctionId}/bids`)
          .set('Authorization', `Bearer ${bidderAToken}`)
          .send({ amountMinor: accepted }),
      ),
    );

    const created = attempts.filter((res) => res.status === 201);
    const rejected = attempts.filter((res) => res.status === 400 || res.status === 409);

    // Exactly one wins; the rest are rejected as too low (no double-accept).
    expect(created).toHaveLength(1);
    expect(rejected).toHaveLength(4);

    const after = await prisma.auction.findUniqueOrThrow({ where: { id: reserveAuctionId } });
    expect(after.currentBidMinor).toBe(BigInt(created[0]!.body['amountMinor'] as string));
    expect(after.bidCount).toBe(before.bidCount + 1);
  });

  it('closes an auction once the server clock passes endsAt: reserve met -> winner + SOLD', async () => {
    const server = app.getHttpServer();

    // Force the auction past its end without waiting an hour.
    await prisma.auction.update({
      where: { id: auctionId },
      data: { endsAt: new Date(Date.now() - 60_000), lastBidAt: new Date(Date.now() - 600_000) },
    });

    const closed = await request(server)
      .post(`/api/v1/auctions/${auctionId}/close`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    expect(closed.body).toMatchObject({ status: 'RESERVE_MET' });
    expect(typeof closed.body['winnerBuyerId']).toBe('string');

    const winningBid = await prisma.bid.findFirst({
      where: { auctionId, status: 'WON' },
    });
    expect(winningBid).not.toBeNull();
    expect(closed.body['winnerBuyerId']).toBe(winningBid?.bidderId);

    const listing = await prisma.listing.findUnique({ where: { id: listingId } });
    expect(listing?.status).toBe('SOLD');

    // Idempotent: a second close returns the same terminal state.
    const again = await request(server)
      .post(`/api/v1/auctions/${auctionId}/close`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(again.body).toMatchObject({ status: 'RESERVE_MET' });
  });

  it('refuses to close an auction before endsAt', async () => {
    const server = app.getHttpServer();
    const future = await publishAuction(
      server,
      sellerToken,
      adminToken,
      await createReadyAsset(server, sellerToken, { title: 'Future auction' }),
    );

    const res = await request(server)
      .post(`/api/v1/auctions/${future.auctionId}/close`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(409);
    expect(res.body).toMatchObject({ code: 'AUCTION_NOT_ENDED' });
  });

  it('closes with RESERVE_NOT_MET and EXPIRES the listing when the reserve is not reached', async () => {
    const server = app.getHttpServer();

    // No-reserve auction: a bid exists but the reserve (null) is trivially met,
    // so use an explicit reserve auction that is under-bid instead.
    const assetId = await createReadyAsset(server, sellerToken, { title: 'Reserve auction' });
    const { auctionId: targetAuctionId, listingId: targetListingId } = await publishAuction(
      server,
      sellerToken,
      adminToken,
      assetId,
      { priceMinor: 500_000 },
    );

    await request(server)
      .post(`/api/v1/auctions/${targetAuctionId}/bids`)
      .set('Authorization', `Bearer ${bidderAToken}`)
      .send({ amountMinor: 100_000 })
      .expect(201);

    await prisma.auction.update({
      where: { id: targetAuctionId },
      data: { endsAt: new Date(Date.now() - 60_000), lastBidAt: new Date(Date.now() - 600_000) },
    });

    const closed = await request(server)
      .post(`/api/v1/auctions/${targetAuctionId}/close`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);
    expect(closed.body).toMatchObject({ status: 'RESERVE_NOT_MET', winnerBuyerId: null });

    const listing = await prisma.listing.findUnique({ where: { id: targetListingId } });
    expect(listing?.status).toBe('EXPIRED');
  });

  it('extends instead of closing when the decisive bid landed inside the anti-snipe window', async () => {
    const server = app.getHttpServer();

    const assetId = await createReadyAsset(server, sellerToken, { title: 'Snipe auction' });
    const { auctionId: snipeAuctionId } = await publishAuction(
      server,
      sellerToken,
      adminToken,
      assetId,
    );

    const now = Date.now();
    await prisma.auction.update({
      where: { id: snipeAuctionId },
      data: {
        endsAt: new Date(now - 5_000), // already past
        lastBidAt: new Date(now - 5_000), // ...but bid inside the last 2 minutes
      },
    });

    const extended = await request(server)
      .post(`/api/v1/auctions/${snipeAuctionId}/close`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(201);

    expect(extended.body).toMatchObject({ status: 'LIVE' });
    const newEndsAt = new Date(String(extended.body['endsAt']));
    expect(newEndsAt.getTime()).toBeGreaterThan(now);

    // The listing end time follows the auction.
    const state = await prisma.auction.findUniqueOrThrow({ where: { id: snipeAuctionId } });
    const listing = await prisma.listing.findUniqueOrThrow({ where: { id: state.listingId } });
    expect(listing.endsAt?.getTime()).toBe(state.endsAt.getTime());
    expect(listing.status).toBe('ACTIVE');
  });
});
