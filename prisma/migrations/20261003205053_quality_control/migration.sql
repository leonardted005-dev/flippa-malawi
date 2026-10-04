-- CreateEnum
CREATE TYPE "QualityDecision" AS ENUM ('PASS', 'REVIEW', 'FAIL');

-- CreateEnum
CREATE TYPE "ScannerRunStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "FindingSeverity" AS ENUM ('CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO');

-- CreateTable
CREATE TABLE "quality_policies" (
    "id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "rules" JSONB NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT false,
    "effective_from" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "quality_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scanner_runs" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "scanner" TEXT NOT NULL,
    "scanner_kind" TEXT NOT NULL,
    "scanner_version" TEXT,
    "status" "ScannerRunStatus" NOT NULL DEFAULT 'COMPLETED',
    "targetObjectIds" JSONB,
    "raw_result_object" TEXT,
    "raw_sha256" TEXT,
    "error" TEXT,
    "exit_code" INTEGER,
    "duration_ms" INTEGER,
    "findings_count" INTEGER NOT NULL DEFAULT 0,
    "submitted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "scanner_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "security_findings" (
    "id" UUID NOT NULL,
    "scanner_run_id" UUID NOT NULL,
    "scanner" TEXT NOT NULL,
    "rule_id" TEXT NOT NULL,
    "severity" "FindingSeverity" NOT NULL,
    "category" TEXT NOT NULL,
    "file_path" TEXT,
    "line" INTEGER,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" TEXT,
    "remediation" TEXT,
    "fingerprint" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_findings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_reports" (
    "id" UUID NOT NULL,
    "asset_id" UUID NOT NULL,
    "policy_id" UUID NOT NULL,
    "policy_version" INTEGER NOT NULL,
    "decision" "QualityDecision" NOT NULL,
    "pass_count" INTEGER NOT NULL DEFAULT 0,
    "review_count" INTEGER NOT NULL DEFAULT 0,
    "fail_count" INTEGER NOT NULL DEFAULT 0,
    "total_findings" INTEGER NOT NULL DEFAULT 0,
    "highest_severity" "FindingSeverity",
    "scanner_run_ids" JSONB NOT NULL DEFAULT '[]',
    "computed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "quality_policies_version_key" ON "quality_policies"("version");

-- CreateIndex
CREATE INDEX "quality_policies_is_active_idx" ON "quality_policies"("is_active");

-- CreateIndex
CREATE INDEX "scanner_runs_asset_id_submitted_at_idx" ON "scanner_runs"("asset_id", "submitted_at");

-- CreateIndex
CREATE INDEX "security_findings_severity_idx" ON "security_findings"("severity");

-- CreateIndex
CREATE INDEX "security_findings_fingerprint_idx" ON "security_findings"("fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "security_findings_scanner_run_id_fingerprint_key" ON "security_findings"("scanner_run_id", "fingerprint");

-- CreateIndex
CREATE INDEX "quality_reports_asset_id_computed_at_idx" ON "quality_reports"("asset_id", "computed_at");

-- AddForeignKey
ALTER TABLE "scanner_runs" ADD CONSTRAINT "scanner_runs_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "digital_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_findings" ADD CONSTRAINT "security_findings_scanner_run_id_fkey" FOREIGN KEY ("scanner_run_id") REFERENCES "scanner_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_reports" ADD CONSTRAINT "quality_reports_asset_id_fkey" FOREIGN KEY ("asset_id") REFERENCES "digital_assets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_reports" ADD CONSTRAINT "quality_reports_policy_id_fkey" FOREIGN KEY ("policy_id") REFERENCES "quality_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
