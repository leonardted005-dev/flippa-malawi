import { Injectable } from '@nestjs/common';
import type { Role, VerificationPurpose } from '@prisma/client';

import { PrismaService } from '../../integrations/prisma/prisma.service';

@Injectable()
export class UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByEmail(email: string) {
    return this.prisma.user.findFirst({ where: { email, deletedAt: null } });
  }

  findById(id: string) {
    return this.prisma.user.findFirst({ where: { id, deletedAt: null } });
  }

  create(input: {
    email: string;
    passwordHash: string;
    roles: Role[];
    defaultCountry?: string;
    defaultCurrency?: string;
  }) {
    return this.prisma.user.create({
      data: {
        email: input.email,
        passwordHash: input.passwordHash,
        roles: input.roles,
        defaultCountry: input.defaultCountry ?? null,
        defaultCurrency: input.defaultCurrency ?? null,
        buyerProfile: { create: {} },
      },
    });
  }

  markLogin(id: string) {
    return this.prisma.user.update({ where: { id }, data: { lastLoginAt: new Date() } });
  }

  markEmailVerified(id: string) {
    return this.prisma.user.update({
      where: { id },
      data: { emailVerifiedAt: new Date(), version: { increment: 1 } },
    });
  }

  updatePassword(id: string, passwordHash: string) {
    return this.prisma.user.update({
      where: { id },
      data: { passwordHash, version: { increment: 1 } },
    });
  }

  addRole(id: string, role: Role) {
    return this.prisma.user.update({
      where: { id },
      data: { roles: { push: role }, version: { increment: 1 } },
    });
  }
}

@Injectable()
export class RefreshTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: {
    userId: string;
    tokenHash: string;
    familyId: string;
    expiresAt: Date;
    rotatedFromId?: string;
    userAgent?: string;
    ipHash?: string;
  }) {
    return this.prisma.refreshToken.create({
      data: {
        userId: input.userId,
        tokenHash: input.tokenHash,
        familyId: input.familyId,
        expiresAt: input.expiresAt,
        rotatedFromId: input.rotatedFromId ?? null,
        userAgent: input.userAgent ?? null,
        ipHash: input.ipHash ?? null,
      },
    });
  }

  findByHash(tokenHash: string) {
    return this.prisma.refreshToken.findUnique({ where: { tokenHash } });
  }

  revoke(id: string) {
    return this.prisma.refreshToken.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  }

  async revokeFamily(familyId: string): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { familyId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }

  async revokeAllForUser(userId: string): Promise<number> {
    const result = await this.prisma.refreshToken.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return result.count;
  }
}

@Injectable()
export class VerificationTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: {
    userId: string;
    purpose: VerificationPurpose;
    tokenHash: string;
    expiresAt: Date;
  }) {
    return this.prisma.verificationToken.create({ data: input });
  }

  findActiveByHash(tokenHash: string) {
    return this.prisma.verificationToken.findFirst({
      where: { tokenHash, consumedAt: null, expiresAt: { gt: new Date() } },
    });
  }

  async consume(id: string): Promise<void> {
    await this.prisma.verificationToken.update({
      where: { id },
      data: { consumedAt: new Date() },
    });
  }
}
