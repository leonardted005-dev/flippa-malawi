import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AppEnv } from '@fa/config';
import {
  evaluateQuality,
  parseQualityRules,
  type ObjectStorage,
  type QualityPolicyRules,
  type SecurityFinding,
  type SecurityScanner,
} from '@fa/domain';

import { APP_ENV } from '../../common/config/config.module';
import type { RequestMeta } from '../../common/http/request-meta';
import { OBJECT_STORAGE } from '../../common/tokens';
import { AuditService } from '../../common/audit/audit.service';
import { PrismaService } from '../../integrations/prisma/prisma.service';
import { normalizeGitleaksFindings } from '../../integrations/scanners/gitleaks-scanner';
import { createScanSandbox } from '../../integrations/scanners/sandbox';
import { SCANNER_REGISTRY } from '../../integrations/scanners/scanner-registry';
import { SellerRepository } from '../sellers/sellers.repository';

/** Upper bound of objects materialised into one scan batch. */
const MAX_SCAN_OBJECTS = 20;

@Injectable()
export class QualityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly sellers: SellerRepository,
    private readonly audit: AuditService,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(SCANNER_REGISTRY) private readonly scanners: SecurityScanner[],
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  /** Resolves the ACTIVE versioned policy (seeded; loud if missing). */
  async activePolicy(): Promise<{ id: string; version: number; rules: QualityPolicyRules }> {
    const policy = await this.prisma.qualityPolicy.findFirst({
      where: { isActive: true },
      orderBy: { version: 'desc' },
    });
    if (!policy) {
      throw new NotFoundException({
        code: 'QUALITY_POLICY_NOT_CONFIGURED',
        message: 'No active quality policy is configured (run the seed)',
      });
    }
    return { id: policy.id, version: policy.version, rules: parseQualityRules(policy.rules) };
  }

  /**
   * Scans the seller's objects for an asset with every configured scanner:
   *
   *   external scanner (isolated) -> raw result retained in object storage
   *   -> normalized SecurityFinding[] -> QualityPolicyEngine -> PASS/REVIEW/FAIL
   *
   * Uploaded content is only read by external tools, never executed here.
   */
  async scanAsset(
    actorId: string,
    assetId: string,
    objectIds: string[] | undefined,
    isAdmin: boolean,
    meta: RequestMeta,
  ): Promise<Record<string, unknown>> {
    const asset = await this.prisma.digitalAsset.findFirst({
      where: { id: assetId, deletedAt: null },
    });
    if (!asset) {
      throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: 'Asset not found' });
    }

    if (!isAdmin) {
      const seller = await this.sellers.findByUserId(actorId);
      if (!seller || seller.id !== asset.sellerId) {
        throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: 'Asset not found' });
      }
    }

    const available = await this.availableScanners();
    if (available.length === 0) {
      throw new NotFoundException({
        code: 'SCANNER_NOT_CONFIGURED',
        message: 'No external scanner is configured in this environment',
      });
    }

    const policy = await this.activePolicy();
    const objects = await this.resolveScanTargets(asset.sellerId, objectIds, isAdmin);
    if (objects.length === 0) {
      throw new NotFoundException({
        code: 'NO_SCAN_TARGETS',
        message: 'This asset has no uploaded objects to scan',
      });
    }

    const runIds: string[] = [];
    const findings: SecurityFinding[] = [];
    const objectHasFindings = new Map<string, boolean>();
    for (const object of objects) {
      objectHasFindings.set(object.key, false);
    }

    for (const scanner of available) {
      const sandbox = await createScanSandbox(
        objects.map((object) => ({ id: object.id, key: object.key, sizeBytes: object.sizeBytes })),
        this.storage,
      );

      try {
        const raw = await scanner.scan({
          workDir: sandbox.dir,
          objectIds: objects.map((object) => object.id),
        });

        const runId = randomUUID();
        const rawKey = `quality/${assetId}/${runId}.json`;
        const stored = await this.storage.putObject(
          rawKey,
          Buffer.from(raw.rawOutput, 'utf8'),
          'application/json',
        );

        const normalized =
          raw.scanner === 'gitleaks'
            ? normalizeGitleaksFindings(JSON.parse(raw.rawOutput), sandbox.dir)
            : [];

        const run = await this.prisma.scannerRun.create({
          data: {
            id: runId,
            assetId,
            scanner: raw.scanner,
            scannerKind: raw.kind,
            scannerVersion: raw.toolVersion,
            status: 'COMPLETED',
            targetObjectIds: objects.map((object) => object.id),
            rawResultObject: stored.key,
            rawSha256: stored.sha256,
            exitCode: raw.exitCode,
            durationMs: raw.durationMs,
            findingsCount: normalized.length,
            completedAt: new Date(),
          },
        });

        if (normalized.length > 0) {
          await this.prisma.securityFinding.createMany({
            data: normalized.map((finding) => ({
              id: randomUUID(),
              scannerRunId: run.id,
              scanner: finding.scanner,
              ruleId: finding.ruleId,
              severity: finding.severity,
              category: finding.category,
              filePath: finding.file,
              line: finding.line,
              title: finding.title,
              description: finding.description,
              evidence: finding.evidence,
              remediation: finding.remediation,
              fingerprint: finding.fingerprint,
            })),
            skipDuplicates: true,
          });

          for (const finding of normalized) {
            const owner = sandbox.files.find((file) => file.relPath === finding.file);
            if (owner) {
              const key = objects.find((object) => object.id === owner.objectId)?.key;
              if (key) {
                objectHasFindings.set(key, true);
              }
            }
          }
        }

        runIds.push(run.id);
        findings.push(...normalized);
      } finally {
        await sandbox.dispose();
      }
    }

    // Reflect per-object verdicts back onto the storage objects (Phase 4 field).
    for (const object of objects) {
      await this.prisma.storageObject.update({
        where: { id: object.id },
        data: { scanStatus: objectHasFindings.get(object.key) ? 'QUARANTINED' : 'CLEAN' },
      });
    }

    const evaluation = evaluateQuality(findings, policy.rules);
    const report = await this.prisma.qualityReport.create({
      data: {
        assetId,
        policyId: policy.id,
        policyVersion: policy.version,
        decision: evaluation.decision,
        passCount: evaluation.passCount,
        reviewCount: evaluation.reviewCount,
        failCount: evaluation.failCount,
        totalFindings: evaluation.totalFindings,
        highestSeverity: evaluation.highestSeverity,
        scannerRunIds: runIds,
      },
    });

    await this.prisma.digitalAsset.update({
      where: { id: assetId },
      data: { qualityStatus: evaluation.decision },
    });

    await this.audit.record({
      actorId,
      actorType: isAdmin ? 'ADMIN' : 'USER',
      action: 'ASSET_SCANNED',
      entityType: 'DigitalAsset',
      entityId: assetId,
      after: { decision: evaluation.decision, totalFindings: evaluation.totalFindings },
      ...meta,
    });

    return this.getQuality(assetId);
  }

  async getQuality(assetId: string): Promise<Record<string, unknown>> {
    const asset = await this.prisma.digitalAsset.findUnique({ where: { id: assetId } });
    if (!asset) {
      throw new NotFoundException({ code: 'ASSET_NOT_FOUND', message: 'Asset not found' });
    }

    const report = await this.prisma.qualityReport.findFirst({
      where: { assetId },
      orderBy: { computedAt: 'desc' },
    });
    if (!report) {
      return { assetId, qualityStatus: asset.qualityStatus, report: null, findings: [] };
    }

    const runIds = (report.scannerRunIds ?? []) as string[];
    const findings = await this.prisma.securityFinding.findMany({
      where: { scannerRunId: { in: runIds } },
      orderBy: [{ severity: 'asc' }, { filePath: 'asc' }],
    });

    return {
      assetId,
      qualityStatus: asset.qualityStatus,
      report: {
        id: report.id,
        decision: report.decision,
        policyVersion: report.policyVersion,
        passCount: report.passCount,
        reviewCount: report.reviewCount,
        failCount: report.failCount,
        totalFindings: report.totalFindings,
        highestSeverity: report.highestSeverity,
        computedAt: report.computedAt.toISOString(),
      },
      // Redacted findings only — raw tool output never leaves the audit store.
      findings: findings.map((finding) => ({
        scanner: finding.scanner,
        ruleId: finding.ruleId,
        severity: finding.severity,
        category: finding.category,
        file: finding.filePath,
        line: finding.line,
        title: finding.title,
        description: finding.description,
        evidence: finding.evidence,
        remediation: finding.remediation,
      })),
    };
  }

  async listScans(assetId: string): Promise<Record<string, unknown>[]> {
    const runs = await this.prisma.scannerRun.findMany({
      where: { assetId },
      orderBy: { submittedAt: 'desc' },
      take: 50,
    });
    return runs.map((run) => ({
      id: run.id,
      scanner: run.scanner,
      kind: run.scannerKind,
      scannerVersion: run.scannerVersion,
      status: run.status,
      exitCode: run.exitCode,
      durationMs: run.durationMs,
      findingsCount: run.findingsCount,
      rawSha256: run.rawSha256,
      submittedAt: run.submittedAt.toISOString(),
      completedAt: run.completedAt ? run.completedAt.toISOString() : null,
    }));
  }

  private async availableScanners(): Promise<SecurityScanner[]> {
    const results = await Promise.all(
      this.scanners.map(async (scanner) => ((await scanner.isAvailable()) ? scanner : null)),
    );
    return results.filter((scanner): scanner is SecurityScanner => scanner !== null);
  }

  private async resolveScanTargets(
    sellerId: string,
    objectIds: string[] | undefined,
    isAdmin: boolean,
  ) {
    if (objectIds && objectIds.length > 0) {
      const objects = await this.prisma.storageObject.findMany({
        where: { id: { in: objectIds }, deletedAt: null },
      });
      const invalid = objects.some(
        (object) => object.ownerType !== 'SELLER' || (!isAdmin && object.ownerId !== sellerId),
      );
      if (invalid || objects.length !== objectIds.length) {
        throw new BadRequestException({
          code: 'SCAN_TARGET_NOT_OWNED',
          message: 'One or more scan targets are unavailable',
        });
      }
      return objects.slice(0, MAX_SCAN_OBJECTS);
    }

    return this.prisma.storageObject.findMany({
      where: { ownerType: 'SELLER', ownerId: sellerId, deletedAt: null },
      orderBy: { createdAt: 'desc' },
      take: MAX_SCAN_OBJECTS,
    });
  }
}
