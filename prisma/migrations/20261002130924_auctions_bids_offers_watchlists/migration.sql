-- CreateEnum
CREATE TYPE "AuctionStatus" AS ENUM ('LIVE', 'CLOSED', 'RESERVE_MET', 'RESERVE_NOT_MET', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BidStatus" AS ENUM ('PLACED', 'WON', 'OUTBID', 'WITHDRAWN', 'INVALID');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PLACED', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'WITHDRAWN');

-- CreateTable
CREATE TABLE "auctions" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "status" "AuctionStatus" NOT NULL DEFAULT 'LIVE',
    "current_bid_id" UUID,
    "current_bid_minor" BIGINT,
    "reserve_minor" BIGINT,
    "bid_count" INTEGER NOT NULL DEFAULT 0,
    "ends_at" TIMESTAMP(3) NOT NULL,
    "winner_buyer_id" UUID,
    "opened_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closed_at" TIMESTAMP(3),
    "last_bid_at" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "auctions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bids" (
    "id" UUID NOT NULL,
    "auction_id" UUID NOT NULL,
    "bidder_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "BidStatus" NOT NULL DEFAULT 'PLACED',
    "placed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_hash" TEXT,
    "idempotency_key" TEXT,

    CONSTRAINT "bids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "offers" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "amount_minor" BIGINT NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'PLACED',
    "expires_at" TIMESTAMP(3),
    "decision_reason" TEXT,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "offers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchlists" (
    "id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "watchlists_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "watchlist_items" (
    "id" UUID NOT NULL,
    "watchlist_id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "watchlist_items_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "auctions_listing_id_key" ON "auctions"("listing_id");

-- CreateIndex
CREATE INDEX "auctions_status_ends_at_idx" ON "auctions"("status", "ends_at");

-- CreateIndex
CREATE INDEX "bids_auction_id_placed_at_idx" ON "bids"("auction_id", "placed_at");

-- CreateIndex
CREATE UNIQUE INDEX "bids_auction_id_idempotency_key_key" ON "bids"("auction_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "offers_listing_id_status_idx" ON "offers"("listing_id", "status");

-- CreateIndex
CREATE INDEX "offers_buyer_id_status_idx" ON "offers"("buyer_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "offers_listing_id_idempotency_key_key" ON "offers"("listing_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "watchlists_buyer_id_idx" ON "watchlists"("buyer_id");

-- CreateIndex
CREATE UNIQUE INDEX "watchlists_buyer_id_name_key" ON "watchlists"("buyer_id", "name");

-- CreateIndex
CREATE UNIQUE INDEX "watchlist_items_watchlist_id_asset_id_key" ON "watchlist_items"("watchlist_id", "asset_id");

-- AddForeignKey
ALTER TABLE "auctions" ADD CONSTRAINT "auctions_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_auction_id_fkey" FOREIGN KEY ("auction_id") REFERENCES "auctions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_bidder_id_fkey" FOREIGN KEY ("bidder_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "offers" ADD CONSTRAINT "offers_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlists" ADD CONSTRAINT "watchlists_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_watchlist_id_fkey" FOREIGN KEY ("watchlist_id") REFERENCES "watchlists"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "watchlist_items" ADD CONSTRAINT "watchlist_items_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "digital_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
