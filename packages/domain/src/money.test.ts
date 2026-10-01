import assert from 'node:assert/strict';
import { test } from 'node:test';

import { Money, MoneyError } from './money';
import { Err, Ok, isOk } from './result';

test('Money stores integer minor units and never floats', () => {
  const m = Money.of(1500n, 'ZMW');
  assert.equal(m.amountMinor, 1500n);
  assert.equal(m.currency, 'ZMW');
});

test('Money.add / subtract require the same currency', () => {
  const a = Money.of(1000, 'ZMW');
  const b = Money.of(250, 'ZMW');
  assert.equal(a.add(b).amountMinor, 1250n);
  assert.equal(a.subtract(b).amountMinor, 750n);
  assert.throws(() => a.add(Money.of(1, 'USD')), MoneyError);
});

test('Money rejects invalid currency codes', () => {
  assert.throws(() => Money.of(1, 'z'), MoneyError);
  assert.throws(() => Money.of(1, 'DOLLARS'), MoneyError);
});

test('Money equality and zero checks', () => {
  assert.equal(Money.of(0, 'ZMW').isZero(), true);
  assert.equal(Money.of(-5, 'ZMW').isNegative(), true);
  assert.equal(Money.of(10, 'ZMW').equals(Money.of(10, 'ZMW')), true);
  assert.equal(Money.of(10, 'ZMW').equals(Money.of(10, 'USD')), false);
});

test('Result helpers behave', () => {
  const good = Ok(42);
  const bad = Err(new Error('nope'));
  assert.equal(isOk(good), true);
  assert.equal(isOk(bad), false);
  if (good.ok) assert.equal(good.value, 42);
});
