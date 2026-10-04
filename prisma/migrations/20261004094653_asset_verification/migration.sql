-- CreateEnum
CREATE TYPE "VerificationTargetType" AS ENUM ('ASSET', 'SELLER');

-- CreateEnum
CREATE TYPE "VerificationCaseStatus" AS ENUM ('OPEN', 'SUBMITTED', 'APPROVED', 'REJECTED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "VerificationMethod" AS ENUM ('DNS_TXT', 'HTTP_TOKEN', 'SOCIAL_PROOF', 'STORE_PROOF', 'MANUAL');

-- CreateEnum
CREATE TYPE "KycLevel" AS ENUM ('BASIC', 'ENHANCED', 'ENTERPRISE');

-- CreateEnum
CREATE TYPE "KycDecision" AS ENUM ('APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "verification_cases" (
    "id" UUID NOT NULL,
    "target_type" "VerificationTargetType" NOT NULL,
    "asset_id" UUID,
    "seller_id" UUID,
    "method" "VerificationMethod" NOT NULL,
    "kyc_level" "KycLevel",
    "status" "VerificationCaseStatus" NOT NULL DEFAULT 'OPEN',
    "challenge_id" UUID,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "decided_by_id" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "verification_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ownership_challenges" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "method" "VerificationMethod" NOT NULL,
    "target" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "verified_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ownership_challenges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kyc_answers" (
    "id" UUID NOT NULL,
    "case_id" UUID NOT NULL,
    "question" TEXT NOT NULL,
    "answer_enc" TEXT NOT NULL,
    "hint" TEXT,
    "evidence_object_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "kyc_answers_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "verification_cases_asset_id_status_idx" ON "verification_cases"("asset_id", "status");

-- CreateIndex
CREATE INDEX "verification_cases_seller_id_status_idx" ON "verification_cases"("seller_id", "status");

-- CreateIndex
CREATE INDEX "verification_cases_status_expires_at_idx" ON "verification_cases"("status", "expires_at");

-- CreateIndex
CREATE INDEX "verification_cases_challenge_id_idx" ON "verification_cases"("challenge_id");

-- CreateIndex
CREATE INDEX "ownership_challenges_case_id_idx" ON "ownership_challenges"("case_id");

-- CreateIndex
CREATE INDEX "ownership_challenges_expires_at_idx" ON "ownership_challenges"("expires_at");

-- CreateIndex
CREATE INDEX "kyc_answers_case_id_idx" ON "kyc_answers"("case_id");

-- AddForeignKey
ALTER TABLE "verification_cases" ADD CONSTRAINT "verification_cases_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "digital_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_cases" ADD CONSTRAINT "verification_cases_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "seller_profiles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "verification_cases" ADD CONSTRAINT "verification_cases_challenge_id_fkey" FOREIGN KEY ("challenge_id") REFERENCES "ownership_challenges"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ownership_challenges" ADD CONSTRAINT "ownership_challenges_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "verification_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kyc_answers" ADD CONSTRAINT "kyc_answers_case_id_fkey" FOREIGN KEY ("case_id") REFERENCES "verification_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Phase 8 hardening: exactly one verification target per case.
ALTER TABLE "verification_cases"
  ADD CONSTRAINT "verification_cases_single_target_ck" CHECK (
    ("target_type" = 'ASSET' AND "asset_id" IS NOT NULL AND "seller_id" IS NULL)
    OR ("target_type" = 'SELLER' AND "seller_id" IS NOT NULL AND "asset_id" IS NULL)
  );

-- Phase 8 hardening: at most one OPEN/SUBMITTED case per asset (mirrors the
-- row-lock re-check in VerificationService.openAssetCase; defense in depth).
CREATE UNIQUE INDEX "verification_cases_one_active_per_asset_uidx"
  ON "verification_cases"("asset_id")
  WHERE "asset_id" IS NOT NULL AND "status" IN ('OPEN', 'SUBMITTED');

-- KycDecision is unused: KYC outcomes reuse the case APPROVED/REJECTED states.
DROP TYPE "KycDecision";
