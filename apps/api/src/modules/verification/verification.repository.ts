import { Injectable } from '@nestjs/common';

import { PrismaService } from '../../integrations/prisma/prisma.service';

@Injectable()
export class VerificationRepository {
  constructor(private readonly prisma: PrismaService) {}

  get client() {
    return this.prisma;
  }

  findCaseById(id: string) {
    return this.prisma.verificationCase.findUnique({
      where: { id },
      include: { asset: true, seller: true, challenge: true },
    });
  }

  listOpenCasesForAsset(assetId: string) {
    return this.prisma.verificationCase.findMany({
      where: { assetId, status: { in: ['OPEN', 'SUBMITTED'] } },
    });
  }

  listOpenCasesForSeller(sellerId: string) {
    return this.prisma.verificationCase.findMany({
      where: { sellerId, status: { in: ['OPEN', 'SUBMITTED'] } },
    });
  }

  listCasesForAsset(assetId: string) {
    return this.prisma.verificationCase.findMany({
      where: { assetId },
      orderBy: { createdAt: 'desc' },
      take: 20,
    });
  }

  latestTerminalCaseForAsset(assetId: string) {
    return this.prisma.verificationCase.findFirst({
      where: { assetId, status: { in: ['APPROVED', 'REJECTED'] } },
      orderBy: { decidedAt: 'desc' },
    });
  }

  adminQueue(status: 'OPEN' | 'SUBMITTED' | undefined, limit: number, cursor?: string) {
    return this.prisma.verificationCase.findMany({
      where: status ? { status } : { status: { in: ['OPEN', 'SUBMITTED'] } },
      orderBy: { createdAt: 'asc' },
      take: limit + 1,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      include: { asset: { select: { id: true, type: true, title: true } }, seller: true },
    });
  }
}
