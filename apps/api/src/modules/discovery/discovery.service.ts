import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { AppEnv } from '@fa/config';
import type { ObjectStorage } from '@fa/domain';

import { APP_ENV } from '../../common/config/config.module';
import { OBJECT_STORAGE } from '../../common/tokens';
import { serializeValue } from '../catalog/catalog.mapper';
import type { DiscoveryQueryDto } from './discovery.dto';
import { pickMetadata, toListingCardView } from './discovery.mapper';
import { DiscoveryRepository, type DiscoveryListing } from './discovery.repository';

@Injectable()
export class DiscoveryService {
  constructor(
    private readonly repo: DiscoveryRepository,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  async browse(dto: DiscoveryQueryDto): Promise<Record<string, unknown>> {
    const where = await this.buildWhere(dto);
    const { rows, hasMore } = await this.repo.browse(where, dto);
    const results = await Promise.all(rows.map((row) => this.toCard(row)));

    const lastId = results.length > 0 ? (results[results.length - 1]?.['id'] as string) : null;
    return {
      results,
      pageInfo: {
        limit: dto.limit,
        hasMore,
        nextCursor: hasMore ? lastId : null,
        sort: dto.sort,
      },
    };
  }

  /** Public detail: only ACTIVE listings exist for anonymous visitors. */
  async detail(listingId: string): Promise<Record<string, unknown>> {
    const listing = await this.repo.findById(listingId);
    if (!listing || listing.status !== 'ACTIVE') {
      throw new NotFoundException({ code: 'LISTING_NOT_FOUND', message: 'Listing not found' });
    }

    const card = (await this.toCard(listing)) as Record<string, unknown>;
    const asset = listing.asset as unknown as Record<string, unknown>;
    const attachments = await Promise.all(
      listing.attachments.map(async (attachment) => ({
        id: attachment.id,
        sort: attachment.sort,
        hero: attachment.hero,
        caption: attachment.caption,
        width: attachment.storageObject.width,
        height: attachment.storageObject.height,
        format: attachment.storageObject.imageFormat,
        url: (
          await this.storage.createSignedDownloadUrl(
            attachment.storageObject.key,
            this.env.STORAGE_SIGNED_URL_TTL,
          )
        ).url,
      })),
    );

    return {
      ...card,
      asset: {
        ...(card['asset'] as Record<string, unknown>),
        summary: asset['summary'] ?? null,
        categoryId: asset['categoryId'] ?? null,
      },
      metadata: serializeValue(pickMetadata(asset) ?? {}),
      attachments,
      rejectionReason: listing.rejectionReason ?? null,
    };
  }

  private async buildWhere(dto: DiscoveryQueryDto): Promise<Prisma.ListingWhereInput> {
    const where: Prisma.ListingWhereInput = { status: 'ACTIVE' };

    if (dto.mode) {
      where.mode = dto.mode;
    }
    if (dto.minPriceMinor !== undefined || dto.maxPriceMinor !== undefined) {
      where.priceMinor = {
        ...(dto.minPriceMinor !== undefined ? { gte: BigInt(dto.minPriceMinor) } : {}),
        ...(dto.maxPriceMinor !== undefined ? { lte: BigInt(dto.maxPriceMinor) } : {}),
      };
    }
    if (dto.endingSoonHours !== undefined) {
      const now = Date.now();
      where.endsAt = {
        gte: new Date(now),
        lte: new Date(now + dto.endingSoonHours * 3_600_000),
      };
    }
    if (dto.featured !== undefined) {
      where.featuredUntil = dto.featured ? { gt: new Date() } : null;
    }

    const asset: Prisma.DigitalAssetWhereInput = {};
    if (dto.assetType) {
      asset.type = dto.assetType;
    }
    if (dto.country) {
      asset.country = dto.country;
    }
    if (dto.currency) {
      asset.currency = dto.currency;
    }
    if (dto.verificationStatus) {
      asset.verificationStatus = dto.verificationStatus;
    }
    if (dto.qualityStatus) {
      asset.qualityStatus = dto.qualityStatus;
    }
    if (dto.q) {
      asset.OR = [
        { title: { contains: dto.q, mode: 'insensitive' } },
        { summary: { contains: dto.q, mode: 'insensitive' } },
      ];
    }
    if (dto.categorySlug) {
      const ids = await this.repo.resolveCategoryIds(dto.categorySlug);
      if (!ids) {
        throw new BadRequestException({
          code: 'CATEGORY_NOT_FOUND',
          message: `Unknown category "${dto.categorySlug}"`,
        });
      }
      asset.categoryId = { in: ids };
    }

    if (Object.keys(asset).length > 0) {
      where.asset = asset;
    }
    return where;
  }

  private async toCard(listing: DiscoveryListing): Promise<Record<string, unknown>> {
    const card = toListingCardView(listing as unknown as Record<string, unknown>);
    const first = listing.attachments[0];
    if (first) {
      const signed = await this.storage.createSignedDownloadUrl(
        first.storageObject.key,
        this.env.STORAGE_SIGNED_URL_TTL,
      );
      card['heroImageUrl'] = signed.url;
    } else {
      card['heroImageUrl'] = null;
    }
    return card;
  }
}
