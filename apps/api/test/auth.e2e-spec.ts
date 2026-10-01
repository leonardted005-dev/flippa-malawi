import request from 'supertest';

import { bearerFromAuthBody, bootE2EApp, registerE2EUser, truncateE2E } from './e2e-helpers';

describe('Auth (e2e)', () => {
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

  it('registers, authenticates and returns the current user', async () => {
    const server = app.getHttpServer();
    const { status, body } = await registerE2EUser(server, { email: 'buyer@example.com' });
    expect(status).toBe(201);
    expect(body['user']).toMatchObject({ email: 'buyer@example.com' });

    const bearer = bearerFromAuthBody(body);
    const me = await request(server)
      .get('/api/v1/auth/me')
      .set('Authorization', `Bearer ${bearer.accessToken}`)
      .expect(200);

    expect(me.body).toMatchObject({ email: 'buyer@example.com' });

    const unauthenticated = await request(server).get('/api/v1/auth/me').expect(401);
    expect(unauthenticated.body).toMatchObject({ status: 401 });
  });

  it('logs in, rotates refresh tokens and detects reuse', async () => {
    const server = app.getHttpServer();
    const registered = await registerE2EUser(server, { email: 'rotator@example.com' });
    const first = bearerFromAuthBody(registered.body);

    const login = await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'rotator@example.com', password: 'correct-horse-battery-staple-2' })
      .expect(200);
    const second = bearerFromAuthBody(login.body as Record<string, unknown>);

    const rotated = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: second.refreshToken })
      .expect(200);
    expect(typeof rotated.body['refreshToken']).toBe('string');
    expect(rotated.body['refreshToken']).not.toBe(second.refreshToken);
    expect(typeof rotated.body['accessToken']).toBe('string');

    await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: second.refreshToken })
      .expect(401);

    // Reused input leaves no usable session from the original family.
    await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: rotated.body['refreshToken'] })
      .expect(401);

    // The token issued at registration belongs to an independent family.
    const stillUsable = await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(200);
    expect(typeof stillUsable.body['refreshToken']).toBe('string');
  });

  it('logs out one session and all sessions', async () => {
    const server = app.getHttpServer();
    const registered = await registerE2EUser(server, { email: 'sessions@example.com' });
    const first = bearerFromAuthBody(registered.body);

    await request(server)
      .post('/api/v1/auth/logout')
      .send({ refreshToken: first.refreshToken })
      .expect(204);

    await request(server)
      .post('/api/v1/auth/refresh')
      .send({ refreshToken: first.refreshToken })
      .expect(401);

    await request(server)
      .post('/api/v1/auth/login')
      .send({ email: 'sessions@example.com', password: 'correct-horse-battery-staple-2' })
      .expect(200);

    const logoutAll = await request(server)
      .post('/api/v1/auth/logout-all')
      .set('Authorization', `Bearer ${first.accessToken}`)
      .expect(200);
    expect(typeof logoutAll.body['revoked']).toBe('number');
  });

  it('rejects duplicate registration and short passwords', async () => {
    const server = app.getHttpServer();
    await registerE2EUser(server, { email: 'duplicate@example.com' });

    const duplicate = await registerE2EUser(server, { email: 'duplicate@example.com' });
    expect(duplicate.status).toBe(409);

    const shortPassword = await request(server)
      .post('/api/v1/auth/register')
      .send({ email: 'weak@example.com', password: 'short' })
      .expect(400);
    expect(shortPassword.body).toMatchObject({ status: 400, code: 'VALIDATION_ERROR' });
  });
});
