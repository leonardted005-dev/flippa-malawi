import request from 'supertest';

import { FakePaymentProvider } from '../src/integrations/payments/fake-payment-provider';
import {
  bearerFromAuthBody,
  bootE2EApp,
  createE2ESeller,
  createReadyAsset,
  ensureFreeTier,
  publishAuction,
  publishListing,
  registerAdmin,
  registerE2EUser,
} from './e2e-helpers';

/**
 * Phase 9 — payments orchestrator + provider port.
 *
 * The FAKE adapter signs real HMAC webhooks; every orchestrator decision
 * (idempotency, row locks, state machine, accounting) is the production code
 * path. The DPO seam fails honestly with PAYMENT_PROVIDER_NOT_CONFIGURED.
 */
describe('Payments (e2e)', () => {
  let app: Awaited<ReturnType<typeof bootE2EApp>>['app'];
  let prisma: Awaited<ReturnType<typeof bootE2EApp>>['prisma'];
  let fake: FakePaymentProvider;
  let buyerToken: string;
  let otherToken: string;
  let sellerToken: string;
  let adminToken: string;
  let listingId: string;
  let auctionListingId: string;
  let otherListingId: string;
  let intentId: string;

  function sign(body: string): { signature: string; timestamp: number } {
    const timestamp = Math.floor(Date.now() / 1000);
    return { signature: fake.signWebhook(body, timestamp), timestamp };
  }

  async function postWebhook(
    body: Record<string, unknown>,
    opts: { signature?: string; timestamp?: number } = {},
  ): Promise<{ status: number; body: Record<string, unknown> }> {
    const raw = JSON.stringify(body);
    const signed = sign(raw);
    const res = await request(app.getHttpServer())
      .post('/api/v1/payments/webhooks/fake')
      .set('Content-Type', 'application/json')
      .set('x-fake-signature', opts.signature ?? signed.signature)
      .set('x-fake-timestamp', String(opts.timestamp ?? signed.timestamp))
      .send(raw);
    return { status: res.status, body: res.body as Record<string, unknown> };
  }

  beforeAll(async () => {
    ({ app, prisma } = await bootE2EApp());
    await ensureFreeTier(prisma);
    fake = app.get(FakePaymentProvider);

    const server = app.getHttpServer();
    const seller = await registerE2EUser(server, { email: 'pay-seller@example.com' });
    sellerToken = bearerFromAuthBody(seller.body).accessToken;
    await createE2ESeller(server, sellerToken);

    const buyer = await registerE2EUser(server, { email: 'pay-buyer@example.com' });
    buyerToken = bearerFromAuthBody(buyer.body).accessToken;

    const other = await registerE2EUser(server, { email: 'pay-other@example.com' });
    otherToken = bearerFromAuthBody(other.body).accessToken;
    await createE2ESeller(server, otherToken);

    adminToken = (await registerAdmin(server, prisma, 'pay-admin@example.com')).accessToken;

    const sellerAsset = await createReadyAsset(server, sellerToken, {
      title: 'Paid software',
      metadata: { packageSizeBytes: 4096 },
    });
    listingId = await publishListing(server, sellerToken, adminToken, sellerAsset, {
      priceMinor: 100_000,
      currency: 'ZMW',
    });

    const otherAsset = await createReadyAsset(server, otherToken, {
      title: 'Other software',
      metadata: { packageSizeBytes: 2048 },
    });
    otherListingId = await publishListing(server, otherToken, adminToken, otherAsset, {
      priceMinor: 50_000,
      currency: 'ZMW',
    });

    const auctionAsset = await createReadyAsset(server, sellerToken, {
      title: 'Auctioned software',
      metadata: { packageSizeBytes: 1024 },
    });
    auctionListingId = (await publishAuction(server, sellerToken, adminToken, auctionAsset))
      .listingId;
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('creates an intent from SERVER-SIDE listing price (rule #9)', async () => {
    const server = app.getHttpServer();
    const res = await request(server)
      .post('/api/v1/payments/intents')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId })
      .expect(201);

    intentId = res.body['id'] as string;
    expect(res.body['amountMinor']).toBe('100000'); // server-side price, never client input
    expect(res.body['currency']).toBe('ZMW');
    expect(res.body['status']).toBe('PENDING');
    expect(res.body['provider']).toBe('fake');
    // A fake checkout URL can never be mistaken for a working page (`.invalid`).
    expect(String(res.body['checkoutUrl'])).toContain('.invalid/');
  });

  it('idempotency: same Idempotency-Key replays the same intent', async () => {
    const server = app.getHttpServer();
    const first = await request(server)
      .post('/api/v1/payments/intents')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('idempotency-key', 'intent-key-1')
      .send({ listingId: otherListingId })
      .expect(201);
    const second = await request(server)
      .post('/api/v1/payments/intents')
      .set('Authorization', `Bearer ${buyerToken}`)
      .set('idempotency-key', 'intent-key-1')
      .send({ listingId: otherListingId })
      .expect(201);
    expect(second.body['id']).toBe(first.body['id']);

    const count = await prisma.paymentIntent.count({ where: { listingId: otherListingId } });
    expect(count).toBe(1);
  });

  it('forbids self-purchase and auction checkout (Phase 10 orders)', async () => {
    const server = app.getHttpServer();
    const self = await request(server)
      .post('/api/v1/payments/intents')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ listingId })
      .expect(409);
    expect(self.body['code']).toBe('SELF_PURCHASE_FORBIDDEN');

    const auction = await request(server)
      .post('/api/v1/payments/intents')
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ listingId: auctionListingId })
      .expect(409);
    expect(auction.body['code']).toBe('AUCTION_CHECKOUT_NOT_ENABLED');
  });

  it("IDOR: another buyer cannot read someone else's intent", async () => {
    const server = app.getHttpServer();
    await request(server)
      .get(`/api/v1/payments/intents/${intentId}`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  it('webhook with a bad signature is rejected (401)', async () => {
    const raw = JSON.stringify({ eventId: 'e1', providerRef: 'x', status: 'CAPTURED' });
    const res = await request(app.getHttpServer())
      .post('/api/v1/payments/webhooks/fake')
      .set('Content-Type', 'application/json')
      .set('x-fake-signature', 'sha256=deadbeef')
      .set('x-fake-timestamp', String(Math.floor(Date.now() / 1000)))
      .send(raw)
      .expect(401);
    expect(res.body['code']).toBe('WEBHOOK_SIGNATURE_INVALID');
  });

  it('webhook with a stale timestamp is rejected (replay window)', async () => {
    const raw = JSON.stringify({ eventId: 'e2', providerRef: 'x', status: 'CAPTURED' });
    const signed = sign(raw);
    await request(app.getHttpServer())
      .post('/api/v1/payments/webhooks/fake')
      .set('Content-Type', 'application/json')
      .set('x-fake-signature', signed.signature)
      .set('x-fake-timestamp', String(signed.timestamp - 400)) // outside ±300s
      .send(raw)
      .expect(401);
  });

  it('valid webhook captures the payment; replay is idempotent (rule #12)', async () => {
    const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intentId } });
    const event = {
      eventId: 'evt-capture-1',
      providerRef: intent.providerRef!,
      status: 'CAPTURED',
      occurredAt: new Date().toISOString(),
    };

    const first = await postWebhook(event);
    expect(first.status).toBe(200);
    expect(first.body).toEqual({ received: true, duplicate: false });

    const captured = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intentId } });
    expect(captured.status).toBe('CAPTURED');

    // Byte-identical replay: acknowledged, state untouched, ONE event row.
    const replay = await postWebhook(event);
    expect(replay.status).toBe(200);
    expect(replay.body).toEqual({ received: true, duplicate: true });

    const events = await prisma.paymentEvent.findMany({
      where: { provider: 'fake', providerEventId: 'evt-capture-1' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]!.status).toBe('PROCESSED');
  });

  it('an out-of-order DECLINED after CAPTURED cannot regress state', async () => {
    const intent = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intentId } });
    const res = await postWebhook({
      eventId: 'evt-late-decline',
      providerRef: intent.providerRef!,
      status: 'DECLINED',
    });
    expect(res.status).toBe(200); // acknowledged regardless

    const after = await prisma.paymentIntent.findUniqueOrThrow({ where: { id: intentId } });
    expect(after.status).toBe('CAPTURED'); // state machine refused the regression
  });

  it('a webhook for an unknown provider reference is recorded IGNORED + acked 200', async () => {
    const res = await postWebhook({
      eventId: 'evt-unknown-1',
      providerRef: 'fake_never_created',
      status: 'CAPTURED',
    });
    expect(res.status).toBe(200);
    const event = await prisma.paymentEvent.findUniqueOrThrow({
      where: {
        provider_providerEventId: { provider: 'fake', providerEventId: 'evt-unknown-1' },
      },
    });
    expect(event.status).toBe('IGNORED');
    expect(event.intentId).toBeNull();
  });

  it('sync re-reads truth SERVER-SIDE (redirect params are never trusted)', async () => {
    const server = app.getHttpServer();
    const res = await request(server)
      .post(`/api/v1/payments/intents/${intentId}/sync`)
      .set('Authorization', `Bearer ${buyerToken}`)
      .send({ status: 'REFUNDED' }) // client CLAIMS refunded — must be ignored
      .expect(201);
    expect(res.body['status']).toBe('CAPTURED'); // provider truth + state machine win
  });

  it('the DPO seam fails honestly until the official spec arrives', async () => {
    const res = await request(app.getHttpServer())
      .post('/api/v1/payments/webhooks/dpo')
      .set('Content-Type', 'application/json')
      .send(JSON.stringify({ eventId: 'x', providerRef: 'y', status: 'CAPTURED' }))
      .expect(409);
    expect(res.body['code']).toBe('PAYMENT_PROVIDER_NOT_CONFIGURED');
    // RFC 7807: the message surface is `detail`, never a bare `message`.
    expect(String(res.body['detail'])).toContain('specification');
  });

  it('unknown provider codes 404 on the webhook route', async () => {
    await request(app.getHttpServer())
      .post('/api/v1/payments/webhooks/definitely-not-a-provider')
      .set('Content-Type', 'application/json')
      .send('{}')
      .expect(404);
  });

  it('admin refund: partial then full, derived from immutable accounting', async () => {
    const server = app.getHttpServer();
    await request(server)
      .patch(`/api/v1/admin/payments/intents/${intentId}/refund`)
      .set('Authorization', `Bearer ${buyerToken}`) // not an admin
      .send({ amountMinor: 1000 })
      .expect(403);

    // Over-balance is rejected before any provider call.
    await request(server)
      .patch(`/api/v1/admin/payments/intents/${intentId}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amountMinor: 1_000_000 })
      .expect(400);

    const partial = await request(server)
      .patch(`/api/v1/admin/payments/intents/${intentId}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ amountMinor: 40_000 })
      .expect(200);
    expect(partial.body['status']).toBe('PARTIALLY_REFUNDED');
    expect(partial.body['refundedMinor']).toBe('40000');

    const full = await request(server)
      .patch(`/api/v1/admin/payments/intents/${intentId}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({}) // omit = refund the remaining balance
      .expect(200);
    expect(full.body['status']).toBe('REFUNDED');
    expect(full.body['refundedMinor']).toBe('100000');

    // Terminal: nothing left to refund.
    await request(server)
      .patch(`/api/v1/admin/payments/intents/${intentId}/refund`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({})
      .expect(409);
  });

  it('admin payment monitoring lists intents without secrets', async () => {
    const server = app.getHttpServer();
    await request(server)
      .get('/api/v1/admin/payments/intents')
      .set('Authorization', `Bearer ${buyerToken}`)
      .expect(403);

    const res = await request(server)
      .get('/api/v1/admin/payments/intents?limit=5')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const items = res.body['items'] as Array<Record<string, unknown>>;
    expect(items.length).toBeGreaterThanOrEqual(1);
    const serialized = JSON.stringify(res.body);
    // Checkout links are bearer-capability URLs — never in the ops view.
    expect(serialized).not.toContain('checkout.fake-provider.invalid');
  });
});
