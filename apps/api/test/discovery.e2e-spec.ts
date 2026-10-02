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

interface DiscoveryResponse {
  results: Array<Record<string, unknown>>;
  pageInfo: { limit: number; hasMore: boolean; nextCursor: string | null; sort: string };
}

describe('Discovery (e2e, public marketplace read-model)', () => {
  let app: Awaited<ReturnType<typeof bootE2EApp>>['app'];
  let prisma: Awaited<ReturnType<typeof bootE2EApp>>['prisma'];
  let sellerToken: string;
  let adminToken: string;
  let websiteId: string;
  let softwareId: string;
  let kenyaWebsiteId: string;
  let youtubeId: string;
  let draftListingId: string;

  beforeAll(async () => {
    ({ app, prisma } = await bootE2EApp());
    await ensureFreeTier(prisma);

    const register = await registerE2EUser(app.getHttpServer(), {
      email: 'discover-seller@example.com',
    });
    const seller = bearerFromAuthBody(register.body);
    sellerToken = seller.accessToken;
    await createE2ESeller(app.getHttpServer(), sellerToken);

    const admin = await registerAdmin(app.getHttpServer(), prisma, 'discover-admin@example.com');
    adminToken = admin.accessToken;

    const server = app.getHttpServer();

    const webAsset = await createReadyAsset(server, sellerToken, {
      title: 'Zed Storefront',
      type: 'WEBSITE',
      country: 'ZM',
      metadata: {
        domain: 'zedstore.co.zm',
        monthlyTraffic: 12_000,
        monthlyRevenueMinor: 300_000,
        revenueCurrency: 'ZMW',
      },
    });
    websiteId = await publishListing(server, sellerToken, adminToken, webAsset, {
      priceMinor: 250_000,
    });

    const softAsset = await createReadyAsset(server, sellerToken, {
      title: 'Payments SDK',
      type: 'SOFTWARE',
      metadata: { packageSizeBytes: 2_097_152, framework: 'NestJS' },
    });
    softwareId = await publishListing(server, sellerToken, adminToken, softAsset, {
      priceMinor: 50_000,
    });

    const kenyaAsset = await createReadyAsset(server, sellerToken, {
      title: 'Kenya Shop',
      type: 'WEBSITE',
      country: 'KE',
      metadata: { domain: 'kenyashop.co.ke', monthlyTraffic: 40_000 },
    });
    kenyaWebsiteId = await publishListing(server, sellerToken, adminToken, kenyaAsset, {
      priceMinor: 750_000,
    });

    const tubeAsset = await createReadyAsset(server, sellerToken, {
      title: 'Soccer Daily',
      type: 'YOUTUBE_CHANNEL',
      metadata: { channelId: 'UC-soccer', subscribers: 85_000, totalViews: 4_200_000 },
    });
    youtubeId = await publishListing(server, sellerToken, adminToken, tubeAsset, {
      priceMinor: 100_000,
    });

    // A DRAFT listing (never submitted) must not be publicly discoverable.
    const draftAsset = await createReadyAsset(server, sellerToken, { title: 'Hidden Draft Asset' });
    const draft = await request(server)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ assetId: draftAsset, priceMinor: 9_999 })
      .expect(201);
    draftListingId = draft.body['id'] as string;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  // Discovery is read-only: the fixtures created in beforeAll are shared by every test.

  it('serves anonymous visitors with cards carrying only applicable metrics', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/discover/listings').expect(200);
    const body = res.body as DiscoveryResponse;

    expect(body.pageInfo).toMatchObject({ hasMore: false, nextCursor: null, sort: 'newest' });
    expect(body.results).toHaveLength(4);

    const byId = new Map(body.results.map((item) => [item['id'], item]));
    const webCard = byId.get(websiteId) as Record<string, unknown>;
    expect(webCard['status']).toBe('ACTIVE');
    expect(webCard['priceMinor']).toBe('250000');
    expect(webCard['currency']).toBe('ZMW');
    // website metrics present, non-website metrics absent
    expect(webCard['metrics']).toMatchObject({ traffic: 12_000, revenue: '300000' });
    expect((webCard['metrics'] as Record<string, unknown>)['subscribers']).toBeUndefined();

    const tubeCard = byId.get(youtubeId) as Record<string, unknown>;
    expect(tubeCard['metrics']).toMatchObject({ subscribers: 85_000, views: '4200000' });
    expect((tubeCard['metrics'] as Record<string, unknown>)['traffic']).toBeUndefined();

    const softCard = byId.get(softwareId) as Record<string, unknown>;
    expect(softCard['metrics']).toEqual({}); // software has no revenue/subscriber slots

    // seller trust signals + no draft leakage
    expect((webCard['seller'] as Record<string, unknown>)['tierCode']).toBe('FREE_CODER');
    expect(byId.has(draftListingId)).toBe(false);
  });

  it('filters server-side by type, price, country and free-text search', async () => {
    const server = app.getHttpServer();

    const byType = (
      await request(server).get('/api/v1/discover/listings?assetType=WEBSITE').expect(200)
    ).body as DiscoveryResponse;
    expect(byType.results).toHaveLength(2);
    expect(
      byType.results.every(
        (item) => (item['asset'] as Record<string, unknown>)['type'] === 'WEBSITE',
      ),
    ).toBe(true);

    const byCountry = (
      await request(server).get('/api/v1/discover/listings?country=ke').expect(200)
    ).body as DiscoveryResponse;
    expect(byCountry.results).toHaveLength(1);
    expect((byCountry.results[0]!['asset'] as Record<string, unknown>)['country']).toBe('KE');

    const byPrice = (
      await request(server).get('/api/v1/discover/listings?minPriceMinor=700000').expect(200)
    ).body as DiscoveryResponse;
    expect(byPrice.results).toHaveLength(1);
    expect(byPrice.results[0]!['id']).toBe(kenyaWebsiteId);

    const bySearch = (await request(server).get('/api/v1/discover/listings?q=soccer').expect(200))
      .body as DiscoveryResponse;
    expect(bySearch.results).toHaveLength(1);
    expect(bySearch.results[0]!['id']).toBe(youtubeId);

    const caseInsensitive = (
      await request(server).get('/api/v1/discover/listings?q=PAYMENTS').expect(200)
    ).body as DiscoveryResponse;
    expect(caseInsensitive.results).toHaveLength(1);
    expect(caseInsensitive.results[0]!['id']).toBe(softwareId);
  });

  it('sorts deterministically and paginates with a cursor without overlap', async () => {
    const server = app.getHttpServer();

    const asc = (
      await request(server).get('/api/v1/discover/listings?sort=price_asc&limit=4').expect(200)
    ).body as DiscoveryResponse;
    const prices = asc.results.map((item) => Number(item['priceMinor']));
    expect(prices).toEqual([...prices].sort((a, b) => a - b));
    expect(asc.results[0]!['priceMinor']).toBe('50000');

    const desc = (
      await request(server).get('/api/v1/discover/listings?sort=price_desc&limit=4').expect(200)
    ).body as DiscoveryResponse;
    expect(desc.results[0]!['priceMinor']).toBe('750000');

    // cursor pagination: 2 pages of 2, no repeats, correct hasMore flags
    const page1 = (await request(server).get('/api/v1/discover/listings?limit=2').expect(200))
      .body as DiscoveryResponse;
    expect(page1.results).toHaveLength(2);
    expect(page1.pageInfo.hasMore).toBe(true);
    expect(page1.pageInfo.nextCursor).toBeTruthy();

    const page2 = (
      await request(server)
        .get(`/api/v1/discover/listings?limit=2&cursor=${page1.pageInfo.nextCursor}`)
        .expect(200)
    ).body as DiscoveryResponse;
    expect(page2.results).toHaveLength(2);
    expect(page2.pageInfo.hasMore).toBe(false);

    const ids = [...page1.results, ...page2.results].map((item) => item['id']);
    expect(new Set(ids).size).toBe(4);
  });

  it('rejects an unknown category and reports drafts as 404', async () => {
    const server = app.getHttpServer();

    const unknownCategory = await request(server)
      .get('/api/v1/discover/listings?categorySlug=does-not-exist')
      .expect(400);
    expect(unknownCategory.body).toMatchObject({ code: 'CATEGORY_NOT_FOUND' });

    const draft = await request(server)
      .get(`/api/v1/discover/listings/${draftListingId}`)
      .expect(404);
    expect(draft.body).toMatchObject({ status: 404 });

    const detail = (await request(server).get(`/api/v1/discover/listings/${websiteId}`).expect(200))
      .body as Record<string, unknown>;
    expect(detail['status']).toBe('ACTIVE');
    expect(detail['metrics']).toMatchObject({ traffic: 12_000 });
    expect(detail['metadata']).toMatchObject({ domain: 'zedstore.co.zm' });
    expect(Array.isArray(detail['attachments'])).toBe(true);
  });

  it('ignores unknown query parameters safely but rejects malformed values', async () => {
    const server = app.getHttpServer();

    await request(server).get('/api/v1/discover/listings?nonsense=1&also=2').expect(200);

    const bad = await request(server).get('/api/v1/discover/listings?limit=500').expect(400);
    expect(bad.body).toMatchObject({ code: 'VALIDATION_ERROR' });

    const badCountry = await request(server)
      .get('/api/v1/discover/listings?country=Zambia')
      .expect(400);
    expect(badCountry.body).toMatchObject({ code: 'VALIDATION_ERROR' });
  });
});
