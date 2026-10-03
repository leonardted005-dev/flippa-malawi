import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';

import { PrismaService } from '../../integrations/prisma/prisma.service';

export type OfferRow = Prisma.OfferGetPayload<Record<string, never>>;

@Injectable()
export class OfferRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.offer.findUnique({
      where: { id },
      include: {
        listing: {
          select: {
            id: true,
            sellerId: true,
            currency: true,
            status: true,
            mode: true,
            priceMinor: true,
          },
        },
        buyer: { select: { id: true } },
      },
    });
  }

  /** Listing + seller ownership for offer checks (self-offer, currency, availability). */
  listingContext(listingId: string) {
    return this.prisma.listing.findUnique({
      where: { id: listingId },
      select: {
        id: true,
        sellerId: true,
        currency: true,
        status: true,
        mode: true,
        priceMinor: true,
        seller: { select: { userId: true } },
      },
    });
  }

  /** Updates an offer to a decided status; used for REJECTED/WITHDRAWN. */
  async decideById(
    offerId: string,
    status: 'REJECTED' | 'WITHDRAWN',
    reason: string | undefined,
  ): Promise<OfferRow> {
    return this.prisma.offer.update({
      where: { id: offerId },
      data: { status, decisionReason: reason ?? null },
    });
  }

  sellerForUser(userId: string) {
    return this.prisma.sellerProfile.findFirst({ where: { userId } });
  }

  findByListingAndBuyer(listingId: string, buyerId: string) {
    return this.prisma.offer.findFirst({
      where: { listingId, buyerId, status: 'PLACED' },
      orderBy: { createdAt: 'desc' },
    });
  }

  findByListingKey(listingId: string, idempotencyKey: string) {
    return this.prisma.offer.findUnique({
      where: { listingId_idempotencyKey: { listingId, idempotencyKey } },
    });
  }

  listForBuyer(buyerId: string) {
    return this.prisma.offer.findMany({
      where: { buyerId },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: {
        listing: {
          select: { id: true, priceMinor: true, currency: true, status: true, mode: true },
        },
      },
    });
  }

  async listReceivedForSeller(userId: string) {
    const sellers = await this.prisma.sellerProfile.findMany({
      where: { userId },
      select: { id: true },
    });
    if (sellers.length === 0) {
      return [];
    }
    return this.prisma.offer.findMany({
      where: { listing: { sellerId: { in: sellers.map((seller) => seller.id) } } },
      orderBy: { createdAt: 'desc' },
      take: 100,
      include: { listing: { select: { id: true, status: true, currency: true } } },
    });
  }

  create(input: {
    listingId: string;
    buyerId: string;
    amountMinor: bigint;
    currency: string;
    expiresAt?: Date;
    idempotencyKey?: string;
  }) {
    return this.prisma.offer.create({
      data: {
        listingId: input.listingId,
        buyerId: input.buyerId,
        amountMinor: input.amountMinor,
        currency: input.currency,
        expiresAt: input.expiresAt ?? null,
        idempotencyKey: input.idempotencyKey,
      },
    });
  }

  /**
   * Accepts an offer with the listing row locked (`FOR UPDATE`), so two offers
   * accepted concurrently can never both sell the listing.
   */
  async acceptLocked(
    offerId: string,
    fn: (tx: Prisma.TransactionClient, offer: OfferRow, listingId: string) => Promise<void>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const offer = await tx.offer.findUnique({ where: { id: offerId } });
      if (!offer) {
        throw new NotFoundException({ code: 'OFFER_NOT_FOUND', message: 'Offer not found' });
      }

      const locked = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM listings WHERE id = ${offer.listingId}::uuid FOR UPDATE`;
      if (locked.length === 0) {
        throw new NotFoundException({ code: 'LISTING_NOT_FOUND', message: 'Listing not found' });
      }

      await fn(tx, offer, offer.listingId);
    });
  }
}
