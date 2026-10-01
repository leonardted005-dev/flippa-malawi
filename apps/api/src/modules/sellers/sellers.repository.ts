import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../integrations/prisma/prisma.service';

@Injectable()
export class TierRepository {
  constructor(private readonly prisma: PrismaService) {}

  list() {
    return this.prisma.sellerTier.findMany({ orderBy: { code: 'asc' } });
  }

  findByCode(code: string) {
    return this.prisma.sellerTier.findUnique({ where: { code } });
  }
}

@Injectable()
export class SellerRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByUserId(userId: string) {
    return this.prisma.sellerProfile.findUnique({ where: { userId } });
  }

  findById(id: string) {
    return this.prisma.sellerProfile.findUnique({ where: { id } });
  }

  create(input: {
    userId: string;
    displayName: string;
    country: string;
    tierCode: string;
    payoutCurrency?: string;
  }) {
    return this.prisma.sellerProfile.create({
      data: {
        userId: input.userId,
        displayName: input.displayName,
        country: input.country,
        tierCode: input.tierCode,
        payoutCurrency: input.payoutCurrency ?? null,
      },
    });
  }

  /** Optimistic concurrency: only updates when the caller's version matches. */
  updateWithVersion(
    id: string,
    expectedVersion: number,
    data: { displayName?: string; country?: string; payoutCurrency?: string },
  ) {
    return this.prisma.sellerProfile.updateMany({
      where: { id, version: expectedVersion },
      data: { ...data, version: { increment: 1 } },
    });
  }

  changeTier(id: string, tierCode: string) {
    return this.prisma.sellerProfile.update({
      where: { id },
      data: { tierCode, version: { increment: 1 } },
    });
  }
}

@Injectable()
export class PayoutAccountRepository {
  constructor(private readonly prisma: PrismaService) {}

  listBySeller(sellerId: string) {
    return this.prisma.payoutAccount.findMany({
      where: { sellerId },
      orderBy: { createdAt: 'desc' },
    });
  }

  create(input: {
    sellerId: string;
    provider: string;
    accountRefEnc: string;
    accountRefLast4: string;
    country: string;
    currency: string;
  }) {
    return this.prisma.payoutAccount.create({ data: input });
  }
}
