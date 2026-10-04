import { createHash } from 'node:crypto';

/**
 * Normalized finding shape produced by every scanner adapter
 * (docs/QUALITY_ENGINE_ARCHITECTURE.md §3).
 *
 * `evidence` is ALWAYS redacted before it reaches this type — a raw secret must
 * never be persisted (see SECURITY_THREAT_MODEL: "credential theft").
 */
export const SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'] as const;
export type Severity = (typeof SEVERITIES)[number];

export interface SecurityFinding {
  scanner: string;
  ruleId: string;
  severity: Severity;
  category: string;
  file: string | null;
  line: number | null;
  title: string;
  description: string;
  evidence: string | null;
  remediation: string | null;
  fingerprint: string;
}

const SEVERITY_RANK: Record<Severity, number> = {
  CRITICAL: 4,
  HIGH: 3,
  MEDIUM: 2,
  LOW: 1,
  INFO: 0,
};

const ALIASES: Record<string, Severity> = {
  critical: 'CRITICAL',
  blocker: 'CRITICAL',
  fatal: 'CRITICAL',
  high: 'HIGH',
  error: 'HIGH',
  severe: 'HIGH',
  medium: 'MEDIUM',
  warning: 'MEDIUM',
  warn: 'MEDIUM',
  moderate: 'MEDIUM',
  low: 'LOW',
  minor: 'LOW',
  note: 'INFO',
  info: 'INFO',
  infosec: 'INFO',
  none: 'INFO',
};

/**
 * Maps a tool's native severity/vocabulary onto our 5-level scale.
 * Unknown values fall back rather than silently being ignored.
 */
export function normalizeSeverity(
  raw: string | null | undefined,
  fallback: Severity = 'MEDIUM',
): Severity {
  if (!raw) {
    return fallback;
  }
  const key = String(raw).trim().toLowerCase();
  return ALIASES[key] ?? fallback;
}

export function severityRank(severity: Severity): number {
  return SEVERITY_RANK[severity];
}

export function highestSeverity(findings: SecurityFinding[]): Severity | null {
  if (findings.length === 0) {
    return null;
  }
  return findings.reduce<Severity>(
    (best, finding) =>
      severityRank(finding.severity) > severityRank(best) ? finding.severity : best,
    'INFO',
  );
}

/**
 * Stable fingerprint across re-scans of unchanged content: same input always
 * yields the same id, so re-running a scanner dedupes instead of duplicating.
 */
export function stableFingerprint(parts: {
  scanner: string;
  ruleId: string;
  file?: string | null;
  line?: number | null;
  category: string;
}): string {
  const input = [
    parts.scanner,
    parts.ruleId,
    parts.category,
    parts.file ?? '',
    parts.line === null || parts.line === undefined ? '' : String(parts.line),
  ].join(' ');

  return createHash('sha256').update(input, 'utf8').digest('hex').slice(0, 64);
}
