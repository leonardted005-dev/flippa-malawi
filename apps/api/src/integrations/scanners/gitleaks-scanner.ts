import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import { normalizeSeverity, stableFingerprint, type SecurityFinding } from '@fa/domain';

import { runIsolated } from './isolated-runner';
import {
  gitleaksOutputSchema,
  type RawScanResult,
  type ScanTarget,
  type ScannerKind,
  type SecurityScanner,
} from './scanner-types';

/**
 * Marker stored instead of any matched secret value. A leaked credential must
 * never be persisted (SECURITY_THREAT_MODEL → credential theft / API leakage).
 */
export const REDACTED = '[REDACTED]';

function toRelativePath(filePath: string, workDir: string): string {
  const file = filePath.replace(/\\/g, '/');
  const dir = workDir.replace(/\\/g, '/').replace(/\/+$/, '');
  if (file.startsWith(`${dir}/`)) {
    return file.slice(dir.length + 1);
  }
  return file;
}

/**
 * Normalizes a gitleaks JSON report into our canonical SecurityFinding.
 * All secret values are replaced with REDACTED; the tool is also run with
 * `--redact` as defence-in-depth.
 */
export function normalizeGitleaksFindings(report: unknown, workDir: string): SecurityFinding[] {
  const parsed = gitleaksOutputSchema.safeParse(report);
  if (!parsed.success) {
    return [];
  }

  return parsed.data.map((item) => {
    const file = toRelativePath(item.File, workDir);
    const ruleId = item.RuleID;
    const category = 'secret';

    return {
      scanner: 'gitleaks',
      ruleId,
      // Leaked credentials are treated as HIGH by default; the platform's
      // quality policy (not the tool) decides FAIL/REVIEW/PASS.
      severity: normalizeSeverity(undefined, 'HIGH'),
      category,
      file,
      line: item.StartLine,
      title: `Exposed credential (${ruleId})`,
      description: item.Description,
      evidence: REDACTED,
      remediation:
        'Revoke and rotate the exposed credential, then remove it from the artifact before publishing.',
      fingerprint:
        item.Fingerprint ||
        stableFingerprint({ scanner: 'gitleaks', ruleId, file, line: item.StartLine, category }),
    };
  });
}

/**
 * Adapter for Gitleaks (established, external secret scanner).
 * The binary path comes from configuration; it is never vendored here.
 */
export class GitleaksScanner implements SecurityScanner {
  readonly id = 'gitleaks';
  readonly kind: ScannerKind = 'SECRET';

  constructor(private readonly binary: string) {}

  async isAvailable(): Promise<boolean> {
    const probe = await runIsolated({
      cmd: this.binary,
      args: ['version'],
      cwd: process.cwd(),
      timeoutMs: 15_000,
    }).catch(() => null);
    return probe !== null && probe.exitCode === 0;
  }

  async version(): Promise<string> {
    const probe = await runIsolated({
      cmd: this.binary,
      args: ['version'],
      cwd: process.cwd(),
      timeoutMs: 15_000,
    });
    const line = (probe.stdout || probe.stderr).trim().split('\n')[0] ?? '';
    return line.trim() || 'unknown';
  }

  async scan(target: ScanTarget): Promise<RawScanResult> {
    const reportPath = join(target.workDir, '.gitleaks-report.json');
    const result = await runIsolated({
      cmd: this.binary,
      args: [
        'detect',
        '--source',
        target.workDir,
        '--no-git',
        '--report-format',
        'json',
        '--report-path',
        reportPath,
        '--exit-code',
        '0',
        '--redact',
      ],
      cwd: target.workDir,
    });

    const rawOutput = await readFile(reportPath, 'utf8').catch(() => '[]');
    return {
      scanner: this.id,
      kind: this.kind,
      toolVersion: await this.version().catch(() => 'unknown'),
      exitCode: result.exitCode,
      rawOutput,
      durationMs: result.durationMs,
    };
  }
}
