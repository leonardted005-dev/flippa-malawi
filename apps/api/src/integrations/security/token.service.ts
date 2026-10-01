import { createHash, randomUUID } from 'node:crypto';

import { Inject, Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import type { AppEnv } from '@fa/config';
import type { Role } from '@prisma/client';

import { APP_ENV } from '../../common/config/config.module';

export interface AccessTokenClaims {
  sub: string;
  roles: Role[];
}

export interface RefreshTokenClaims {
  sub: string;
  familyId: string;
  jti: string;
}

export interface RefreshTokenInput {
  sub: string;
  familyId: string;
}

/**
 * JWT + opaque-token helper. Owns signing/verification and token hashing.
 * Separate secrets for access and refresh tokens (see .env.example).
 */
@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  signAccessToken(claims: AccessTokenClaims): Promise<string> {
    return this.jwt.signAsync(claims, {
      secret: this.env.JWT_ACCESS_SECRET,
      expiresIn: this.env.JWT_ACCESS_TTL,
    });
  }

  verifyAccessToken(token: string): Promise<AccessTokenClaims> {
    return this.jwt.verifyAsync<AccessTokenClaims>(token, { secret: this.env.JWT_ACCESS_SECRET });
  }

  signRefreshToken(claims: RefreshTokenInput): Promise<string> {
    const refreshClaims: RefreshTokenClaims = {
      sub: claims.sub,
      familyId: claims.familyId,
      jti: randomUUID(),
    };

    return this.jwt.signAsync(refreshClaims, {
      secret: this.env.JWT_REFRESH_SECRET,
      expiresIn: this.env.JWT_REFRESH_TTL,
    });
  }

  verifyRefreshToken(token: string): Promise<RefreshTokenClaims> {
    return this.jwt.verifyAsync<RefreshTokenClaims>(token, { secret: this.env.JWT_REFRESH_SECRET });
  }

  /** SHA-256 (hex) — used to store refresh/verification tokens without plaintext. */
  hashToken(token: string): string {
    return createHash('sha256').update(token, 'utf8').digest('hex');
  }

  /** Opaque, single-use token for email verification / password reset. */
  generateOpaqueToken(): string {
    return randomUUID();
  }

  get refreshTtlSeconds(): number {
    return this.env.JWT_REFRESH_TTL;
  }
}
