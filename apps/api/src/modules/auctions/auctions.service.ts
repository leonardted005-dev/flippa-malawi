import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  evaluateBid,
  isReserveMet,
  nextEndsAtAfterExtension,
  shouldExtendForAntiSnipe,
  type BidRuleCode,
} from '@fa/domain';

import { AuditService } from '../../common/audit/audit.service';
import type { RequestMeta } from '../../common/http/request-meta';
import type { PlaceBidDto } from './auctions.dto';
import { AuctionRepository, type AuctionRow } from './auctions.repository';

/** Domain rule failures map to the HTTP status a client should act on. */
function ruleToException(code: BidRuleCode, message: string) {
  if (code === 'SELF_BID') {
    return new ForbiddenException({ code, message });
  }
  if (code === 'BID_TOO_LOW' || code === 'BID_NOT_POSITIVE') {
    return new BadRequestException({ code, message });
  }
  return new ConflictException({ code, message });
}

export function toAuctionView(auction: AuctionRow, extra: Record<string, unknown> = {}) {
  return {
    id: auction.id,
    listingId: auction.listingId,
    status: auction.status,
    currentBidMinor: auction.currentBidMinor?.toString() ?? null,
    reserveMinor: auction.reserveMinor?.toString() ?? null,
    bidCount: auction.bidCount,
    endsAt: auction.endsAt.toISOString(),
    lastBidAt: auction.lastBidAt ? auction.lastBidAt.toISOString() : null,
    winnerBuyerId: auction.winnerBuyerId,
    closedAt: auction.closedAt ? auction.closedAt.toISOString() : null,
    version: auction.version,
    ...extra,
  };
}

export function toBidView(
  bid: {
    id: string;
    amountMinor: bigint;
    currency: string;
    status: string;
    placedAt: Date;
    bidderId: string;
  },
  viewer?: { id: string },
) {
  return {
    id: bid.id,
    amountMinor: bid.amountMinor.toString(),
    currency: bid.currency,
    status: bid.status,
    placedAt: bid.placedAt.toISOString(),
    // Public viewers see a stable pseudonym, never a raw account id.
    bidder: viewer && viewer.id === bid.bidderId ? 'you' : `bidder-${bid.bidderId.slice(0, 8)}`,
  };
}

@Injectable()
export class AuctionsService {
  constructor(
    private readonly auctions: AuctionRepository,
    private readonly audit: AuditService,
  ) {}

  async getAuction(auctionId: string): Promise<Record<string, unknown>> {
    const auction = await this.auctions.findById(auctionId);
    if (!auction) {
      throw new NotFoundException({ code: 'AUCTION_NOT_FOUND', message: 'Auction not found' });
    }
    const listing = await this.auctions.listingContext(auction.listingId);
    return toAuctionView(auction, {
      listing: listing
        ? {
            id: listing.id,
            status: listing.status,
            mode: listing.mode,
            currency: listing.currency,
            sellerDisplayName: listing.seller.displayName,
          }
        : null,
    });
  }

  /** Bid history. Never exposes raw bidder ids to the public. */
  async bids(auctionId: string, viewer?: { id: string }): Promise<Record<string, unknown>[]> {
    const auction = await this.auctions.findById(auctionId);
    if (!auction) {
      throw new NotFoundException({ code: 'AUCTION_NOT_FOUND', message: 'Auction not found' });
    }
    const rows = await this.auctions.listBids(auctionId, 50);
    return rows.map((bid) => toBidView(bid, viewer));
  }

