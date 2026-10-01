-- CreateEnum
CREATE TYPE "AssetType" AS ENUM ('SOFTWARE', 'WEBSITE', 'MOBILE_APP', 'YOUTUBE_CHANNEL', 'INSTAGRAM_PROFILE', 'GAME_ACCOUNT', 'DOMAIN', 'OTHER');

-- CreateEnum
CREATE TYPE "AssetStatus" AS ENUM ('DRAFT', 'READY', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "VerificationStatus" AS ENUM ('UNVERIFIED', 'IN_REVIEW', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "QualityStatus" AS ENUM ('PENDING', 'PASS', 'REVIEW', 'FAIL');

-- CreateTable
CREATE TABLE "categories" (
    "id" UUID NOT NULL,
    "parent_id" UUID,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "asset_types" "AssetType"[],
    "sort" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "digital_assets" (
    "id" UUID NOT NULL,
    "type" "AssetType" NOT NULL,
    "slug" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "summary" TEXT,
    "seller_id" UUID NOT NULL,
    "country" CHAR(2) NOT NULL,
    "currency" CHAR(3) NOT NULL,
    "category_id" UUID,
    "status" "AssetStatus" NOT NULL DEFAULT 'DRAFT',
    "verification_status" "VerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "quality_status" "QualityStatus" NOT NULL DEFAULT 'PENDING',
    "extra" JSONB NOT NULL DEFAULT '{}',
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),

    CONSTRAINT "digital_assets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "asset_metadata_software" (
    "asset_id" UUID NOT NULL,
    "language" TEXT,
    "framework" TEXT,
    "runtime" TEXT,
    "source_repo" TEXT,
    "package_size_bytes" BIGINT NOT NULL,
    "dependency_count" INTEGER NOT NULL DEFAULT 0,
    "license_spdx" TEXT,
    "license_findings_json" JSONB NOT NULL DEFAULT '[]',
    "security_findings_json" JSONB NOT NULL DEFAULT '[]',
    "quality_score" INTEGER,

    CONSTRAINT "asset_metadata_software_pkey" PRIMARY KEY ("asset_id")
);

-- CreateTable
CREATE TABLE "asset_metadata_website" (
    "asset_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "monthly_traffic" INTEGER,
    "technology" JSONB NOT NULL DEFAULT '[]',
    "hosting" TEXT,
    "monthly_revenue_minor" BIGINT,
    "revenue_currency" CHAR(3),
    "analytics_verified" BOOLEAN NOT NULL DEFAULT false,
    "analytics_provider" TEXT,

    CONSTRAINT "asset_metadata_website_pkey" PRIMARY KEY ("asset_id")
);

-- CreateTable
CREATE TABLE "asset_metadata_mobile" (
    "asset_id" UUID NOT NULL,
    "platforms" JSONB NOT NULL DEFAULT '[]',
    "bundle_id" TEXT,
    "store_links" JSONB NOT NULL DEFAULT '[]',
    "installs" INTEGER,
    "monthly_revenue_minor" BIGINT,
    "revenue_currency" CHAR(3),
    "app_version" TEXT,

    CONSTRAINT "asset_metadata_mobile_pkey" PRIMARY KEY ("asset_id")
);

-- CreateTable
CREATE TABLE "asset_metadata_youtube" (
    "asset_id" UUID NOT NULL,
    "channel_id" TEXT NOT NULL,
    "subscribers" INTEGER,
    "total_views" BIGINT,
    "video_count" INTEGER,
    "channel_age_days" INTEGER,
    "monetized" BOOLEAN NOT NULL DEFAULT false,
    "monthly_revenue_minor" BIGINT,
    "revenue_currency" CHAR(3),
    "snapshot_id" UUID,

    CONSTRAINT "asset_metadata_youtube_pkey" PRIMARY KEY ("asset_id")
);

-- CreateTable
CREATE TABLE "asset_metadata_instagram" (
    "asset_id" UUID NOT NULL,
    "account_id" TEXT NOT NULL,
    "followers" INTEGER,
    "engagement_bps" INTEGER,
    "media_count" INTEGER,
    "account_age_days" INTEGER,
    "snapshot_id" UUID,

    CONSTRAINT "asset_metadata_instagram_pkey" PRIMARY KEY ("asset_id")
);

-- CreateTable
CREATE TABLE "asset_metadata_game" (
    "asset_id" UUID NOT NULL,
    "game" TEXT NOT NULL,
    "platform" TEXT NOT NULL,
    "account_ref" TEXT NOT NULL,
    "level_rank" TEXT,
    "inventory" JSONB NOT NULL DEFAULT '[]',
    "ban_state" TEXT NOT NULL DEFAULT 'CLEAR',
    "transferable" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "asset_metadata_game_pkey" PRIMARY KEY ("asset_id")
);

-- CreateTable
CREATE TABLE "asset_metadata_domain" (
    "asset_id" UUID NOT NULL,
    "domain_name" TEXT NOT NULL,
    "registrar" TEXT,
    "expires_at" TIMESTAMP(3),
    "transfer_locked" BOOLEAN NOT NULL DEFAULT false,
    "dns" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "asset_metadata_domain_pkey" PRIMARY KEY ("asset_id")
);

-- CreateTable
CREATE TABLE "social_snapshots" (
    "id" UUID NOT NULL,
    "provider" TEXT NOT NULL,
    "subject_ref" TEXT NOT NULL,
    "raw" JSONB NOT NULL,
    "sha256" TEXT NOT NULL,
    "fetched_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "social_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "categories_slug_key" ON "categories"("slug");

-- CreateIndex
CREATE INDEX "categories_parent_id_idx" ON "categories"("parent_id");

-- CreateIndex
CREATE UNIQUE INDEX "digital_assets_slug_key" ON "digital_assets"("slug");

-- CreateIndex
CREATE INDEX "digital_assets_seller_id_idx" ON "digital_assets"("seller_id");

-- CreateIndex
CREATE INDEX "digital_assets_type_status_idx" ON "digital_assets"("type", "status");

-- CreateIndex
CREATE INDEX "digital_assets_category_id_idx" ON "digital_assets"("category_id");

-- CreateIndex
CREATE INDEX "social_snapshots_provider_subject_ref_idx" ON "social_snapshots"("provider", "subject_ref");

-- AddForeignKey
ALTER TABLE "categories" ADD CONSTRAINT "categories_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_assets" ADD CONSTRAINT "digital_assets_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "seller_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "digital_assets" ADD CONSTRAINT "digital_assets_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_metadata_software" ADD CONSTRAINT "asset_metadata_software_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "digital_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_metadata_website" ADD CONSTRAINT "asset_metadata_website_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "digital_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_metadata_mobile" ADD CONSTRAINT "asset_metadata_mobile_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "digital_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_metadata_youtube" ADD CONSTRAINT "asset_metadata_youtube_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "digital_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_metadata_instagram" ADD CONSTRAINT "asset_metadata_instagram_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "digital_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_metadata_game" ADD CONSTRAINT "asset_metadata_game_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "digital_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "asset_metadata_domain" ADD CONSTRAINT "asset_metadata_domain_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "digital_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;
