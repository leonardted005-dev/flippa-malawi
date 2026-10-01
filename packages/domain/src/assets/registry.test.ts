import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ASSET_TYPES,
  AssetValidationError,
  getAssetTypeDescriptor,
  listAssetTypeDescriptors,
  metricsForAssetType,
  parseAssetMetadata,
  validateAssetMetadata,
} from '../index';

test('every asset type has exactly one descriptor', () => {
  const descriptors = listAssetTypeDescriptors();
  assert.equal(descriptors.length, ASSET_TYPES.length);
  for (const type of ASSET_TYPES) {
    assert.equal(getAssetTypeDescriptor(type).type, type);
  }
});

test('metric applicability is declared per type (UX shows only these)', () => {
  assert.deepEqual(metricsForAssetType('WEBSITE'), ['revenue', 'traffic', 'technology', 'age']);
  assert.deepEqual(metricsForAssetType('YOUTUBE_CHANNEL'), [
    'revenue',
    'subscribers',
    'views',
    'age',
  ]);
  assert.deepEqual(metricsForAssetType('OTHER'), []);
  assert.equal(getAssetTypeDescriptor('OTHER').requiresManualReview, true);
  assert.equal(getAssetTypeDescriptor('WEBSITE').requiresManualReview, false);
});

test('website metadata accepts revenue with currency and applies defaults', () => {
  const result = validateAssetMetadata('WEBSITE', {
    domain: 'example.co.ke',
    monthlyRevenueMinor: 125_000,
    revenueCurrency: 'kes',
  });
  assert.equal(result.ok, true);
  if (result.ok) {
    assert.equal(result.value['revenueCurrency'], 'KES');
    assert.deepEqual(result.value['technology'], []);
  }
});

test('website metadata requires a currency when revenue is provided', () => {
  const result = validateAssetMetadata('WEBSITE', {
    domain: 'example.co.ke',
    monthlyRevenueMinor: 500,
  });
  assert.equal(result.ok, false);
  if (!result.ok) {
    assert.deepEqual(
      result.issues.map((issue) => issue.path),
      ['revenueCurrency'],
    );
  }
});

test('invalid hostnames and non-positive sizes are rejected with paths', () => {
  assert.equal(validateAssetMetadata('WEBSITE', { domain: 'not a domain' }).ok, false);

  const badSize = validateAssetMetadata('SOFTWARE', { packageSizeBytes: 0 });
  assert.equal(badSize.ok, false);
  if (!badSize.ok) {
    assert.equal(badSize.issues[0]?.path, 'packageSizeBytes');
  }
});

test('game accounts default ban state and transferability', () => {
  const parsed = parseAssetMetadata('GAME_ACCOUNT', {
    game: 'FIFA',
    platform: 'PlayStation',
    accountRef: 'psn-user-1',
  });
  assert.equal(parsed['banState'], 'CLEAR');
  assert.equal(parsed['transferable'], true);
  assert.deepEqual(parsed['inventory'], []);
});

test('engagement is bounded to basis points', () => {
  assert.equal(
    validateAssetMetadata('INSTAGRAM_PROFILE', { accountId: 'ab', engagementBps: 10_000 }).ok,
    true,
  );
  assert.equal(
    validateAssetMetadata('INSTAGRAM_PROFILE', { accountId: 'ab', engagementBps: 10_001 }).ok,
    false,
  );
});

test('parseAssetMetadata throws AssetValidationError on invalid input', () => {
  assert.throws(() => parseAssetMetadata('DOMAIN', { domainName: '!!' }), AssetValidationError);
});
