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

function pngBytes(width = 8, height = 8): Buffer {
  const buffer = Buffer.alloc(64);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(buffer, 0);
  buffer.writeUInt32BE(13, 8);
  buffer.write('IHDR', 12, 'latin1');
  buffer.writeUInt32BE(width, 16);
  buffer.writeUInt32BE(height, 20);
  buffer.writeUInt32BE(8, 24);
  return buffer;
}

describe('Uploads (e2e, real object storage)', () => {
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

  it('presigns, uploads real bytes to MinIO, inspects and attaches them to a listing', async () => {
    const server = app.getHttpServer();
    const register = await registerE2EUser(server, { email: 'uploader@example.com' });
    const seller = bearerFromAuthBody(register.body);
    await createE2ESeller(server, seller.accessToken);

    const presigned = await request(server)
      .post('/api/v1/uploads/presign')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ contentType: 'image/png', sizeBytes: 64 })
      .expect(201);

    const uploadUrl = presigned.body['uploadUrl'] as string;
    const storageObjectId = presigned.body['id'] as string;
    expect(uploadUrl).toContain('X-Amz-Signature');

    // Real upload through the presigned PUT (Content-Type is part of the signature).
    const putResponse = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/png' },
      body: new Uint8Array(pngBytes()),
    });
    if (![200, 204].includes(putResponse.status)) {
      const detail = await putResponse.text();
      throw new Error(
        `PUT to presigned URL failed with ${putResponse.status}: ${detail.slice(0, 600)}`,
      );
    }

    const completed = await request(server)
      .post(`/api/v1/uploads/${storageObjectId}/complete`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(201);
    expect(completed.body).toMatchObject({
      id: storageObjectId,
      contentType: 'image/png',
      visibility: 'REVIEW',
      imageFormat: 'png',
      width: 8,
      height: 8,
      scanStatus: 'PENDING',
    });
    expect(typeof completed.body['sizeBytes']).toBe('string');

    // The verified object can now be attached to a listing.
    const assetId = await createReadyAsset(server, seller.accessToken);
    const listing = await request(server)
      .post('/api/v1/listings')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ assetId, priceMinor: 1000, attachmentIds: [storageObjectId] })
      .expect(201);

    const attachments = listing.body['attachments'] as Array<Record<string, unknown>>;
    expect(attachments).toHaveLength(1);
    expect(attachments[0]).toMatchObject({ hero: true, sort: 0 });
    expect((attachments[0]!['storageObject'] as Record<string, unknown>)['imageFormat']).toBe(
      'png',
    );

    const signed = await request(server)
      .get(`/api/v1/uploads/${storageObjectId}/signed-url`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(200);
    expect(signed.body['url']).toContain('X-Amz-Signature');
  });

  it('rejects oversized uploads against the seller tier quota', async () => {
    const server = app.getHttpServer();
    const register = await registerE2EUser(server, { email: 'huge@example.com' });
    const seller = bearerFromAuthBody(register.body);
    await createE2ESeller(server, seller.accessToken);

    // FREE_CODER quota is 50 MiB per file.
    const res = await request(server)
      .post('/api/v1/uploads/presign')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ contentType: 'image/png', sizeBytes: 60_000_000 })
      .expect(400);
    expect(res.body).toMatchObject({ code: 'UPLOAD_QUOTA_EXCEEDED' });
  });

  it('rejects completing an upload that was never put to storage', async () => {
    const server = app.getHttpServer();
    const register = await registerE2EUser(server, { email: 'ghost@example.com' });
    const seller = bearerFromAuthBody(register.body);
    await createE2ESeller(server, seller.accessToken);

    const presigned = await request(server)
      .post('/api/v1/uploads/presign')
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .send({ contentType: 'image/png', sizeBytes: 64 })
      .expect(201);

    const res = await request(server)
      .post(`/api/v1/uploads/${presigned.body['id']}/complete`)
      .set('Authorization', `Bearer ${seller.accessToken}`)
      .expect(400);
    expect(res.body).toMatchObject({ code: 'UPLOAD_OBJECT_MISSING' });
  });
});
