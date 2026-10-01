import request from 'supertest';

import { bearerFromAuthBody, bootE2EApp, registerE2EUser, truncateE2E } from './e2e-helpers';

describe('Admin RBAC (e2e)', () => {
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
  });

  it('requires authentication before authorization', async () => {
    const server = app.getHttpServer();
    await request(server).get('/api/v1/admin/audit-logs').expect(401);
  });

  it('forbids authenticated non-admins and allows admins', async () => {
    const server = app.getHttpServer();
    const { body } = await registerE2EUser(server, { email: 'notadmin@example.com' });
    const buyer = bearerFromAuthBody(body);

    const forbidden = await request(server)
      .get('/api/v1/admin/audit-logs')
      .set('Authorization', `Bearer ${buyer.accessToken}`)
      .expect(403);
    expect(forbidden.body).toMatchObject({ status: 403 });

    // Grant ADMIN out-of-band, then re-authenticate: access tokens embed the
    // roles present at issue time, so a fresh token is required.
    await prisma.user.update({
      where: { email: 'notadmin@example.com' },
      data: { roles: { push: 'ADMIN' } },
    });

    const relogin = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'notadmin@example.com', password: 'correct-horse-battery-staple-2' })
      .expect(200);
    const admin = bearerFromAuthBody(relogin.body as Record<string, unknown>);

    const allowed = await request(server)
      .get('/api/v1/admin/audit-logs')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(Array.isArray(allowed.body['items'])).toBe(true);

    const tiers = await request(server)
      .get('/api/v1/admin/tiers')
      .set('Authorization', `Bearer ${admin.accessToken}`)
      .expect(200);
    expect(Array.isArray(tiers.body)).toBe(true);
  });
});
