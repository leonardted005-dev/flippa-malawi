import request from 'supertest';

import {
  bearerFromAuthBody,
  bootE2EApp,
  createE2ESeller,
  createReadyAsset,
  ensureFreeTier,
  ensureQualityPolicy,
  registerE2EUser,
} from './e2e-helpers';

function pngBytes(payload: string): Buffer {
  // PNG signature + IHDR header, deliberately WITHOUT any NUL bytes so the
  // external scanner treats the file as text and can inspect its payload.
  // (A real PNG always contains NULs; gitleaks skips binary files.)
  const header = [
    0x89,
    0x50,
    0x4e,
    0x47,
    0x0d,
    0x0a,
    0x1a,
    0x0a, // PNG signature
    0x01,
    0x01,
    0x01,
    0x01, // IHDR length (non-zero placeholder bytes)
    0x49,
    0x48,
    0x44,
    0x52, // "IHDR"
    0x01,
    0x01,
    0x01,
    0x01, // width  (read by our image probe)
    0x01,
    0x01,
    0x01,
    0x01, // height
  ];
  return Buffer.concat([Buffer.from(header), Buffer.from(`\n${payload}\n`, 'utf8')]);
}

const LEAKED_SECRET = 'secret_key = 4a7f0b9c1234abcd5678';

async function upload(server: unknown, token: string, body: Buffer): Promise<string> {
  const presigned = await request(server as never)
    .post('/api/v1/uploads/presign')
    .set('Authorization', `Bearer ${token}`)
    .send({ contentType: 'image/png', sizeBytes: body.length })
    .expect(201);

  const put = await fetch(presigned.body['uploadUrl'] as string, {
    method: 'PUT',
    headers: { 'Content-Type': 'image/png' },
    body: new Uint8Array(body),
  });
  if (![200, 204].includes(put.status)) {
    throw new Error(`upload failed with ${put.status}`);
  }

  const completed = await request(server as never)
    .post(`/api/v1/uploads/${presigned.body['id'] as string}/complete`)
    .set('Authorization', `Bearer ${token}`)
    .expect(201);
  expect(completed.body).toMatchObject({ imageFormat: 'png', scanStatus: 'PENDING' });

  return presigned.body['id'] as string;
}

describe('Quality control (e2e, real external scanner)', () => {
  let app: Awaited<ReturnType<typeof bootE2EApp>>['app'];
  let prisma: Awaited<ReturnType<typeof bootE2EApp>>['prisma'];
  let token: string;
  let assetId: string;
  let cleanObjectId: string;
  let leakyObjectId: string;

  beforeAll(async () => {
    ({ app, prisma } = await bootE2EApp());
    await ensureFreeTier(prisma);
    await ensureQualityPolicy(prisma);

    const server = app.getHttpServer();
    const register = await registerE2EUser(server, { email: 'scanner@example.com' });
    token = bearerFromAuthBody(register.body).accessToken;
    await createE2ESeller(server, token);
    assetId = await createReadyAsset(server, token, { title: 'Scannable asset' });

    cleanObjectId = await upload(server, token, pngBytes('nothing sensitive in this file at all'));
    leakyObjectId = await upload(server, token, pngBytes(`header\n${LEAKED_SECRET}`));
  });

  afterAll(async () => {
    await app.close();
    await prisma.$disconnect();
  });

  it('a CLEAN artifact passes: no findings, PASS decision, raw result retained', async () => {
    const server = app.getHttpServer();

    const res = await request(server)
      .post(`/api/v1/assets/${assetId}/rescan`)
      .set('Authorization', `Bearer ${token}`)
      .send({ objectIds: [cleanObjectId] })
      .expect(201);

    expect(res.body).toMatchObject({ qualityStatus: 'PASS' });
    expect(res.body['report']).toMatchObject({ decision: 'PASS', totalFindings: 0 });
    expect(res.body['findings']).toEqual([]);

    const run = await prisma.scannerRun.findFirst({
      where: { assetId },
      orderBy: { submittedAt: 'desc' },
    });
    expect(run).not.toBeNull();
    // Rule #15: raw tool output retained with a digest.
    expect(run!.rawResultObject).toBeTruthy();
    expect(run!.rawSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(run!.scanner).toBe('gitleaks');
    expect(run!.status).toBe('COMPLETED');

    const object = await prisma.storageObject.findUniqueOrThrow({ where: { id: cleanObjectId } });
    expect(object.scanStatus).toBe('CLEAN');
  });

  it('a MALICIOUS artifact fails: finding normalized, redacted, and quarantined', async () => {
    const server = app.getHttpServer();

    const res = await request(server)
      .post(`/api/v1/assets/${assetId}/rescan`)
      .set('Authorization', `Bearer ${token}`)
      .send({ objectIds: [leakyObjectId] })
      .expect(201);

    expect(res.body).toMatchObject({ qualityStatus: 'FAIL' });
    expect(res.body['report']).toMatchObject({ decision: 'FAIL' });

    const findings = res.body['findings'] as Array<Record<string, unknown>>;
    expect(findings.length).toBeGreaterThanOrEqual(1);

    const secret = findings[0]!;
    expect(secret['scanner']).toBe('gitleaks');
    expect(secret['category']).toBe('secret');
    expect(secret['severity']).toBe('HIGH');
    expect(String(secret['file'])).toContain('.png');
    // The credential value must NEVER be persisted or returned.
    expect(secret['evidence']).toBe('[REDACTED]');
    expect(JSON.stringify(res.body)).not.toContain('4a7f0b9c1234abcd5678');

    const stored = await prisma.securityFinding.findMany({
      where: { filePath: { endsWith: '.png' } },
    });
    expect(stored.length).toBeGreaterThanOrEqual(1);
    expect(stored.every((finding) => finding.evidence === '[REDACTED]')).toBe(true);

    const object = await prisma.storageObject.findUniqueOrThrow({ where: { id: leakyObjectId } });
    expect(object.scanStatus).toBe('QUARANTINED');
  });

  it('exposes the report publicly and raw scan metadata to admins', async () => {
    const server = app.getHttpServer();

    const quality = await request(server)
      .get(`/api/v1/assets/${assetId}/quality`)
      .set('Authorization', `Bearer ${token}`)
      .expect(200);
    expect(quality.body).toHaveProperty('report');
    expect((quality.body['findings'] as unknown[]).length).toBeGreaterThanOrEqual(1);

    // Raw scan metadata is admin-only.
    await request(server)
      .get(`/api/v1/assets/${assetId}/scans`)
      .set('Authorization', `Bearer ${token}`)
      .expect(403);
  });
});
