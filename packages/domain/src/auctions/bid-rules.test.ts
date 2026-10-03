import assert from 'node:assert/strict';
import { test } from 'node:test';

import {
  ANTI_SNIPE_WINDOW_MS,
  AUCTION_MIN_INCREMENT_MINOR,
  BidRuleError,
  assertBidRules,
  evaluateBid,
  isReserveMet,
  minimumAcceptableBidMinor,
  nextEndsAtAfterExtension,
  resolveMinIncrementMinor,
  shouldExtendForAntiSnipe,
} from '../index';

const NOW = new Date('2026-10-01T12:00:00.000Z');
const ENDS = new Date('2026-10-01T13:00:00.000Z');

const base = {
  sellerId: 'seller-1',
  bidderId: 'buyer-1',
  endsAt: ENDS,
  now: NOW,
};

test('increment is max(5% of current bid, floor) using integer math', () => {
  assert.equal(resolveMinIncrementMinor(10_000n), 500n); // 5% = 500 > 100 floor
  assert.equal(resolveMinIncrementMinor(1_000n), 100n); // 5% = 50 < 100 floor
  assert.equal(minimumAcceptableBidMinor(null), 1n);
  assert.equal(minimumAcceptableBidMinor(10_000n), 10_500n);
  assert.equal(resolveMinIncrementMinor(0n), AUCTION_MIN_INCREMENT_MINOR);
});

test('rejects bids below the minimum increment, self-bids and bids after close', () => {
  const low = evaluateBid({ ...base, amountMinor: 10_100n, currentBidMinor: 10_000n });
  assert.equal(low.ok, false);
  assert.equal(low.ok === false && low.code, 'BID_TOO_LOW');

  const selfBid = evaluateBid({
    ...base,
    sellerId: 'buyer-1',
    amountMinor: 20_000n,
    currentBidMinor: null,
  });
  assert.equal(selfBid.ok === false && selfBid.code, 'SELF_BID');

  const closed = evaluateBid({
    ...base,
    now: ENDS,
    amountMinor: 20_000n,
    currentBidMinor: null,
  });
  assert.equal(closed.ok === false && closed.code, 'AUCTION_ALREADY_CLOSED');

  const nonPositive = evaluateBid({ ...base, amountMinor: 0n, currentBidMinor: null });
  assert.equal(nonPositive.ok === false && nonPositive.code, 'BID_NOT_POSITIVE');
});

test('accepts a valid bid and reports the required amount', () => {
  const result = evaluateBid({ ...base, amountMinor: 10_500n, currentBidMinor: 10_000n });
  assert.equal(result.ok, true);
  assert.equal(result.ok && result.requiredMinor, 10_500n);

  const opening = evaluateBid({ ...base, amountMinor: 1n, currentBidMinor: null });
  assert.equal(opening.ok, true);

  assert.throws(
    () => assertBidRules({ ...base, amountMinor: 1n, currentBidMinor: 10_000n }),
    BidRuleError,
  );
});

test('anti-snipe: a decisive late bid extends the auction', () => {
  const endsAt = new Date('2026-10-01T13:00:00.000Z');
  const snipe = new Date(endsAt.getTime() - 30_000);
  const earlier = new Date(endsAt.getTime() - ANTI_SNIPE_WINDOW_MS - 1_000);

  assert.equal(shouldExtendForAntiSnipe(endsAt, snipe, endsAt), true);
  assert.equal(shouldExtendForAntiSnipe(endsAt, earlier, endsAt), false);
  assert.equal(shouldExtendForAntiSnipe(endsAt, null, endsAt), false);

  const extended = nextEndsAtAfterExtension(endsAt, endsAt);
  assert.equal(extended.getTime(), endsAt.getTime() + 120_000);
});

test('reserve: null means no reserve; otherwise bid must meet it', () => {
  assert.equal(isReserveMet(null, null), true);
  assert.equal(isReserveMet(500n, 499n), false);
  assert.equal(isReserveMet(500n, 500n), true);
  assert.equal(isReserveMet(500n, null), false);
});
