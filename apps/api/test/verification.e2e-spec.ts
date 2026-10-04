import request from 'supertest';

import {
  bearerFromAuthBody,
  bootE2EApp,
  createE2ESeller,
  createReadyAsset,
  ensureFreeTier,
  registerAdmin,
  registerE2EUser,
} from './e2e-helpers';
import { StubEvidenceReaders } from '../src/integrations/evidence/stub-evidence-readers';

/**
 * Phase 8 — asset verification + seller KYC.
 *
 * Evidence readers are stubbed (deterministic DNS TXT / well-known pages),
 * but every server-side decision, lock, projection, and audit write is real.
 */
describe('Verification (e2e)', () => {
  let app: Awaited<ReturnType<typeof bootE2EApp>>['app'];
  let prisma: Awaited<ReturnType<typeof bootE2EApp>>['prisma'];
  let evidence: StubEvidenceReaders;
  let sellerToken: string;
  let otherToken: string;
  let adminToken: string;
  let assetA: string; // DNS flow -> APPROVED -> revoke
  let assetB: string; // HTTP flow -> REJECTED
  let assetC: string; // concurrency
  let softwareAsset: string; // method-not-allowed
  let caseA: string;
  let caseB: string;
  /** Kept in the test (never re-fetched from the API) — tokens are one-shot. */
  let challengeToken: string;

  beforeAll(async () => {
    evidence = new StubEvidenceReaders();
    ({ app, prisma } = await bootE2EApp({ evidence }));
    await ensureFreeTier(prisma);

    const server = app.getHttpServer();
    const seller = await registerE2EUser(server, { email: 'verify-seller@example.com' });
    sellerToken = bearerFromAuthBody(seller.body).accessToken;
    await createE2ESeller(server, sellerToken);

    const other = await registerE2EUser(server, { email: 'verify-other@example.com' });
    otherToken = bearerFromAuthBody(other.body).accessToken;
    await createE2ESeller(server, otherToken);

    adminToken = (await registerAdmin(server, prisma, 'verify-admin@example.com')).accessToken;

    assetA = await createReadyAsset(server, sellerToken, {
      type: 'WEBSITE',
      title: 'Verified shop A',
      metadata: { domain: 'shop-a.example.com' },
    });
    assetB = await createReadyAsset(server, sellerToken, {
      type: 'WEBSITE',
      title: 'Verified shop B',
      metadata: { domain: 'shop-b.example.com' },
    });
    assetC = await createReadyAsset(server, sellerToken, {
      type: 'WEBSITE',
      title: 'Contended shop C',
      metadata: { domain: 'shop-c.example.com' },
    });
    softwareAsset = await createReadyAsset(server, sellerToken, { title: 'Software asset' });
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('opens a DNS challenge and projects IN_REVIEW on the asset', async () => {
    const server = app.getHttpServer();
    const res = await request(server)
      .post('/api/v1/verification/cases')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ targetType: 'ASSET', assetId: assetA, method: 'DNS_TXT' })
      .expect(201);

    caseA = res.body['id'] as string;
    expect(res.body['status']).toBe('OPEN');
    const challenge = res.body['challenge'] as Record<string, unknown>;
    expect(challenge['target']).toBe('_fa-verify.shop-a.example.com');
    challengeToken = challenge['token'] as string;
    expect(challengeToken).toMatch(/^[0-9a-f]{64}$/);

    const asset = await request(server)
      .get(`/api/v1/assets/${assetA}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    expect(asset.body['verificationStatus']).toBe('IN_REVIEW');
  });

  it('rejects a second open while a case is active (409)', async () => {
    const server = app.getHttpServer();
    const res = await request(server)
      .post('/api/v1/verification/cases')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ targetType: 'ASSET', assetId: assetA, method: 'DNS_TXT' })
      .expect(409);
    expect(res.body['code']).toBe('VERIFICATION_ALREADY_OPEN');
  });

  it('PROOF_NOT_FOUND before the TXT record is published', async () => {
    const server = app.getHttpServer();
    const res = await request(server)
      .post(`/api/v1/verification/cases/${caseA}/check`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(409);
    expect(res.body['code']).toBe('PROOF_NOT_FOUND');
  });

  it('accepts live TXT evidence and moves the case to SUBMITTED', async () => {
    const server = app.getHttpServer();
    evidence.setTxt('_fa-verify.shop-a.example.com', [challengeToken]);

    const res = await request(server)
      .post(`/api/v1/verification/cases/${caseA}/check`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(201);
    expect(res.body['status']).toBe('SUBMITTED');
    // The challenge is consumed — it must not appear (or be null) either way.
    expect(res.body['challenge'] ?? null).toBeNull();
  });

  it('never re-exposes the challenge token on read endpoints', async () => {
    const server = app.getHttpServer();
    const res = await request(server)
      .get(`/api/v1/assets/${assetA}/verification/cases`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    expect(JSON.stringify(res.body)).not.toContain(challengeToken);
  });

  it('admin queue is ADMIN-only and lists the submitted case', async () => {
    const server = app.getHttpServer();
    await request(server)
      .get('/api/v1/admin/verification/queue')
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(403);

    const res = await request(server)
      .get('/api/v1/admin/verification/queue')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const items = res.body['items'] as Array<Record<string, unknown>>;
    expect(items.some((item) => item['id'] === caseA)).toBe(true);
    expect(items[0]?.['asset']).toBeTruthy();
  });

  it('approving a case projects VERIFIED onto the asset', async () => {
    const server = app.getHttpServer();
    const cases = await request(server)
      .get(`/api/v1/assets/${assetA}/verification/cases`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    const current = (cases.body as Array<Record<string, unknown>>).find(
      (row) => row['id'] === caseA,
    )!;

    await request(server)
      .patch(`/api/v1/admin/verification/cases/${caseA}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'APPROVED', expectedVersion: current['version'] })
      .expect(200);

    const asset = await request(server)
      .get(`/api/v1/assets/${assetA}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    expect(asset.body['verificationStatus']).toBe('VERIFIED');
  });

  it('revocation requires a reason and drops the projection to UNVERIFIED', async () => {
    const server = app.getHttpServer();
    await request(server)
      .patch(`/api/v1/admin/verification/cases/${caseA}/revoke`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ note: '' })
      .expect(400);

    await request(server)
      .patch(`/api/v1/admin/verification/cases/${caseA}/revoke`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ note: 'Ownership evidence later disproven' })
      .expect(200);

    const asset = await request(server)
      .get(`/api/v1/assets/${assetA}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    expect(asset.body['verificationStatus']).toBe('UNVERIFIED');
  });

  it('HTTP token flow: fail, publish well-known, SUBMITTED, then REJECTED with note', async () => {
    const server = app.getHttpServer();
    const open = await request(server)
      .post('/api/v1/verification/cases')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ targetType: 'ASSET', assetId: assetB, method: 'HTTP_TOKEN' })
      .expect(201);
    caseB = open.body['id'] as string;
    const challenge = open.body['challenge'] as Record<string, unknown>;
    expect(challenge['target']).toBe('https://shop-b.example.com/.well-known/fa-verification.txt');
    const token = challenge['token'] as string;

    await request(server)
      .post(`/api/v1/verification/cases/${caseB}/check`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(409);

    evidence.setPage(
      'https://shop-b.example.com/.well-known/fa-verification.txt',
      `ownership-proof ${token}`,
    );
    const checked = await request(server)
      .post(`/api/v1/verification/cases/${caseB}/check`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(201);
    expect(checked.body['status']).toBe('SUBMITTED');
    const version = checked.body['version'] as number;

    await request(server)
      .patch(`/api/v1/admin/verification/cases/${caseB}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'REJECTED', expectedVersion: version })
      .expect(400);

    await request(server)
      .patch(`/api/v1/admin/verification/cases/${caseB}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        decision: 'REJECTED',
        expectedVersion: version,
        note: 'Domain ownership unconfirmed',
      })
      .expect(200);

    const asset = await request(server)
      .get(`/api/v1/assets/${assetB}`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .expect(200);
    expect(asset.body['verificationStatus']).toBe('REJECTED');
  });

  it('forbids DNS verification of SOFTWARE assets (registry-driven)', async () => {
    const server = app.getHttpServer();
    const res = await request(server)
      .post('/api/v1/verification/cases')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ targetType: 'ASSET', assetId: softwareAsset, method: 'DNS_TXT' })
      .expect(400);
    expect(res.body['code']).toBe('METHOD_NOT_ALLOWED');
  });

  it('two concurrent opens: exactly one wins the active-case slot', async () => {
    const server = app.getHttpServer();
    const body = { targetType: 'ASSET' as const, assetId: assetC, method: 'DNS_TXT' as const };
    const [first, second] = await Promise.all([
      request(server)
        .post('/api/v1/verification/cases')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send(body),
      request(server)
        .post('/api/v1/verification/cases')
        .set('Authorization', `Bearer ${sellerToken}`)
        .send(body),
    ]);
    const statuses = [first.status, second.status].sort((a, b) => a - b);
    expect(statuses).toEqual([201, 409]);

    const active = await prisma.verificationCase.count({
      where: { assetId: assetC, status: { in: ['OPEN', 'SUBMITTED'] } },
    });
    expect(active).toBe(1);
  });

  it("IDOR: a foreign seller cannot touch another seller's cases (404)", async () => {
    const server = app.getHttpServer();
    await request(server)
      .post(`/api/v1/verification/cases/${caseB}/check`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
    await request(server)
      .get(`/api/v1/assets/${assetA}/verification/cases`)
      .set('Authorization', `Bearer ${otherToken}`)
      .expect(404);
  });

  it('seller KYC: answers are encrypted at rest and never echoed back', async () => {
    const server = app.getHttpServer();
    const open = await request(server)
      .post('/api/v1/verification/cases')
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({ targetType: 'SELLER', method: 'MANUAL' })
      .expect(201);
    const kycCase = open.body['id'] as string;
    expect(open.body['kycLevel']).toBe('BASIC');

    const secret = 'Plot 42 Great East Road Lusaka';
    const submitted = await request(server)
      .post(`/api/v1/verification/cases/${kycCase}/kyc`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        expectedVersion: open.body['version'],
        answers: [{ question: 'Registered address', answer: secret }],
      })
      .expect(201);
    expect(submitted.body['status']).toBe('SUBMITTED');
    expect(JSON.stringify(submitted.body)).not.toContain(secret);

    await request(server)
      .post(`/api/v1/verification/cases/${kycCase}/kyc`)
      .set('Authorization', `Bearer ${sellerToken}`)
      .send({
        expectedVersion: submitted.body['version'],
        answers: [{ question: 'Registered address', answer: secret }],
      })
      .expect(409);

    const stored = await prisma.kycAnswer.findMany({ where: { caseId: kycCase } });
    expect(stored).toHaveLength(1);
    expect(stored[0]!.answerEnc).not.toContain(secret);
    expect(stored[0]!.answerEnc.startsWith('v1.')).toBe(true);

    const queue = await request(server)
      .get('/api/v1/admin/verification/queue')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(JSON.stringify(queue.body)).not.toContain(secret);

    await request(server)
      .patch(`/api/v1/admin/verification/cases/${kycCase}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ decision: 'REJECTED', expectedVersion: submitted.body['version'] })
      .expect(400);
    const decided = await request(server)
      .patch(`/api/v1/admin/verification/cases/${kycCase}/decide`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        decision: 'REJECTED',
        expectedVersion: submitted.body['version'],
        note: 'Address document did not match',
      })
      .expect(200);
    expect(decided.body['status']).toBe('REJECTED');
  });
});
