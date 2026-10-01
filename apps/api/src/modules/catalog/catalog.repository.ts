import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AssetType } from '@fa/domain';

import { PrismaService } from '../../integrations/prisma/prisma.service';

export const METADATA_INCLUDE = {
  software: true,
  website: true,
  mobile: true,
  youtube: true,
  instagram: true,
  game: true,
  domain: true,
} satisfies Prisma.DigitalAssetInclude;

export type AssetWithMetadata = Prisma.DigitalAssetGetPayload<{ include: typeof METADATA_INCLUDE }>;

@Injectable()
export class CategoryRepository {
  constructor(private readonly prisma: PrismaService) {}

  listAll() {
    return this.prisma.category.findMany({ orderBy: [{ sort: 'asc' }, { name: 'asc' }] });
  }

  findBySlug(slug: string) {
    return this.prisma.category.findUnique({ where: { slug }, include: { children: true } });
  }

  findById(id: string) {
    return this.prisma.category.findUnique({ where: { id } });
  }
}

@Injectable()
export class AssetRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.digitalAsset.findFirst({
      where: { id, deletedAt: null },
      include: METADATA_INCLUDE,
    });
  }

  findBySlug(slug: string) {
    return this.prisma.digitalAsset.findFirst({
      where: { slug, deletedAt: null },
      include: METADATA_INCLUDE,
    });
  }

  listBySeller(sellerId: string) {
    return this.prisma.digitalAsset.findMany({
      where: { sellerId, deletedAt: null },
      include: METADATA_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  create(input: {
    type: AssetType;
    slug: string;
    title: string;
    summary?: string;
    sellerId: string;
    country: string;
    currency: string;
    categoryId?: string;
    metadata: Record<string, unknown>;
  }) {
    // `UncheckedCreateInput` allows the scalar `sellerId`/`categoryId` FKs.
    const data = {
      type: input.type,
      slug: input.slug,
      title: input.title,
      summary: input.summary ?? null,
      sellerId: input.sellerId,
      country: input.country,
      currency: input.currency,
      categoryId: input.categoryId ?? null,
      ...input.metadata,
    } as Prisma.DigitalAssetUncheckedCreateInput;

    return this.prisma.digitalAsset.create({ data, include: METADATA_INCLUDE });
  }

  /**
   * Optimistic concurrency check. Returns `{ updated: false }` when the caller's
   * version is stale (Prisma P2025 = no record matched the compound filter).
   * NOTE: nested metadata writes require `update`, not `updateMany`.
   */
  async updateWithVersion(
    id: string,
    expectedVersion: number,
    base: Prisma.DigitalAssetUpdateInput,
    nestedMetadata: Record<string, unknown>,
  ): Promise<{ updated: boolean }> {
    try {
      await this.prisma.digitalAsset.update({
        where: { id, version: expectedVersion },
        data: {
          ...base,
          ...(nestedMetadata as Prisma.DigitalAssetUpdateInput),
          version: { increment: 1 },
        },
      });
      return { updated: true };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2025') {
        return { updated: false };
      }
      throw error;
    }
  }

  setStatus(id: string, status: 'DRAFT' | 'READY' | 'ARCHIVED') {
    return this.prisma.digitalAsset.update({
      where: { id },
      data: { status, version: { increment: 1 } },
      include: METADATA_INCLUDE,
    });
  }
}
