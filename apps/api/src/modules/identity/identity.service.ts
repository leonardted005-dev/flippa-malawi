import { randomUUID } from 'node:crypto';

import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Prisma, type Role, type User, type UserStatus } from '@prisma/client';
import type { NotificationSender, PasswordHasher } from '@fa/domain';

import { AuditService } from '../../common/audit/audit.service';
import type { RequestMeta } from '../../common/http/request-meta';
import { NOTIFICATION_SENDER, PASSWORD_HASHER } from '../../common/tokens';
import { TokenService } from '../../integrations/security/token.service';
import type { LoginDto, RegisterDto, ResetPasswordDto } from './identity.dto';
import {
  RefreshTokenRepository,
  UserRepository,
  VerificationTokenRepository,
} from './identity.repository';

const EMAIL_VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const PASSWORD_RESET_TTL_MS = 60 * 60 * 1000;

export interface PublicUser {
  id: string;
  email: string;
  phone: string | null;
  roles: Role[];
  status: UserStatus;
  emailVerified: boolean;
  defaultCountry: string | null;
  defaultCurrency: string | null;
  createdAt: string;
}

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  tokenType: 'Bearer';
}

export interface AuthenticatedResult {
  user: PublicUser;
  tokens: AuthTokens;
}

export function toPublicUser(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
    roles: user.roles,
    status: user.status,
    emailVerified: user.emailVerifiedAt !== null,
    defaultCountry: user.defaultCountry,
    defaultCurrency: user.defaultCurrency,
    createdAt: user.createdAt.toISOString(),
  };
}

@Injectable()
export class IdentityService {
  private readonly logger = new Logger(IdentityService.name);

  constructor(
    private readonly users: UserRepository,
    private readonly refreshTokens: RefreshTokenRepository,
    private readonly verificationTokens: VerificationTokenRepository,
    private readonly tokens: TokenService,
    private readonly audit: AuditService,
    @Inject(PASSWORD_HASHER) private readonly hasher: PasswordHasher,
    @Inject(NOTIFICATION_SENDER) private readonly notifications: NotificationSender,
  ) {}

  async register(dto: RegisterDto, meta: RequestMeta): Promise<AuthenticatedResult> {
    const passwordHash = await this.hasher.hash(dto.password);

    let user: User;
    try {
      user = await this.users.create({
        email: dto.email,
        passwordHash,
        roles: ['BUYER'],
        defaultCountry: dto.country,
        defaultCurrency: dto.currency,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        throw new ConflictException({
          code: 'EMAIL_IN_USE',
          message: 'Email is already registered',
        });
      }
      throw error;
    }

    await this.audit.record({
      actorId: user.id,
      actorType: 'USER',
      action: 'USER_REGISTERED',
      entityType: 'User',
      entityId: user.id,
      after: { email: user.email },
      ...meta,
    });

    const tokens = await this.issueTokens(user, undefined, meta);
    return { user: toPublicUser(user), tokens };
  }

  async login(dto: LoginDto, meta: RequestMeta): Promise<AuthenticatedResult> {
    const user = await this.users.findByEmail(dto.email);
    const passwordOk = user ? await this.hasher.verify(dto.password, user.passwordHash) : false;

    if (!user || !passwordOk) {
      await this.audit.record({
        actorType: 'SYSTEM',
        action: 'LOGIN_FAILED',
        entityType: 'User',
        entityId: user?.id ?? null,
        after: { email: dto.email },
        ...meta,
      });
      throw new UnauthorizedException({
        code: 'INVALID_CREDENTIALS',
        message: 'Invalid email or password',
      });
    }

    if (user.status === 'SUSPENDED') {
      throw new ForbiddenException({ code: 'ACCOUNT_SUSPENDED', message: 'Account is suspended' });
    }

    await this.users.markLogin(user.id);
    await this.audit.record({
      actorId: user.id,
      actorType: 'USER',
      action: 'USER_LOGIN',
      entityType: 'User',
      entityId: user.id,
      ...meta,
    });

    const tokens = await this.issueTokens(user, undefined, meta);
    return { user: toPublicUser(user), tokens };
  }

  async refresh(rawToken: string, meta: RequestMeta): Promise<AuthTokens> {
    let claims: { sub: string; familyId: string; jti: string };
    try {
      claims = await this.tokens.verifyRefreshToken(rawToken);
    } catch {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Invalid refresh token',
      });
    }

