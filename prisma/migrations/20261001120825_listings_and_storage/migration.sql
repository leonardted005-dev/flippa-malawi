-- CreateEnum
CREATE TYPE "ListingMode" AS ENUM ('FIXED_PRICE', 'AUCTION');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'PENDING_REVIEW', 'ACTIVE', 'SOLD', 'PAUSED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "StorageObjectVisibility" AS ENUM ('PRIVATE', 'REVIEW', 'DOWNLOADS');

-- CreateEnum
CREATE TYPE "StorageObjectScanStatus" AS ENUM ('PENDING', 'CLEAN', 'QUARANTINED', 'ERROR');

-- CreateTable
CREATE TABLE "listings" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "mode" "ListingMode" NOT NULL DEFAULT 'FIXED_PRICE',
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "price_minor" BIGINT,
    "currency" CHAR(3),
    "starts_at" TIMESTAMP(3),
    "ends_at" TIMESTAMP(3),
    "published_at" TIMESTAMP(3),
    "featured_until" TIMESTAMP(3),
    "rejection_reason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "storage_objects" (
    "id" UUID NOT NULL,
    "bucket" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "owner_type" TEXT NOT NULL,
    "owner_id" UUID NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" BIGINT NOT NULL,
    "sha256" TEXT,
    "content_sha256" TEXT,
    "visibility" "StorageObjectVisibility" NOT NULL DEFAULT 'PRIVATE',
    "scan_status" "StorageObjectScanStatus" NOT NULL DEFAULT 'PENDING',
    "width" INTEGER,
    "height" INTEGER,
    "image_format" TEXT,
    "retention_until" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "storage_objects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_attachments" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "storage_object_id" UUID NOT NULL,
    "sort" INTEGER NOT NULL DEFAULT 0,
    "caption" TEXT,
    "hero" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_attachments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "listings_seller_id_idx" ON "listings"("seller_id");

-- CreateIndex
CREATE INDEX "listings_asset_id_idx" ON "listings"("asset_id");

-- CreateIndex
CREATE INDEX "listings_status_ends_at_idx" ON "listings"("status", "ends_at");

-- CreateIndex
CREATE INDEX "storage_objects_owner_type_owner_id_idx" ON "storage_objects"("owner_type", "owner_id");

-- CreateIndex
CREATE INDEX "storage_objects_scan_status_idx" ON "storage_objects"("scan_status");

-- CreateIndex
CREATE UNIQUE INDEX "storage_objects_bucket_key_key" ON "storage_objects"("bucket", "key");

-- CreateIndex
CREATE UNIQUE INDEX "listing_attachments_listing_id_storage_object_id_key" ON "listing_attachments"("listing_id", "storage_object_id");

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "digital_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listings" ADD CONSTRAINT "listings_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "seller_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_attachments" ADD CONSTRAINT "listing_attachments_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "listings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_attachments" ADD CONSTRAINT "listing_attachments_storage_object_id_fkey" FOREIGN KEY ("storage_object_id") REFERENCES "storage_objects"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
