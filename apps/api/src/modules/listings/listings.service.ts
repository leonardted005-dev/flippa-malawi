import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ListingMode, ListingStatus } from '@prisma/client';
import { assertListingTransition, ListingTransitionError } from '@fa/domain';

import { AuditService } from '../../common/audit/audit.service';
import type { RequestMeta } from '../../common/http/request-meta';
import { IdempotencyService } from '../../common/idempotency/idempotency.service';
import { AssetRepository } from '../catalog/catalog.repository';
import { SellerRepository } from '../sellers/sellers.repository';
import { StorageObjectRepository } from '../uploads/uploads.repository';
import type { ApiCreateListingDto, ApiUpdateListingDto } from './listings.dto';
import { ListingRepository, type ListingWithRelations } from './listings.repository';
import { serializeValue } from '../catalog/catalog.mapper';

const MAX_ATTACHMENTS = 10;
/** Statuses that occupy an asset (blocks a second concurrent listing). */
const OCCUPYING: ListingStatus[] = ['DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'PAUSED', 'SOLD'];

@Injectable()
export class ListingsService {
  constructor(
    private readonly listings: ListingRepository,
    private readonly assets: AssetRepository,
    private readonly objects: StorageObjectRepository,
    private readonly sellers: SellerRepository,
    private readonly audit: AuditService,
    private readonly idempotency: IdempotencyService,
  ) {}

  async create(
    userId: string,
    dto: ApiCreateListingDto,
    idempotencyKey: string | undefined,
    meta: RequestMeta,
  ): Promise<Record<string, unknown>> {
    const seller = await this.requireSeller(userId);
    const asset = await this.requireOwnedAsset(seller.id, dto.assetId);
    if (asset.status !== 'READY') {
      throw new ConflictException({
        code: 'ASSET_NOT_READY',
        message: 'Only READY assets can be listed (publish the asset first)',
      });
    }

    const existing = await this.listings.findByAssetId(asset.id);
    if (existing && OCCUPYING.includes(existing.status)) {
      throw new ConflictException({
        code: 'ASSET_ALREADY_LISTED',
        message: 'This asset already has a listing that is not withdrawn, expired or sold',
      });
    }

    if (dto.currency && dto.currency !== asset.currency) {
      throw new BadRequestException({
        code: 'CURRENCY_MISMATCH',
        message: `Listing currency must match the asset currency (${asset.currency})`,
      });
    }

    const endsAt = dto.endsAt ? new Date(dto.endsAt) : undefined;
    if (endsAt && endsAt.getTime() <= Date.now()) {
      throw new BadRequestException({
        code: 'LISTING_END_PAST',
        message: 'endsAt must be in the future',
      });
    }

    const attachmentIds = await this.resolveAttachments(userId, dto.attachmentIds);

    const result = await this.idempotency.run(
      `listings:create:${userId}`,
      idempotencyKey,
      IdempotencyService.hashRequest(dto),
      async () => {
        const listing = await this.listings.create({
          assetId: asset.id,
          sellerId: seller.id,
          mode: dto.mode as ListingMode,
          priceMinor: dto.priceMinor !== undefined ? BigInt(dto.priceMinor) : undefined,
          currency: dto.currency ?? asset.currency,
          startsAt: dto.startsAt ? new Date(dto.startsAt) : undefined,
          endsAt,
          attachmentIds,
        });

        await this.audit.record({
          actorId: userId,
          actorType: 'USER',
          action: 'LISTING_CREATED',
          entityType: 'Listing',
          entityId: listing.id,
          after: { mode: listing.mode, assetId: listing.assetId, status: listing.status },
          ...meta,
        });

        return { statusCode: 201, body: toListingView(listing) };
      },
    );

    return result.body;
  }

  async update(
    userId: string,
    listingId: string,
    dto: ApiUpdateListingDto,
    meta: RequestMeta,
  ): Promise<Record<string, unknown>> {
    const listing = await this.requireOwnedListing(userId, listingId);
    if (listing.status !== 'DRAFT') {
      throw new ConflictException({
        code: 'LISTING_NOT_EDITABLE',
        message: 'Only DRAFT listings can be edited (withdraw first if published)',
      });
    }

    const data: Record<string, unknown> = {};
    if (dto.priceMinor !== undefined) {
      data['priceMinor'] = BigInt(dto.priceMinor);
    }
    if (dto.currency !== undefined) {
      if (dto.currency !== listing.asset.currency) {
        throw new BadRequestException({
          code: 'CURRENCY_MISMATCH',
          message: `Listing currency must match the asset currency (${listing.asset.currency})`,
        });
      }
      data['currency'] = dto.currency;
    }
    if (dto.startsAt !== undefined) {
      data['startsAt'] = new Date(dto.startsAt);
    }
    if (dto.endsAt !== undefined) {
      const endsAt = dto.endsAt === null ? null : new Date(dto.endsAt);
      if (endsAt instanceof Date && endsAt.getTime() <= Date.now()) {
        throw new BadRequestException({
          code: 'LISTING_END_PAST',
          message: 'endsAt must be in the future',
        });
      }
      data['endsAt'] = endsAt;
    }

    if (dto.attachmentIds !== undefined) {
      const attachmentIds = await this.resolveAttachments(userId, dto.attachmentIds);
      data['attachments'] = {
        deleteMany: {},
        create: attachmentIds.map((storageObjectId, index) => ({
          storageObjectId,
          sort: index,
          hero: index === 0,
        })),
      };
    }

    const updated = await this.listings.updateWithVersion(
      listing.id,
      dto.expectedVersion,
      data as never,
    );
    if (!updated.updated) {
      throw new ConflictException({
        code: 'VERSION_MISMATCH',
        message: 'Listing was modified by another request; reload and retry',
      });
    }

    const next = await this.listings.findById(listing.id);
    if (!next) {
      throw new NotFoundException({ code: 'LISTING_NOT_FOUND', message: 'Listing not found' });
    }

    await this.audit.record({
      actorId: userId,
      actorType: 'USER',
      action: 'LISTING_UPDATED',
      entityType: 'Listing',
      entityId: next.id,
      before: { priceMinor: listing.priceMinor?.toString() ?? null, status: listing.status },
      after: { priceMinor: next.priceMinor?.toString() ?? null, status: next.status },
      ...meta,
    });

    return toListingView(next);
  }

  /** Seller action: DRAFT -> PENDING_REVIEW (enforces mode-specific requirements). */
  async submit(userId: string, listingId: string, meta: RequestMeta) {
    const listing = await this.requireOwnedListing(userId, listingId);

    if (listing.mode === 'FIXED_PRICE' && listing.priceMinor === null) {
      throw new BadRequestException({
        code: 'LISTING_PRICE_REQUIRED',
        message: 'A fixed-price listing requires a positive priceMinor before submission',
      });
    }
    if (listing.mode === 'AUCTION') {
      if (!listing.endsAt) {
        throw new BadRequestException({
          code: 'LISTING_END_REQUIRED',
          message: 'An auction listing requires endsAt before submission',
        });
      }
      if (listing.endsAt.getTime() <= Date.now()) {
        throw new BadRequestException({
          code: 'LISTING_END_PAST',
          message: 'endsAt must be in the future',
        });
      }
    }
    if (listing.attachments.length > MAX_ATTACHMENTS) {
      throw new BadRequestException({
        code: 'TOO_MANY_ATTACHMENTS',
        message: `A listing may have at most ${MAX_ATTACHMENTS} attachments`,
      });
    }

    return this.performTransition(userId, listing, 'PENDING_REVIEW', 'LISTING_SUBMITTED', meta);
  }

  async withdraw(userId: string, listingId: string, meta: RequestMeta) {
    const listing = await this.requireOwnedListing(userId, listingId);
    return this.performTransition(userId, listing, 'WITHDRAWN', 'LISTING_WITHDRAWN', meta);
  }

  async pause(userId: string, listingId: string, meta: RequestMeta) {
    const listing = await this.requireOwnedListing(userId, listingId);
    return this.performTransition(userId, listing, 'PAUSED', 'LISTING_PAUSED', meta);
  }

  async resume(userId: string, listingId: string, meta: RequestMeta) {
    const listing = await this.requireOwnedListing(userId, listingId);
    return this.performTransition(userId, listing, 'ACTIVE', 'LISTING_RESUMED', meta);
  }

  /** Admin: PENDING_REVIEW -> ACTIVE (publication). */
  async approve(actorId: string, listingId: string, meta: RequestMeta) {
    const listing = await this.requireListing(listingId);
    return this.performTransition(
      actorId,
      listing,
      'ACTIVE',
      'LISTING_APPROVED',
      meta,
      { publishedAt: new Date() },
      'ADMIN',
    );
  }

  /** Admin: PENDING_REVIEW -> DRAFT with a reason (never silent). */
  async reject(actorId: string, listingId: string, reason: string, meta: RequestMeta) {
    const listing = await this.requireListing(listingId);
    return this.performTransition(
      actorId,
      listing,
      'DRAFT',
      'LISTING_REJECTED',
      meta,
      { rejectionReason: reason },
      'ADMIN',
    );
  }

  async getListing(
    listingId: string,
    requester: { id: string; roles: string[] },
  ): Promise<Record<string, unknown>> {
    const listing = await this.requireListing(listingId);
    const isAdmin = requester.roles.includes('ADMIN');
    const visible =
      isAdmin ||
      listing.sellerId === requester.id ||
      ['ACTIVE', 'SOLD', 'EXPIRED'].includes(listing.status);
    if (!visible) {
      throw new NotFoundException({ code: 'LISTING_NOT_FOUND', message: 'Listing not found' });
    }
    return toListingView(listing);
  }

  async myListings(userId: string): Promise<Record<string, unknown>[]> {
    const seller = await this.requireSeller(userId);
    const rows = await this.listings.listBySeller(seller.id);
    return rows.map(toListingView);
  }

  private async performTransition(
    actorId: string,
    listing: ListingWithRelations,
    to: ListingStatus,
    action: string,
    meta: RequestMeta,
    data?: Record<string, unknown>,
    actorType: 'USER' | 'ADMIN' = 'USER',
  ): Promise<Record<string, unknown>> {
    const from = listing.status;
    try {
      assertListingTransition(from, to);
    } catch (error) {
      if (error instanceof ListingTransitionError) {
        throw new ConflictException({
          code: 'INVALID_TRANSITION',
          message: error.message,
        });
      }
      throw error;
    }

    const updated = await this.listings.transition(listing.id, from, to, (data ?? {}) as never);
    if (!updated) {
      throw new ConflictException({
        code: 'STATE_CHANGED',
        message: `Listing is no longer in status ${from}; reload and retry`,
      });
    }

    await this.audit.record({
      actorId,
      actorType,
      action,
      entityType: 'Listing',
      entityId: listing.id,
      before: { status: from },
      after: { status: to, ...(data ?? {}) },
      ...meta,
    });

    return toListingView(updated);
  }

  private async requireSeller(userId: string) {
    const seller = await this.sellers.findByUserId(userId);
    if (!seller) {
      throw new ConflictException({
        code: 'SELLER_PROFILE_REQUIRED',
        message: 'Create a seller profile before managing listings',
      });
    }
    return seller;
  }

  private async requireOwnedAsset(sellerId: string, assetId: string) {
    const asset = await this.assets.findById(assetId);
    if (!asset || asset.sellerId !== sellerId) {
      throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: 'Asset not found' });
    }
    return asset;
  }

  private async requireListing(listingId: string) {
    const listing = await this.listings.findById(listingId);
    if (!listing) {
      throw new NotFoundException({ code: 'LISTING_NOT_FOUND', message: 'Listing not found' });
    }
    return listing;
  }

  /** IDOR-safe: an inaccessible listing is reported as 404, not 403/409. */
  private async requireOwnedListing(userId: string, listingId: string) {
    // Fetch first so missing/foreign listings always surface as 404, even when
    // the caller has no seller profile of their own.
    const listing = await this.requireListing(listingId);
    const seller = await this.sellers.findByUserId(userId);
    if (!seller || listing.sellerId !== seller.id) {
      throw new NotFoundException({ code: 'LISTING_NOT_FOUND', message: 'Listing not found' });
    }
    return listing;
  }

  /** Verifies each attachment is the seller's own, not quarantined, and unique. */
  private async resolveAttachments(userId: string, ids: string[]): Promise<string[]> {
    if (ids.length > MAX_ATTACHMENTS) {
      throw new BadRequestException({
        code: 'TOO_MANY_ATTACHMENTS',
        message: `A listing may have at most ${MAX_ATTACHMENTS} attachments`,
      });
    }
    const unique = [...new Set(ids)];
    const seller = await this.sellers.findByUserId(userId);
    if (!seller) {
      throw new ConflictException({
        code: 'SELLER_PROFILE_REQUIRED',
        message: 'Create a seller profile before managing listings',
      });
    }

    for (const id of unique) {
      const object = await this.objects.findById(id);
      if (!object || object.ownerType !== 'SELLER' || object.ownerId !== seller.id) {
        throw new BadRequestException({
          code: 'ATTACHMENT_NOT_AVAILABLE',
          message: 'One or more attachments are unavailable',
        });
      }
      if (object.scanStatus === 'QUARANTINED') {
        throw new BadRequestException({
          code: 'ATTACHMENT_QUARANTINED',
          message: 'One or more attachments failed malware scanning',
        });
      }
    }
    return unique;
  }
}

/** JSON-safe listing projection (bigint + Date handled by serializeValue). */
export function toListingView(listing: ListingWithRelations): Record<string, unknown> {
  const { asset, attachments, ...rest } = listing;
  return {
    ...(serializeValue(rest) as Record<string, unknown>),
    asset,
    attachments: attachments.map((attachment) => ({
      id: attachment.id,
      sort: attachment.sort,
      hero: attachment.hero,
      caption: attachment.caption,
      storageObject: serializeValue(attachment.storageObject),
    })),
  };
}