    if (typeof claims.jti !== 'string' || claims.jti.length === 0) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Invalid refresh token',
      });
    }

    const stored = await this.refreshTokens.findByHash(this.tokens.hashToken(rawToken));
    if (!stored) {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Invalid refresh token',
      });
    }

    // Reuse of an already-rotated token => possible theft: revoke the family.
    if (stored.revokedAt !== null) {
      const revoked = await this.refreshTokens.revokeFamily(stored.familyId);
      this.logger.warn(
        `refresh reuse detected user=${stored.userId} family=${stored.familyId} revoked=${revoked}`,
      );
      await this.audit.record({
        actorId: stored.userId,
        actorType: 'SYSTEM',
        action: 'REFRESH_REUSE_DETECTED',
        entityType: 'RefreshTokenFamily',
        entityId: stored.familyId,
        ...meta,
      });
      throw new UnauthorizedException({
        code: 'REFRESH_REUSE_DETECTED',
        message: 'Session revoked; please sign in again',
      });
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException({
        code: 'REFRESH_TOKEN_EXPIRED',
        message: 'Refresh token expired',
      });
    }

    const user = await this.users.findById(stored.userId);
    if (!user || user.status === 'SUSPENDED') {
      throw new UnauthorizedException({
        code: 'INVALID_REFRESH_TOKEN',
        message: 'Account unavailable',
      });
    }

    return this.issueTokens(user, { familyId: stored.familyId, rotatedFromId: stored.id }, meta);
  }

  async logout(rawToken: string, meta: RequestMeta): Promise<void> {
    const stored = await this.refreshTokens.findByHash(this.tokens.hashToken(rawToken));
    if (stored && stored.revokedAt === null) {
      await this.refreshTokens.revoke(stored.id);
      await this.audit.record({
        actorId: stored.userId,
        actorType: 'USER',
        action: 'USER_LOGOUT',
        entityType: 'RefreshToken',
        entityId: stored.id,
        ...meta,
      });
    }
  }

  async logoutAll(userId: string, meta: RequestMeta): Promise<{ revoked: number }> {
    const revoked = await this.refreshTokens.revokeAllForUser(userId);
    await this.audit.record({
      actorId: userId,
      actorType: 'USER',
      action: 'USER_LOGOUT_ALL',
      entityType: 'User',
      entityId: userId,
      after: { revoked },
      ...meta,
    });
    return { revoked };
  }

  async me(userId: string): Promise<PublicUser> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException({
        code: 'ACCOUNT_UNAVAILABLE',
        message: 'Account unavailable',
      });
    }
    return toPublicUser(user);
  }

  async requestEmailVerification(userId: string, meta: RequestMeta): Promise<void> {
    const user = await this.users.findById(userId);
    if (!user) {
      throw new UnauthorizedException({
        code: 'ACCOUNT_UNAVAILABLE',
        message: 'Account unavailable',
      });
    }
    if (user.emailVerifiedAt !== null) {
      return; // already verified — idempotent no-op
    }

    const token = await this.createVerificationToken(user.id, 'EMAIL_VERIFY', EMAIL_VERIFY_TTL_MS);
    await this.notifications.send({
      to: user.email,
      subject: 'Verify your email address',
      body: `Verification token: ${token}`,
    });
    await this.audit.record({
      actorId: user.id,
      actorType: 'USER',
      action: 'EMAIL_VERIFICATION_REQUESTED',
      entityType: 'User',
      entityId: user.id,
      ...meta,
    });
  }

  async confirmEmailVerification(
    token: string,
    meta: RequestMeta,
  ): Promise<{ emailVerified: true }> {
    const record = await this.verificationTokens.findActiveByHash(this.tokens.hashToken(token));
    if (!record || record.purpose !== 'EMAIL_VERIFY') {
      throw new BadRequestException({
        code: 'INVALID_VERIFICATION_TOKEN',
        message: 'Invalid or expired verification token',
      });
    }

    await this.verificationTokens.consume(record.id);
    await this.users.markEmailVerified(record.userId);
    await this.audit.record({
      actorId: record.userId,
      actorType: 'USER',
      action: 'EMAIL_VERIFIED',
      entityType: 'User',
      entityId: record.userId,
      ...meta,
    });
    return { emailVerified: true };
  }

  /** Always succeeds, even for unknown emails (anti account-enumeration). */
  async forgotPassword(email: string, meta: RequestMeta): Promise<void> {
    const user = await this.users.findByEmail(email);
    if (!user) {
      return;
    }

    const token = await this.createVerificationToken(
      user.id,
      'PASSWORD_RESET',
      PASSWORD_RESET_TTL_MS,
    );
    await this.notifications.send({
      to: user.email,
      subject: 'Reset your password',
      body: `Reset token: ${token}`,
    });
    await this.audit.record({
      actorType: 'SYSTEM',
      action: 'PASSWORD_RESET_REQUESTED',
      entityType: 'User',
      entityId: user.id,
      ...meta,
    });
  }

  async resetPassword(dto: ResetPasswordDto, meta: RequestMeta): Promise<void> {
    const record = await this.verificationTokens.findActiveByHash(this.tokens.hashToken(dto.token));
    if (!record || record.purpose !== 'PASSWORD_RESET') {
      throw new BadRequestException({
        code: 'INVALID_RESET_TOKEN',
        message: 'Invalid or expired reset token',
      });
    }

    const passwordHash = await this.hasher.hash(dto.password);
    await this.verificationTokens.consume(record.id);
    await this.users.updatePassword(record.userId, passwordHash);
    const revoked = await this.refreshTokens.revokeAllForUser(record.userId);

    await this.audit.record({
      actorId: record.userId,
      actorType: 'USER',
      action: 'PASSWORD_RESET_COMPLETED',
      entityType: 'User',
      entityId: record.userId,
      after: { sessionsRevoked: revoked },
      ...meta,
    });
  }

  private async createVerificationToken(
    userId: string,
    purpose: 'EMAIL_VERIFY' | 'PASSWORD_RESET' | 'PHONE_VERIFY',
    ttlMs: number,
  ): Promise<string> {
    const token = this.tokens.generateOpaqueToken();
    await this.verificationTokens.create({
      userId,
      purpose,
      tokenHash: this.tokens.hashToken(token),
      expiresAt: new Date(Date.now() + ttlMs),
    });
    return token;
  }

  private async issueTokens(
    user: User,
    rotation: { familyId: string; rotatedFromId: string } | undefined,
    meta: RequestMeta,
  ): Promise<AuthTokens> {
    const familyId = rotation?.familyId ?? randomUUID();
    const expiresIn = this.tokens.refreshTtlSeconds;

    const accessToken = await this.tokens.signAccessToken({ sub: user.id, roles: user.roles });
    const refreshToken = await this.tokens.signRefreshToken({ sub: user.id, familyId });

    await this.refreshTokens.create({
      userId: user.id,
      tokenHash: this.tokens.hashToken(refreshToken),
      familyId,
      expiresAt: new Date(Date.now() + expiresIn * 1000),
      rotatedFromId: rotation?.rotatedFromId,
      userAgent: meta.userAgent ?? undefined,
      ipHash: meta.ipHash ?? undefined,
    });

    if (rotation) {
      await this.refreshTokens.revoke(rotation.rotatedFromId);
    }

    return { accessToken, refreshToken, expiresIn, tokenType: 'Bearer' };
  }
}
