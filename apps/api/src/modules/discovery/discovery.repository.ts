import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../integrations/prisma/prisma.service';
import { METADATA_INCLUDE } from '../catalog/catalog.repository';
import type { DiscoveryQueryDto } from './discovery.dto';

/** Read-model include: everything a public listing card/detail needs. */
export const DISCOVERY_INCLUDE = {
  asset: { include: METADATA_INCLUDE },
  seller: {
    select: {
      id: true,
      displayName: true,
      tierCode: true,
      country: true,
      ratingAvgBp: true,
      ratingCount: true,
    },
  },
  attachments: {
    orderBy: { sort: 'asc' as const },
    take: 1,
    include: {
      storageObject: {
        select: { id: true, key: true, width: true, height: true, imageFormat: true },
      },
    },
  },
} as const;

export type DiscoveryListing = Prisma.ListingGetPayload<{ include: typeof DISCOVERY_INCLUDE }>;

/**
 * Deterministic sort orders. Each ends with `id` as a tiebreaker so cursor
 * pagination (Prisma `cursor` + `skip: 1`) cannot skip or repeat rows.
 */
const ORDERS: Record<DiscoveryQueryDto['sort'], Prisma.ListingOrderByWithRelationInput[]> = {
  newest: [{ publishedAt: { sort: 'desc', nulls: 'last' } }, { createdAt: 'desc' }, { id: 'desc' }],
  ending_soon: [{ endsAt: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
  price_asc: [{ priceMinor: { sort: 'asc', nulls: 'last' } }, { id: 'asc' }],
  price_desc: [{ priceMinor: { sort: 'desc', nulls: 'last' } }, { id: 'desc' }],
};

@Injectable()
export class DiscoveryRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Resolves a category slug to itself + direct children (seeded taxonomy is 2 levels). */
  async resolveCategoryIds(slug: string): Promise<string[] | null> {
    const category = await this.prisma.category.findUnique({ where: { slug } });
    if (!category) {
      return null;
    }
    const children = await this.prisma.category.findMany({
      where: { parentId: category.id },
      select: { id: true },
    });
    return [category.id, ...children.map((child) => child.id)];
  }

  async findById(id: string): Promise<DiscoveryListing | null> {
    return this.prisma.listing.findUnique({ where: { id }, include: DISCOVERY_INCLUDE });
  }

  async browse(
    where: Prisma.ListingWhereInput,
    dto: DiscoveryQueryDto,
  ): Promise<{ rows: DiscoveryListing[]; hasMore: boolean }> {
    const rows = await this.prisma.listing.findMany({
      where,
      orderBy: ORDERS[dto.sort],
      take: dto.limit + 1, // +1 to detect a next page
      ...(dto.cursor ? { cursor: { id: dto.cursor }, skip: 1 } : {}),
      include: DISCOVERY_INCLUDE,
    });

    const hasMore = rows.length > dto.limit;
    return { rows: hasMore ? rows.slice(0, dto.limit) : rows, hasMore };
  }
}
