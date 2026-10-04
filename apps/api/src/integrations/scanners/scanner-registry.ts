import { isAbsolute, resolve } from 'node:path';

import type { AppEnv } from '@fa/config';
import type { SecurityScanner } from '@fa/domain';

import { GitleaksScanner } from './gitleaks-scanner';

/** Injection token for the configured scanner fleet. */
export const SCANNER_REGISTRY = Symbol('SCANNER_REGISTRY');

/**
 * Builds the configured scanner fleet.
 *
 * Deliberately config-driven: scanners are external tools that may or may not
 * be provisioned in a given environment (Phase 0.7 — "do NOT assume every
 * provider must be integrated immediately"). A missing scanner simply drops out
 * of the fleet; the quality decision still runs over whatever scanned.
 *
 * NOTE: relative paths are resolved against `process.cwd()` because the
 * sandboxed child process inherits no usable relative base of its own.
 */
export function createScannerRegistry(env: AppEnv): SecurityScanner[] {
  const scanners: SecurityScanner[] = [];
  const binary = env.SCANNERS_GITLEAKS_BIN;

  if (binary) {
    const path = isAbsolute(binary) ? binary : resolve(process.cwd(), binary);
    scanners.push(new GitleaksScanner(path));
  }

  return scanners;
}
