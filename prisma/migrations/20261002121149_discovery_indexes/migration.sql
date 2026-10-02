-- CreateIndex
CREATE INDEX "digital_assets_country_idx" ON "digital_assets"("country");

-- CreateIndex
CREATE INDEX "digital_assets_verification_status_quality_status_idx" ON "digital_assets"("verification_status", "quality_status");

-- CreateIndex
CREATE INDEX "listings_status_published_at_idx" ON "listings"("status", "published_at");

-- CreateIndex
CREATE INDEX "listings_status_created_at_idx" ON "listings"("status", "created_at");

-- CreateIndex
CREATE INDEX "listings_status_price_minor_idx" ON "listings"("status", "price_minor");

-- CreateIndex
CREATE INDEX "listings_status_featured_until_idx" ON "listings"("status", "featured_until");
