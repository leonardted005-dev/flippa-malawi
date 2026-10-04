import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  DEFAULT_QUALITY_POLICY,
  QualityPolicyError,
  classifyFinding,
  evaluateQuality,
  highestSeverity,
  normalizeSeverity,
  parseQualityRules,
  stableFingerprint,
} from '../index';

test('normalizes heterogeneous tool severities onto our 5-level scale', () => {
  assert.equal(normalizeSeverity('CRITICAL'), 'CRITICAL');
  assert.equal(normalizeSeverity('error'), 'HIGH');
  assert.equal(normalizeSeverity('Warning'), 'MEDIUM');
  assert.equal(normalizeSeverity('note'), 'INFO');
  assert.equal(normalizeSeverity('something-invented'), 'MEDIUM'); // fallback
  assert.equal(normalizeSeverity(null, 'LOW'), 'LOW');
});

test('highest severity wins regardless of ordering', () => {
  const sev = highestSeverity([
    {
      scanner: 'x',
      ruleId: 'a',
      severity: 'LOW',
      category: 'style',
      file: null,
      line: null,
      title: '',
      description: '',
      evidence: null,
      remediation: null,
      fingerprint: 'f1',
    },
    {
      scanner: 'x',
      ruleId: 'b',
      severity: 'CRITICAL',
      category: 'security',
      file: 'a.ts',
      line: 1,
      title: '',
      description: '',
      evidence: null,
      remediation: null,
      fingerprint: 'f2',
    },
  ]);
  assert.equal(sev, 'CRITICAL');
  assert.equal(highestSeverity([]), null);
});

test('stable fingerprint is deterministic and content-sensitive', () => {
  const parts = {
    scanner: 'gitleaks',
    ruleId: 'generic-api-key',
    file: 'a.txt',
    line: 1,
    category: 'secret',
  };
  const a = stableFingerprint(parts);
  const b = stableFingerprint({ ...parts });
  assert.equal(a, b);
  assert.equal(a.length, 64);
  assert.notEqual(a, stableFingerprint({ ...parts, line: 2 }));
});

test('policy thresholds decide FAIL / REVIEW / PASS with FAIL taking precedence', () => {
  const rules = parseQualityRules({
    failOn: ['CRITICAL', 'HIGH'],
    reviewOn: ['MEDIUM'],
    reviewCategories: ['secret'],
  });

  assert.deepEqual(rules.reviewCategories, ['secret']);

  // high severity -> FAIL
  assert.equal(classifyFinding({ severity: 'HIGH', category: 'security' }, rules), 'FAIL');
  // medium -> REVIEW
  assert.equal(classifyFinding({ severity: 'MEDIUM', category: 'quality' }, rules), 'REVIEW');
  // low -> PASS
  assert.equal(classifyFinding({ severity: 'LOW', category: 'style' }, rules), 'PASS');
  // category override pushes a low-severity secret into REVIEW
  assert.equal(classifyFinding({ severity: 'LOW', category: 'Secret' }, rules), 'REVIEW');

  const find = (severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW', category: string) => ({
    scanner: 's',
    ruleId: 'r',
    severity,
    category,
    file: null,
    line: null,
    title: '',
    description: '',
    evidence: null,
    remediation: null,
    fingerprint: `f-${severity}-${category}`,
  });

  assert.equal(evaluateQuality([find('LOW', 'style')], rules).decision, 'PASS');
  assert.equal(evaluateQuality([find('MEDIUM', 'quality')], rules).decision, 'REVIEW');

  const mixed = evaluateQuality([find('LOW', 'style'), find('CRITICAL', 'security')], rules);
  assert.equal(mixed.decision, 'FAIL'); // FAIL dominates REVIEW/PASS
  assert.equal(mixed.failCount, 1);
  assert.equal(mixed.passCount, 1);
  assert.equal(mixed.totalFindings, 2);
  assert.equal(mixed.highestSeverity, 'CRITICAL');

  // no findings at all -> PASS
  assert.equal(evaluateQuality([], rules).decision, 'PASS');
});

test('missing policy config defaults; malformed policy config fails loudly', () => {
  const rules = parseQualityRules(undefined);
  assert.deepEqual(rules, DEFAULT_QUALITY_POLICY);

  assert.throws(() => parseQualityRules('nope'), QualityPolicyError);
  assert.throws(() => parseQualityRules({ failOn: 'nope' }), QualityPolicyError);
  assert.throws(() => parseQualityRules({ failOn: ['NOT_A_LEVEL'] }), QualityPolicyError);
});
