/**
 * External scanner port (Phase 0.7).
 *
 * The platform ORCHESTRATES specialist tools; it never analyses untrusted
 * content itself. Every adapter speaks to a real, external scanner binary or
 * service and returns the RAW tool output for audit retention.
 */
export type ScannerKind =
  'SECRET' | 'MALWARE' | 'DEPENDENCY' | 'STATIC' | 'LICENSE' | 'SBOM' | 'MOBILE' | 'WEB';

export interface ScanTarget {
  /** Absolute path of the bounded sandbox directory holding the artifacts. */
  workDir: string;
  /** Object ids that were materialized (for audit rows). */
  objectIds: string[];
}

export interface RawScanResult {
  scanner: string;
  kind: ScannerKind;
  toolVersion: string;
  /** 0 = tool completed normally (findings may still exist). */
  exitCode: number;
  /** RAW tool output. Stored for audit; NEVER returned to clients. */
  rawOutput: string;
  durationMs: number;
}

export interface SecurityScanner {
  readonly id: string;
  readonly kind: ScannerKind;
  /** True when the external tool is installed/configured in this environment. */
  isAvailable(): Promise<boolean>;
  /** Version string reported by the tool itself. */
  version(): Promise<string>;
  /** Runs the tool against an isolated, read-only-ish sandbox. */
  scan(target: ScanTarget): Promise<RawScanResult>;
}

/** Guards against decompression/size bombs before any scanner runs. */
export const SANDBOX_LIMITS = {
  maxFiles: 200,
  maxTotalBytes: 512 * 1024 * 1024, // 512 MiB
  maxSingleFileBytes: 128 * 1024 * 1024, // 128 MiB
  scanTimeoutMs: 60_000,
  maxOutputBytes: 4 * 1024 * 1024,
} as const;
