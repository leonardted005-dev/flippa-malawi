import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertPaymentTransition,
  deriveRefundStatus,
  isRefundablePaymentStatus,
  isTerminalPaymentStatus,
  PaymentTransitionError,
} from './payment-machine';

describe('payment state machine', () => {
  it('allows the happy path INITIATED → PENDING → AUTHORIZED → CAPTURED', () => {
    assert.doesNotThrow(() => assertPaymentTransition('INITIATED', 'PENDING'));
    assert.doesNotThrow(() => assertPaymentTransition('PENDING', 'AUTHORIZED'));
    assert.doesNotThrow(() => assertPaymentTransition('AUTHORIZED', 'CAPTURED'));
  });

  it('allows direct capture from PENDING (providers without auth step)', () => {
    assert.doesNotThrow(() => assertPaymentTransition('PENDING', 'CAPTURED'));
  });

  it('forbids resurrecting terminal states', () => {
    assert.throws(() => assertPaymentTransition('CAPTURED', 'PENDING'), PaymentTransitionError);
    assert.throws(() => assertPaymentTransition('FAILED', 'CAPTURED'), PaymentTransitionError);
    assert.throws(() => assertPaymentTransition('VOIDED', 'AUTHORIZED'), PaymentTransitionError);
    assert.equal(isTerminalPaymentStatus('REFUNDED'), true);
    assert.equal(isTerminalPaymentStatus('CAPTURED'), false);
  });

  it('only captured funds are refundable', () => {
    assert.equal(isRefundablePaymentStatus('CAPTURED'), true);
    assert.equal(isRefundablePaymentStatus('PARTIALLY_REFUNDED'), true);
    assert.equal(isRefundablePaymentStatus('AUTHORIZED'), false);
    assert.equal(isRefundablePaymentStatus('REFUNDED'), false);
  });

  it('derives refund status from immutable accounting (never client input)', () => {
    assert.equal(deriveRefundStatus(0n, 1000n), 'CAPTURED');
    assert.equal(deriveRefundStatus(400n, 1000n), 'PARTIALLY_REFUNDED');
    assert.equal(deriveRefundStatus(1000n, 1000n), 'REFUNDED');
    // Partial refunds may repeat until exhausted — each step is legal.
    assert.doesNotThrow(() => assertPaymentTransition('PARTIALLY_REFUNDED', 'PARTIALLY_REFUNDED'));
    assert.doesNotThrow(() => assertPaymentTransition('PARTIALLY_REFUNDED', 'REFUNDED'));
    assert.throws(() => assertPaymentTransition('REFUNDED', 'PARTIALLY_REFUNDED'));
  });
});
