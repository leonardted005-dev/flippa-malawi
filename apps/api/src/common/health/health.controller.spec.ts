import { Test } from '@nestjs/testing';

import { PrismaService } from '../../integrations/prisma/prisma.service';
import { HealthController, SERVICE_NAME } from './health.controller';

describe('HealthController', () => {
  let controller: HealthController;
  const queryRaw = jest.fn();

  beforeEach(async () => {
    queryRaw.mockReset();
    queryRaw.mockResolvedValue([{ '?column?': 1 }]);

    const moduleRef = await Test.createTestingModule({
      controllers: [HealthController],
      providers: [{ provide: PrismaService, useValue: { $queryRaw: queryRaw } }],
    }).compile();

    controller = moduleRef.get(HealthController);
  });

  it('reports liveness as ok with service metadata', () => {
    const res = controller.live();
    expect(res.status).toBe('ok');
    expect(res.service).toBe(SERVICE_NAME);
    expect(typeof res.uptimeSeconds).toBe('number');
    expect(Number.isNaN(Date.parse(res.timestamp))).toBe(false);
  });

  it('reports readiness upstream when the database is reachable', async () => {
    const res = await controller.ready();
    expect(res.status).toBe('ok');
    expect(res.checks['config']).toBe('up');
    expect(res.checks['database']).toBe('up');
  });

  it('reports degraded readiness when the database is unreachable', async () => {
    queryRaw.mockRejectedValueOnce(new Error('connection refused'));
    const res = await controller.ready();
    expect(res.status).toBe('degraded');
    expect(res.checks['database']).toBe('down');
  });
});
