import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { AuditService } from '../../common/audit/audit.service';
import type { RequestMeta } from '../../common/http/request-meta';
import { serializeValue } from '../catalog/catalog.mapper';
import { SellerRepository } from '../sellers/sellers.repository';
import type { CreateOfferDto } from './offers.dto';
import { OfferRepository, type OfferRow } from './offers.repository';
export interface OfferViewInput {
  amountMinor: bigint;
  id: string;
  listingId: string;
  currency: string;
  status: string;
  expiresAt: Date | null;
  decisionReason: string | null;
  createdAt: Date;
  listing?: Record<string, unknown> | null;
}

export function toOfferView(offer: OfferViewInput): Record<string, unknown> {
  return {
    id: offer.id,
    listingId: offer.listingId,
    amountMinor: offer.amountMinor.toString(),
    currency: offer.currency,
    status: offer.status,
    expiresAt: offer.expiresAt ? offer.expiresAt.toISOString() : null,
    decisionReason: offer.decisionReason,
    createdAt: offer.createdAt.toISOString(),
    // Nested rows may carry bigint money (e.g. listing.priceMinor).
    listing: offer.listing ? (serializeValue(offer.listing) as Record<string, unknown>) : null,
  };
}

@Injectable()
export class OffersService {
  constructor(
    private readonly offers: OfferRepository,
    private readonly sellers: SellerRepository,
    private readonly audit: AuditService,
  ) {}

  async create(
    userId: string,
    dto: CreateOfferDto,
    idempotencyKey: string | undefined,
    meta: RequestMeta,
  ): Promise<Record<string, unknown>> {
    const listing = await this.offers.listingContext(dto.listingId);
    if (!listing) {
      throw new NotFoundException({ code: 'LISTING_NOT_FOUND', message: 'Listing not found' });
    }
    if (listing.status !== 'ACTIVE') {
      throw new ConflictException({
        code: 'LISTING_NOT_AVAILABLE',
        message: 'Offers require an active listing',
      });
    }
    if (listing.mode !== 'FIXED_PRICE') {
      throw new ConflictException({
        code: 'OFFER_NOT_ALLOWED',
        message: 'Offers are only available on fixed-price listings (use bids for auctions)',
      });
    }

    const sellerUser = await this.sellers.findByUserId(userId);
    if (listing.seller.userId === userId || sellerUser?.id === listing.sellerId) {
      throw new ForbiddenException({
        code: 'SELLER_CANNOT_OFFER',
        message: 'A seller cannot offer on their own listing',
      });
    }
    if (idempotencyKey) {
      const replay = await this.offers.findByListingKey(dto.listingId, idempotencyKey);
      if (replay) {
        return toOfferView(replay);
      }
    }

    const amountMinor = BigInt(dto.amountMinor);
    if (listing.priceMinor !== null && amountMinor >= listing.priceMinor) {
      throw new BadRequestException({
        code: 'OFFER_MUST_BE_BELOW_ASK',
        message: 'An offer must be below the asking price (use buy-now instead)',
      });
    }

    const existing = await this.offers.findByListingAndBuyer(dto.listingId, userId);
    if (existing) {
      throw new ConflictException({
        code: 'OFFER_ALREADY_EXISTS',
        message: 'You already have a pending offer on this listing',
      });
    }

    const offer = await this.offers.create({
      listingId: dto.listingId,
      buyerId: userId,
      amountMinor,
      currency: listing.currency ?? 'ZMW',
      expiresAt: dto.expiresAt ? new Date(dto.expiresAt) : undefined,
      idempotencyKey,
    });

    await this.audit.record({
      actorId: userId,
      actorType: 'USER',
      action: 'OFFER_PLACED',
      entityType: 'Offer',
      entityId: offer.id,
      after: { amountMinor: dto.amountMinor, listingId: dto.listingId },
      ...meta,
    });

    return toOfferView(offer);
  }

