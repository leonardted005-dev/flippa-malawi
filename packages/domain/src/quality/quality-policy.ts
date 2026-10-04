import { highestSeverity, type SecurityFinding, type Severity } from './security-finding';

export type QualityDecision = 'PASS' | 'REVIEW' | 'FAIL';

/**
 * Thresholds are CONFIGURATION (quality_policies.rules JSON), never code.
 *
 * Decision precedence: FAIL > REVIEW > PASS.
 */
export interface QualityPolicyRules {
  /** Findings at/below these severities block publication. */
  failOn: Severity[];
  /** Findings at/below these severities require human review. */
  reviewOn: Severity[];
  /** Categories that always fail regardless of severity (e.g. "backdoor"). */
  failCategories: string[];
  /** Categories that always require review (e.g. "unknown-binary"). */
  reviewCategories: string[];
}

export const DEFAULT_QUALITY_POLICY: QualityPolicyRules = {
  failOn: ['CRITICAL', 'HIGH'],
  reviewOn: ['MEDIUM'],
  failCategories: [],
  reviewCategories: ['malware', 'secret'],
};

export class QualityPolicyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'QualityPolicyError';
  }
}

export interface QualityEvaluation {
  decision: QualityDecision;
  passCount: number;
  reviewCount: number;
  failCount: number;
  totalFindings: number;
  highestSeverity: Severity | null;
}

export function parseQualityRules(raw: unknown): QualityPolicyRules {
  if (raw === undefined || raw === null) {
    // No policy configured yet (bootstrap) -> use the safe default.
    return {
      ...DEFAULT_QUALITY_POLICY,
      failOn: [...DEFAULT_QUALITY_POLICY.failOn],
      reviewOn: [...DEFAULT_QUALITY_POLICY.reviewOn],
      failCategories: [],
      reviewCategories: [...DEFAULT_QUALITY_POLICY.reviewCategories],
    };
  }
  if (typeof raw !== 'object') {
    // A policy that exists but is malformed must surface loudly.
    throw new QualityPolicyError('Quality policy rules must be an object');
  }

  const value = raw as Record<string, unknown>;
  const severities = (key: string, fallback: Severity[]): Severity[] => {
    const list = value[key];
    if (list === undefined) {
      return fallback;
    }
    if (!Array.isArray(list)) {
      throw new QualityPolicyError(`rules.${key} must be an array`);
    }
    return list.map((entry) => {
      if (
        typeof entry !== 'string' ||
        !['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'].includes(entry)
      ) {
        throw new QualityPolicyError(`rules.${key} contains an unknown severity: ${String(entry)}`);
      }
      return entry as Severity;
    });
  };

  const categories = (key: string): string[] => {
    const list = value[key];
    if (list === undefined) {
      return [];
    }
    if (!Array.isArray(list) || list.some((entry) => typeof entry !== 'string')) {
      throw new QualityPolicyError(`rules.${key} must be an array of strings`);
    }
    return list as string[];
  };

  return {
    failOn: severities('failOn', DEFAULT_QUALITY_POLICY.failOn),
    reviewOn: severities('reviewOn', DEFAULT_QUALITY_POLICY.reviewOn),
    failCategories: categories('failCategories'),
    reviewCategories: categories('reviewCategories'),
  };
}

export function classifyFinding(
  finding: Pick<SecurityFinding, 'severity' | 'category'>,
  rules: QualityPolicyRules,
): QualityDecision {
  const category = finding.category.toLowerCase();

  if (rules.failCategories.some((entry) => entry.toLowerCase() === category)) {
    return 'FAIL';
  }
  if (rules.failOn.includes(finding.severity)) {
    return 'FAIL';
  }
  if (rules.reviewCategories.some((entry) => entry.toLowerCase() === category)) {
    return 'REVIEW';
  }
  if (rules.reviewOn.includes(finding.severity)) {
    return 'REVIEW';
  }
  return 'PASS';
}

export function evaluateQuality(
  findings: SecurityFinding[],
  rules: QualityPolicyRules,
): QualityEvaluation {
  const decisions = findings.map((finding) => classifyFinding(finding, rules));

  const failCount = decisions.filter((decision) => decision === 'FAIL').length;
  const reviewCount = decisions.filter((decision) => decision === 'REVIEW').length;
  const passCount = decisions.filter((decision) => decision === 'PASS').length;

  return {
    decision: failCount > 0 ? 'FAIL' : reviewCount > 0 ? 'REVIEW' : 'PASS',
    passCount,
    reviewCount,
    failCount,
    totalFindings: findings.length,
    highestSeverity: highestSeverity(findings),
  };
}
