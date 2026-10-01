import { createHash } from 'node:crypto';

import { ConflictException, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../integrations/prisma/prisma.service';

export interface IdempotentResult<T> {
  statusCode: number;
  body: T;
  replayed: boolean;
}

/**
 * Client retry safety. A mutation wrapped in run() executes at most once per
 * (scope, Idempotency-Key); replays return the stored response.
 */
@Injectable()
export class IdempotencyService {
  constructor(private readonly prisma: PrismaService) {}

  static hashRequest(payload: unknown): string {
    return createHash('sha256')
      .update(JSON.stringify(payload ?? null), 'utf8')
      .digest('hex');
  }

  async run<T>(
    scope: string,
    key: string | undefined,
    requestHash: string,
    handler: () => Promise<{ statusCode: number; body: T }>,
  ): Promise<IdempotentResult<T>> {
    if (!key) {
      const result = await handler();
      return { ...result, replayed: false };
    }

    try {
      await this.prisma.idempotencyKey.create({ data: { scope, key, requestHash } });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        const existing = await this.prisma.idempotencyKey.findUnique({
          where: { scope_key: { scope, key } },
        });
        if (!existing) {
          throw error;
        }
        if (existing.requestHash !== requestHash) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_KEY_REUSED',
            message: 'Idempotency-Key was reused with a different request body',
          });
        }
        if (existing.statusCode === null) {
          throw new ConflictException({
            code: 'IDEMPOTENCY_IN_PROGRESS',
            message: 'A request with this Idempotency-Key is already in progress',
          });
        }
        return {
          statusCode: existing.statusCode,
          body: existing.responseJson as T,
          replayed: true,
        };
      }
      throw error;
    }

    const result = await handler();
    await this.prisma.idempotencyKey.update({
      where: { scope_key: { scope, key } },
      data: {
        statusCode: result.statusCode,
        responseJson: result.body as Prisma.InputJsonValue,
      },
    });
    return { ...result, replayed: false };
  }
}
