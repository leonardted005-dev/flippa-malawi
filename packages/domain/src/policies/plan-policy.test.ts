import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  PlanPolicyError,
  canAddActiveListing,
  computePlatformFeeMinor,
  isUploadAllowed,
  resolvePlanPolicy,
  type TierConfig,
} from './plan-policy';

const free: TierConfig = {
  code: 'FREE_CODER',
  name: 'Free Coder',
  storageQuotaBytes: 50n * 1024n * 1024n,
  maxUploadBytesPerFile: 50n * 1024n * 1024n,
  maxActiveListings: 3,
  commissionBps: 1500,
  qualityQueue: 'standard',
  verificationLevel: 'basic',
};

test('resolves a valid tier config into a policy', () => {
  const policy = resolvePlanPolicy(free);
  assert.equal(policy.code, 'FREE_CODER');
  assert.equal(policy.commissionBps, 1500);
  assert.equal(policy.qualityQueue, 'standard');
});

test('rejects invalid commission / queue / verification level', () => {
  assert.throws(() => resolvePlanPolicy({ ...free, commissionBps: 12_000 }), PlanPolicyError);
  assert.throws(() => resolvePlanPolicy({ ...free, qualityQueue: 'turbo' }), PlanPolicyError);
  assert.throws(() => resolvePlanPolicy({ ...free, verificationLevel: 'god' }), PlanPolicyError);
  assert.throws(() => resolvePlanPolicy({ ...free, maxUploadBytesPerFile: 0n }), PlanPolicyError);
});

test('platform fee uses integer math (15% of 10_001 minor = 1500 floored)', () => {
  assert.equal(computePlatformFeeMinor(10_001n, 1500), 1500n);
  assert.equal(computePlatformFeeMinor(1_000_000n, 1000), 100_000n);
  assert.equal(computePlatformFeeMinor(0n, 1500), 0n);
  assert.throws(() => computePlatformFeeMinor(-1n, 1500), PlanPolicyError);
});

test('upload + listing quota checks honour null = unlimited', () => {
  const policy = resolvePlanPolicy(free);
  assert.equal(isUploadAllowed(policy, 1n), true);
  assert.equal(isUploadAllowed(policy, 51n * 1024n * 1024n), false);
  assert.equal(isUploadAllowed(policy, 0n), false);

  assert.equal(canAddActiveListing(policy, 2), true);
  assert.equal(canAddActiveListing(policy, 3), false);

  const unlimited = resolvePlanPolicy({
    ...free,
    maxActiveListings: null,
    storageQuotaBytes: null,
  });
  assert.equal(canAddActiveListing(unlimited, 9999), true);
  assert.equal(unlimited.storageQuotaBytes, null);
});
