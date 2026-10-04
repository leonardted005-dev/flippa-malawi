import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  assertVerificationTransition,
  deriveAssetVerificationStatus,
  isActiveVerificationCase,
  VERIFICATION_METHOD_BY_ASSET,
  type VerificationCaseStatus,
  type VerificationMethod,
} from './verification-machine';

describe('verification state machine', () => {
  it('allows the happy path OPEN -> SUBMITTED -> APPROVED', () => {
    assert.doesNotThrow(() => assertVerificationTransition('OPEN', 'SUBMITTED'));
    assert.doesNotThrow(() => assertVerificationTransition('SUBMITTED', 'APPROVED'));
  });

  it('allows rejection and forbids resurrection of terminal cases', () => {
    assert.doesNotThrow(() => assertVerificationTransition('SUBMITTED', 'REJECTED'));
    assert.throws(
      () => assertVerificationTransition('APPROVED', 'SUBMITTED'),
      /Cannot transition verification case/,
    );
    assert.throws(
      () => assertVerificationTransition('REJECTED', 'OPEN'),
      /Cannot transition verification case/,
    );
  });

  it('an approved case derives VERIFIED and stays sticky after expiry of others', () => {
    assert.equal(deriveAssetVerificationStatus(null), 'UNVERIFIED');
    assert.equal(deriveAssetVerificationStatus({ status: 'OPEN' }), 'IN_REVIEW');
    assert.equal(deriveAssetVerificationStatus({ status: 'SUBMITTED' }), 'IN_REVIEW');
    assert.equal(deriveAssetVerificationStatus({ status: 'APPROVED' }), 'VERIFIED');
    assert.equal(deriveAssetVerificationStatus({ status: 'REJECTED' }), 'REJECTED');
    assert.equal(deriveAssetVerificationStatus({ status: 'EXPIRED' }), 'UNVERIFIED');
  });

  it('only OPEN/SUBMITTED occupy the single-active-case slot', () => {
    const active: VerificationCaseStatus[] = ['OPEN', 'SUBMITTED'];
    const terminal: VerificationCaseStatus[] = ['APPROVED', 'REJECTED', 'EXPIRED'];
    assert.equal(active.every(isActiveVerificationCase), true);
    assert.equal(terminal.some(isActiveVerificationCase), false);
  });

  it('every asset kind has at least one server-side verification method', () => {
    for (const [kind, methods] of Object.entries(VERIFICATION_METHOD_BY_ASSET)) {
      assert.ok(methods.length > 0, kind);
      for (const method of methods as VerificationMethod[]) {
        assert.ok(
          ['DNS_TXT', 'HTTP_TOKEN', 'SOCIAL_PROOF', 'STORE_PROOF', 'MANUAL'].includes(method),
        );
      }
    }
  });
});
