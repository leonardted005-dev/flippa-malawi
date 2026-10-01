import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Injectable,
  SetMetadata,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';

export interface RateLimitOptions {
  limit: number;
  windowMs: number;
}

export const RATE_LIMIT_KEY = 'rateLimit';

export const RateLimit = (options: RateLimitOptions): MethodDecorator =>
  SetMetadata(RATE_LIMIT_KEY, options);

/**
 * Minimal in-process sliding-window limiter for sensitive endpoints.
 * NOTE: per-process only — a Redis-backed limiter is introduced with the
 * payments/worker phases (see docs/API_ARCHITECTURE.md).
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly hits = new Map<string, number[]>();

  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const options = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!options) {
      return true;
    }

    const request = context.switchToHttp().getRequest<Request>();
    const identity = request.ip ?? 'unknown';
    const route = `${request.method}:${request.route?.path ?? request.path}`;
    const key = `${identity}:${route}`;
    const now = Date.now();

    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < options.windowMs);
    if (recent.length >= options.limit) {
      throw new HttpException(
        { code: 'RATE_LIMITED', message: 'Too many requests' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    recent.push(now);
    this.hits.set(key, recent);

    if (this.hits.size > 10_000) {
      for (const [k, timestamps] of this.hits) {
        if (timestamps.every((t) => now - t >= options.windowMs)) {
          this.hits.delete(k);
        }
      }
    }

    return true;
  }
}
