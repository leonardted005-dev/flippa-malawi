import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../integrations/prisma/prisma.service';

export type Tx = Prisma.TransactionClient;
export type AuctionRow = Prisma.AuctionGetPayload<Record<string, never>>;

export const BID_INCLUDE = {
  bidder: { select: { id: true } },
} as const;

export type BidWithBidder = Prisma.BidGetPayload<{ include: typeof BID_INCLUDE }>;

@Injectable()
export class AuctionRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.auction.findUnique({ where: { id } });
  }

  findByListingId(listingId: string) {
    return this.prisma.auction.findUnique({ where: { listingId } });
  }

  async createForListing(
    listingId: string,
    input: { endsAt: Date; reserveMinor: bigint | null },
  ): Promise<AuctionRow | null> {
    const existing = await this.prisma.auction.findUnique({ where: { listingId } });
    if (existing) {
      return existing; // approving twice must not create a second auction
    }
    return this.prisma.auction.create({
      data: { listingId, endsAt: input.endsAt, reserveMinor: input.reserveMinor },
    });
  }

  async cancel(auctionId: string): Promise<void> {
    await this.prisma.auction.updateMany({
      where: { id: auctionId, status: 'LIVE' },
      data: { status: 'CANCELLED', closedAt: new Date(), version: { increment: 1 } },
    });
  }

  /**
   * Serialises every write for ONE auction using `SELECT ... FOR UPDATE`.
   *
   * This is the mechanism Phase 0.17 requires: the lock is taken first, then
   * the row is re-read with the ORM, then `fn` runs in the same transaction so
   * validation and the resulting writes are atomic and mutually exclusive.
   * Concurrent bids therefore cannot both become the "current bid".
   */
  async withLockedAuction<T>(
    auctionId: string,
    fn: (tx: Tx, auction: AuctionRow) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM auctions WHERE id = ${auctionId}::uuid FOR UPDATE`;

      if (locked.length === 0) {
        throw new NotFoundException({ code: 'AUCTION_NOT_FOUND', message: 'Auction not found' });
      }

      const auction = await tx.auction.findUniqueOrThrow({ where: { id: auctionId } });
      return fn(tx, auction);
    });
  }

  listBids(auctionId: string, take: number) {
    return this.prisma.bid.findMany({
      where: { auctionId },
      orderBy: { placedAt: 'desc' },
      take,
      include: BID_INCLUDE,
    });
  }

  async findOpenOffer(auctionId: string) {
    return this.prisma.bid.findFirst({
      where: { auctionId, status: 'PLACED' },
      orderBy: { placedAt: 'desc' },
      include: BID_INCLUDE,
    });
  }

  /** Listing + seller ownership, used for the self-bid check and currency. */
  listingForAuction(tx: Tx, listingId: string) {
    return tx.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        sellerId: true,
        currency: true,
        status: true,
        mode: true,
        seller: { select: { userId: true, displayName: true } },
      },
    });
  }

  /** Same lookup outside a transaction (reads only). */
  listingContext(listingId: string) {
    return this.listingForAuction(this.prisma, listingId);
  }
}