  /**
   * Places a bid. ALL validation happens inside the row lock so two concurrent
   * bids cannot both become the current bid (Phase 0.17).
   */
  async placeBid(
    userId: string,
    auctionId: string,
    dto: PlaceBidDto,
    meta: RequestMeta,
    idempotencyKey: string | undefined,
  ): Promise<Record<string, unknown>> {
    const amountMinor = BigInt(dto.amountMinor);

    const result = await this.auctions.withLockedAuction(
      auctionId,
      async (tx, auction): Promise<{ view: Record<string, unknown>; replayed: boolean }> => {
        // Replay fast-path: the same Idempotency-Key returns the original bid.
        if (idempotencyKey) {
          const existing = await tx.bid.findUnique({
            where: { auctionId_idempotencyKey: { auctionId, idempotencyKey } },
          });
          if (existing) {
            return {
              view: { ...toBidView(existing, { id: userId }), replayed: true },
              replayed: true,
            };
          }
        }

        if (auction.status !== 'LIVE') {
          throw new ConflictException({
            code: 'AUCTION_NOT_LIVE',
            message: `Auction is ${auction.status} and is not accepting bids`,
          });
        }

        const listing = await this.auctions.listingForAuction(tx, auction.listingId);
        if (!listing || listing.status !== 'ACTIVE') {
          throw new ConflictException({
            code: 'LISTING_NOT_AVAILABLE',
            message: 'The auction listing is no longer active',
          });
        }

        const evaluation = evaluateBid({
          amountMinor,
          currentBidMinor: auction.currentBidMinor,
          endsAt: auction.endsAt,
          now: new Date(), // server clock only — never the client's
          bidderId: userId,
          sellerId: listing.seller.userId,
        });
        if (!evaluation.ok) {
          throw ruleToException(evaluation.code, evaluation.message);
        }

        try {
          const previousBidId = auction.currentBidId;
          const bid = await tx.bid.create({
            data: {
              auctionId,
              bidderId: userId,
              amountMinor,
              currency: listing.currency ?? 'ZMW',
              idempotencyKey,
              ipHash: meta.ipHash ?? null,
            },
          });

          await tx.auction.update({
            where: { id: auctionId },
            data: {
              currentBidId: bid.id,
              currentBidMinor: amountMinor,
              bidCount: { increment: 1 },
              lastBidAt: bid.placedAt,
              version: { increment: 1 },
            },
          });

          if (previousBidId) {
            await tx.bid.updateMany({
              where: { id: previousBidId, status: 'PLACED' },
              data: { status: 'OUTBID' },
            });
          }

          return {
            view: { ...toBidView(bid, { id: userId }), replayed: false },
            replayed: false,
          };
        } catch (error) {
          // Lost a race on the unique (auctionId, idempotencyKey) constraint.
          const isUnique =
            typeof error === 'object' &&
            error !== null &&
            (error as { code?: string }).code === 'P2002';
          if (isUnique) {
            const existing = await tx.bid.findUnique({
              where: {
                auctionId_idempotencyKey: { auctionId, idempotencyKey: idempotencyKey ?? '' },
              },
            });
            if (existing) {
              return {
                view: { ...toBidView(existing, { id: userId }), replayed: true },
                replayed: true,
              };
            }
          }
          throw error;
        }
      },
    );

    if (!result.replayed) {
      await this.audit.record({
        actorId: userId,
        actorType: 'USER',
        action: 'BID_PLACED',
        entityType: 'Auction',
        entityId: auctionId,
        after: { amountMinor: dto.amountMinor },
        ...meta,
      });
    }

    return result.view;
  }

  /**
   * Closes an auction once the SERVER clock says it ended.
   *
   * - idempotent: a second close returns the current state instead of failing;
   * - anti-snipe: a decisive late bid extends `endsAt` instead of closing;
   * - reserve-aware: winner + listing transition only when the reserve is met.
   */
  async close(
    actorId: string,
    auctionId: string,
    meta: RequestMeta,
  ): Promise<Record<string, unknown>> {
    const outcome = await this.auctions.withLockedAuction(
      auctionId,
      async (tx, auction): Promise<{ view: Record<string, unknown>; event: string | null }> => {
        if (auction.status !== 'LIVE') {
          return { view: toAuctionView(auction), event: null }; // already closed
        }

        const now = new Date();
        if (now.getTime() < auction.endsAt.getTime()) {
          throw new ConflictException({
            code: 'AUCTION_NOT_ENDED',
            message: `Auction ends at ${auction.endsAt.toISOString()}`,
          });
        }

        if (shouldExtendForAntiSnipe(auction.endsAt, auction.lastBidAt, now)) {
          const newEndsAt = nextEndsAtAfterExtension(auction.endsAt, now);
          const updated = await tx.auction.update({
            where: { id: auctionId },
            data: { endsAt: newEndsAt, version: { increment: 1 } },
          });
          await tx.listing.updateMany({
            where: { id: auction.listingId, status: 'ACTIVE' },
            data: { endsAt: newEndsAt, version: { increment: 1 } },
          });
          return { view: toAuctionView(updated), event: 'AUCTION_EXTENDED' };
        }

        const reserveMet = isReserveMet(auction.reserveMinor, auction.currentBidMinor);
        const currentBid =
          auction.currentBidId !== null
            ? await tx.bid.findUnique({ where: { id: auction.currentBidId } })
            : null;
        const winner = reserveMet ? (currentBid?.bidderId ?? null) : null;

        const updated = await tx.auction.update({
          where: { id: auctionId },
          data: {
            status: reserveMet ? 'RESERVE_MET' : 'RESERVE_NOT_MET',
            closedAt: now,
            winnerBuyerId: winner,
            version: { increment: 1 },
          },
        });

        if (reserveMet && auction.currentBidId) {
          await tx.bid.updateMany({
            where: { id: auction.currentBidId, status: 'PLACED' },
            data: { status: 'WON' },
          });
        }

        await tx.listing.updateMany({
          where: { id: auction.listingId, status: 'ACTIVE' },
          data: { status: reserveMet ? 'SOLD' : 'EXPIRED', version: { increment: 1 } },
        });

        return { view: toAuctionView(updated), event: 'AUCTION_CLOSED' };
      },
    );

    if (outcome.event) {
      await this.audit.record({
        actorId,
        actorType: 'USER',
        action: outcome.event,
        entityType: 'Auction',
        entityId: auctionId,
        after: { status: (outcome.view as { status: string }).status },
        ...meta,
      });
    }

    return outcome.view;
  }
}
