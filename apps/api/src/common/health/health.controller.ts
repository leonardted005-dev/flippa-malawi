import { Controller, Get } from '@nestjs/common';

import type { DependencyState, HealthResponse, ReadyResponse } from '@fa/contracts';

import { Public } from '../../common/security/decorators';
import { PrismaService } from '../../integrations/prisma/prisma.service';

export const SERVICE_NAME = 'flippa-africa-api';
const STARTED_AT = Date.now();

@Controller('health')
@Public()
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  /** Liveness: is the process up and serving? (no external dependencies) */
  @Get('live')
  live(): HealthResponse {
    return {
      status: 'ok',
      service: SERVICE_NAME,
      version: process.env.npm_package_version ?? '0.0.0',
      uptimeSeconds: Math.round((Date.now() - STARTED_AT) / 1000),
      timestamp: new Date().toISOString(),
    };
  }

  /** Readiness: config loaded + database reachable. */
  @Get('ready')
  async ready(): Promise<ReadyResponse> {
    const checks: Record<string, DependencyState> = { config: 'up' };

    let databaseUp = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      databaseUp = true;
    } catch {
      databaseUp = false;
    }
    checks['database'] = databaseUp ? 'up' : 'down';

    // Cache/queue probes are added when Redis is introduced (later phase).
    return {
      status: databaseUp ? 'ok' : 'degraded',
      checks,
      timestamp: new Date().toISOString(),
    };
  }
}