  async accept(
    userId: string,
    offerId: string,
    meta: RequestMeta,
  ): Promise<Record<string, unknown>> {
    let decided: OfferRow | undefined;

    await this.offers.acceptLocked(offerId, async (tx, offer) => {
      const listing = await tx.listing.findUnique({
        where: { id: offer.listingId },
        select: { id: true, sellerId: true, status: true },
      });
      const seller = await tx.sellerProfile.findFirst({ where: { userId } });

      if (!listing || !seller || listing.sellerId !== seller.id) {
        throw new NotFoundException({ code: 'OFFER_NOT_FOUND', message: 'Offer not found' });
      }
      if (offer.status !== 'PLACED') {
        throw new ConflictException({
          code: 'OFFER_NOT_DECIDED',
          message: 'Offer is no longer pending',
        });
      }
      if (listing.status !== 'ACTIVE') {
        throw new ConflictException({
          code: 'LISTING_NOT_AVAILABLE',
          message: 'The listing is no longer active',
        });
      }
      if (offer.expiresAt && offer.expiresAt.getTime() <= Date.now()) {
        await tx.offer.updateMany({
          where: { id: offer.id, status: 'PLACED' },
          data: { status: 'EXPIRED' },
        });
        throw new ConflictException({
          code: 'OFFER_EXPIRED',
          message: 'This offer has expired',
        });
      }

      decided = await tx.offer.update({ where: { id: offer.id }, data: { status: 'ACCEPTED' } });
      await tx.listing.updateMany({
        where: { id: offer.listingId, status: 'ACTIVE' },
        data: { status: 'SOLD', version: { increment: 1 } },
      });
      // An accepted offer settles the listing: other pending offers lapse.
      await tx.offer.updateMany({
        where: { listingId: offer.listingId, status: 'PLACED', id: { not: offer.id } },
        data: { status: 'EXPIRED' },
      });
    });

    if (!decided) {
      throw new NotFoundException({ code: 'OFFER_NOT_FOUND', message: 'Offer not found' });
    }

    await this.audit.record({
      actorId: userId,
      actorType: 'USER',
      action: 'OFFER_ACCEPTED',
      entityType: 'Offer',
      entityId: offerId,
      ...meta,
    });

    return toOfferView(decided);
  }

  async reject(
    userId: string,
    offerId: string,
    reason: string | undefined,
    meta: RequestMeta,
  ): Promise<Record<string, unknown>> {
    const decided = await this.decideOffer(userId, offerId, 'REJECTED', reason, meta);
    return toOfferView(decided);
  }

  async withdraw(
    userId: string,
    offerId: string,
    meta: RequestMeta,
  ): Promise<Record<string, unknown>> {
    const offer = await this.offers.findById(offerId);
    if (!offer || offer.buyerId !== userId) {
      throw new NotFoundException({ code: 'OFFER_NOT_FOUND', message: 'Offer not found' });
    }
    if (offer.status !== 'PLACED') {
      throw new ConflictException({
        code: 'OFFER_NOT_DECIDED',
        message: 'Offer is no longer pending',
      });
    }

    const updated = await this.offers.decideById(offerId, 'WITHDRAWN', undefined);
    await this.audit.record({
      actorId: userId,
      actorType: 'USER',
      action: 'OFFER_WITHDRAWN',
      entityType: 'Offer',
      entityId: offerId,
      ...meta,
    });
    return toOfferView(updated);
  }

  async listForBuyerView(buyerId: string) {
    const rows = await this.offers.listForBuyer(buyerId);
    return rows.map((row) => toOfferView(row));
  }

  async listReceivedView(userId: string) {
    const rows = await this.offers.listReceivedForSeller(userId);
    return rows.map((row) => toOfferView(row));
  }

  private async decideOffer(
    userId: string,
    offerId: string,
    status: 'REJECTED',
    reason: string | undefined,
    meta: RequestMeta,
  ): Promise<OfferRow> {
    const offer = await this.offers.findById(offerId);
    const seller = await this.offers.sellerForUser(userId);
    if (!offer || !seller || offer.listing.sellerId !== seller.id) {
      throw new NotFoundException({ code: 'OFFER_NOT_FOUND', message: 'Offer not found' });
    }
    if (offer.status !== 'PLACED') {
      throw new ConflictException({
        code: 'OFFER_NOT_DECIDED',
        message: 'Offer is no longer pending',
      });
    }

    const updated = await this.offers.decideById(offerId, status, reason);
    await this.audit.record({
      actorId: userId,
      actorType: 'USER',
      action: 'OFFER_REJECTED',
      entityType: 'Offer',
      entityId: offerId,
      after: { reason: reason ?? null },
      ...meta,
    });
    return updated;
  }
}
