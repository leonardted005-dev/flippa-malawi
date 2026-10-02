import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  LISTING_STATUSES,
  ListingTransitionError,
  assertListingTransition,
  createListingSchema,
  expiryFromPublishedAt,
  nextListingStatuses,
} from '../index';

test('state machine allows the published lifecycle and rejects illegal jumps', () => {
  assert.doesNotThrow(() => assertListingTransition('DRAFT', 'PENDING_REVIEW'));
  assert.doesNotThrow(() => assertListingTransition('PENDING_REVIEW', 'ACTIVE'));
  assert.doesNotThrow(() => assertListingTransition('ACTIVE', 'SOLD'));
  assert.doesNotThrow(() => assertListingTransition('ACTIVE', 'EXPIRED'));

  assert.throws(() => assertListingTransition('DRAFT', 'ACTIVE'), ListingTransitionError);
  assert.throws(() => assertListingTransition('ACTIVE', 'DRAFT'), ListingTransitionError);
  assert.throws(() => assertListingTransition('SOLD', 'ACTIVE'), ListingTransitionError);
  assert.throws(() => assertListingTransition('WITHDRAWN', 'ACTIVE'), ListingTransitionError);
});

test('terminal states expose no outgoing transitions', () => {
  assert.deepEqual(nextListingStatuses('SOLD'), []);
  assert.deepEqual(nextListingStatuses('WITHDRAWN'), []);

  // every declared status participates in the machine
  for (const status of LISTING_STATUSES) {
    assert.ok(nextListingStatuses(status) !== undefined);
  }
});

test('listing payload defaults to FIXED_PRICE and rejects non-integer money', () => {
  const parsed = createListingSchema.parse({
    assetId: 'a2e0d4f0-0000-4000-8000-000000000001',
    priceMinor: 250000,
    currency: 'zmw',
  });
  assert.equal(parsed.mode, 'FIXED_PRICE');
  assert.equal(parsed.currency, 'ZMW');
  assert.equal(parsed.priceMinor, 250000);

  assert.throws(() =>
    createListingSchema.parse({
      assetId: 'a2e0d4f0-0000-4000-8000-000000000001',
      priceMinor: 250000.5,
    }),
  );
  assert.throws(() =>
    createListingSchema.parse({
      assetId: 'not-a-uuid',
      priceMinor: 1,
    }),
  );
});

test('expiry detection uses end timestamps, not client clocks', () => {
  const now = new Date('2026-10-01T12:00:00.000Z');
  assert.equal(expiryFromPublishedAt(new Date('2026-10-01T11:00:00.000Z'), now), true);
  assert.equal(expiryFromPublishedAt(new Date('2026-10-01T13:00:00.000Z'), now), false);
  assert.equal(expiryFromPublishedAt(undefined, now), false);
});
