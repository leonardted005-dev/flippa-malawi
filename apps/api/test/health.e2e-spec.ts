import type { INestApplication } from '@nestjs/common';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';

import { bootE2EApp, truncateE2E } from './e2e-helpers';

describe('Platform smoke (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaClient;

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

  it('health endpoints remain available', async () => {
    const live = await request(app.getHttpServer()).get('/api/v1/health/live').expect(200);
    expect(live.body.status).toBe('ok');
    expect(live.body.service).toBe('flippa-africa-api');

    const ready = await request(app.getHttpServer()).get('/api/v1/health/ready').expect(200);
    expect(ready.body.checks).toHaveProperty('config', 'up');
  });

  it('unknown route -> RFC 7807 problem+json', async () => {
    const res = await request(app.getHttpServer()).get('/api/v1/does-not-exist').expect(404);
    expect(res.headers['content-type']).toContain('application/problem+json');
    expect(res.body).toMatchObject({ status: 404 });
    expect(typeof res.body.type).toBe('string');
  });
});
