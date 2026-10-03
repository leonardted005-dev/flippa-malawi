import request from 'supertest';

import {
  bearerFromAuthBody,
  bootE2EApp,
  createE2ESeller,
  createReadyAsset,
  ensureFreeTier,
  registerE2EUser,
  truncateE2E,
} from './e2e-helpers';

describe('Watchlists (e2e)', () => {
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

  it('lazily creates one default watchlist and adds items idempotently', async () => {
    const server = app.getHttpServer();

    const buyer = bearerFromAuthBody(
      (await registerE2EUser(server, { email: 'watcher@example.com' })).body,
    ).accessToken;

    const seller = bearerFromAuthBody(
      (await registerE2EUser(server, { email: 'watched-seller@example.com' })).body,
    ).accessToken;
    await createE2ESeller(server, seller);
    const assetId = await createReadyAsset(server, seller, { title: 'Watchable asset' });

    const created = await request(server)
      .get('/api/v1/watchlists')
      .set('Authorization', `Bearer ${buyer}`)
      .expect(200);
    expect(created.body).toMatchObject({ isDefault: true, replayed: false, items: [] });
    const watchlistId = created.body['id'] as string;

    // A second GET reuses the same watchlist instead of creating another.
    const again = await request(server)
      .get('/api/v1/watchlists')
      .set('Authorization', `Bearer ${buyer}`)
      .expect(200);
    expect(again.body).toMatchObject({ id: watchlistId, replayed: true });

    const first = await request(server)
      .post(`/api/v1/watchlists/${watchlistId}/items`)
      .set('Authorization', `Bearer ${buyer}`)
      .send({ assetId })
      .expect(201);
    expect((first.body['asset'] as Record<string, unknown>)['id']).toBe(assetId);

    // Adding twice is idempotent (same item id, still one row).
    const repeat = await request(server)
      .post(`/api/v1/watchlists/${watchlistId}/items`)
      .set('Authorization', `Bearer ${buyer}`)
      .send({ assetId })
      .expect(201);
    expect(repeat.body['id']).toBe(first.body['id']);
    expect(await prisma.watchlistItem.count({ where: { watchlistId } })).toBe(1);

    const list = await request(server)
      .get('/api/v1/watchlists')
      .set('Authorization', `Bearer ${buyer}`)
      .expect(200);
    expect((list.body['items'] as unknown[]).length).toBe(1);

    const removed = await request(server)
      .delete(`/api/v1/watchlists/${watchlistId}/items/${assetId}`)
      .set('Authorization', `Bearer ${buyer}`)
      .expect(200);
    expect(removed.body).toMatchObject({ removed: true });
    expect(await prisma.watchlistItem.count({ where: { watchlistId } })).toBe(0);
  });

  it('keeps watchlists private and blocks sellers from watching their own assets', async () => {
    const server = app.getHttpServer();

    const owner = bearerFromAuthBody(
      (await registerE2EUser(server, { email: 'owning-seller@example.com' })).body,
    ).accessToken;
    await createE2ESeller(server, owner);
    const ownAssetId = await createReadyAsset(server, owner, { title: 'My own asset' });

    const ownWatchlist = await request(server)
      .get('/api/v1/watchlists')
      .set('Authorization', `Bearer ${owner}`)
      .expect(200);

    const selfWatch = await request(server)
      .post(`/api/v1/watchlists/${ownWatchlist.body['id']}/items`)
      .set('Authorization', `Bearer ${owner}`)
      .send({ assetId: ownAssetId })
      .expect(403);
    expect(selfWatch.body).toMatchObject({ code: 'SELLER_CANNOT_WATCH_OWN' });

    // Another user cannot read or mutate someone else's watchlist (404, no leak).
    const stranger = bearerFromAuthBody(
      (await registerE2EUser(server, { email: 'stranger-watcher@example.com' })).body,
    ).accessToken;

    await request(server)
      .get(`/api/v1/watchlists/${ownWatchlist.body['id']}`)
      .set('Authorization', `Bearer ${stranger}`)
      .expect(404);

    await request(server)
      .post(`/api/v1/watchlists/${ownWatchlist.body['id']}/items`)
      .set('Authorization', `Bearer ${stranger}`)
      .send({ assetId: ownAssetId })
      .expect(404);

    await request(server).get('/api/v1/watchlists').expect(401);
  });
});
