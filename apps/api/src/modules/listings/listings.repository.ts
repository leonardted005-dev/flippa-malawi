import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { ListingMode, ListingStatus } from '@prisma/client';

import { PrismaService } from '../../integrations/prisma/prisma.service';

export const LISTING_INCLUDE = {
  asset: {
    select: {
      id: true,
      type: true,
      title: true,
      slug: true,
      currency: true,
      country: true,
      status: true,
      verificationStatus: true,
      qualityStatus: true,
    },
  },
  attachments: {
    orderBy: { sort: 'asc' as const },
    include: {
      storageObject: {
        select: {
          id: true,
          key: true,
          contentType: true,
          width: true,
          height: true,
          imageFormat: true,
          scanStatus: true,
        },
      },
    },
  },
} as const;

export type ListingWithRelations = Prisma.ListingGetPayload<{ include: typeof LISTING_INCLUDE }>;

@Injectable()
export class ListingRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.listing.findUnique({ where: { id }, include: LISTING_INCLUDE });
  }

  findByAssetId(assetId: string) {
    return this.prisma.listing.findFirst({
      where: { assetId },
      include: LISTING_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  listBySeller(sellerId: string) {
    return this.prisma.listing.findMany({
      where: { sellerId },
      include: LISTING_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  create(input: {
    assetId: string;
    sellerId: string;
    mode: ListingMode;
    priceMinor?: bigint;
    currency?: string;
    startsAt?: Date;
    endsAt?: Date;
    attachmentIds: string[];
  }) {
    return this.prisma.listing.create({
      data: {
        assetId: input.assetId,
        sellerId: input.sellerId,
        mode: input.mode,
        priceMinor: input.priceMinor ?? null,
        currency: input.currency ?? null,
        startsAt: input.startsAt ?? null,
        endsAt: input.endsAt ?? null,
        attachments: {
          create: input.attachmentIds.map((storageObjectId, index) => ({
            storageObjectId,
            sort: index,
            hero: index === 0,
          })),
        },
      },
      include: LISTING_INCLUDE,
    });
  }

  /** Optimistic concurrency: only updates when the caller's version matches. */
  async updateWithVersion(
    id: string,
    expectedVersion: number,
    data: Prisma.ListingUpdateInput,
  ): Promise<{ updated: boolean }> {
    try {
      await this.prisma.listing.update({
        where: { id, version: expectedVersion },
        data: { ...data, version: { increment: 1 } },
      });
      return { updated: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return { updated: false };
      }
      throw error;
    }
  }

  /**
   * Guarded state transition: only succeeds if the row is still in `from`
   * (DB-level guard on top of the domain state machine).
   */
  async transition(
    id: string,
    from: ListingStatus,
    to: ListingStatus,
    data?: Prisma.ListingUpdateInput,
  ): Promise<ListingWithRelations | null> {
    try {
      return await this.prisma.listing.update({
        where: { id, status: from },
        data: { status: to, version: { increment: 1 }, ...data },
        include: LISTING_INCLUDE,
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return null;
      }
      throw error;
    }
  }

  async replaceAttachments(id: string, storageObjectIds: string[]): Promise<ListingWithRelations> {
    await this.prisma.listingAttachment.deleteMany({ where: { listingId: id } });
    return this.prisma.listing.update({
      where: { id },
      data: {
        version: { increment: 1 },
        attachments: {
          create: storageObjectIds.map((storageObjectId, index) => ({
            storageObjectId,
            sort: index,
            hero: index === 0,
          })),
        },
      },
      include: LISTING_INCLUDE,
    });
  }
}
