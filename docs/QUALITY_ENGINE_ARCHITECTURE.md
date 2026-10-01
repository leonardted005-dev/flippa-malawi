# QUALITY ENGINE ARCHITECTURE

**Status:** Greenfield blueprint. **Principle (rule):** the platform **orchestrates external
specialist scanners**; we do **NOT** build a homemade static analyzer as the primary security
engine.

---

## 1. PIPELINE

```
Upload (signed URL) → StorageObject → storage event → QA Queue
        ↓
Scanner Orchestrator  (workers/scan-runner — ISOLATED, never in API)
        ↓  fan-out to adapters
[ Semgrep | CodeQL | OSV | Snyk | Gitleaks | TruffleHog | ClamAV | VirusTotal
  | Trivy | Syft | ScanCode | OWASP ZAP | MobSF ]
        ↓  each returns a RAW result (retained, hashed)
Normalization → SecurityFinding[]   (our internal, canonical shape)
        ↓
Quality Policy Engine  (config-driven rules, versioned quality_policies)
        ↓
PASS / REVIEW / FAIL   → quality_reports
```

Every stage is **auditable**: raw scanner output is stored as an object and referenced by
`scanner_runs.raw_result_object_id` + `result_sha256` (rule #15: retain scanner results).

---

## 2. SCANNER ABSTRACTION

```ts
export type ScannerKind =
  'STATIC_ANALYSIS' | 'DEPENDENCY' | 'SECRET' | 'MALWARE' | 'LICENSE' | 'SBOM' | 'MOBILE' | 'WEB';

export interface SecurityScanner {
  readonly kind: ScannerKind;
  readonly id: string; // 'semgrep', 'trivy', ...
  supports(target: ScanTarget): boolean;
  submit(target: ScanTarget): Promise<ScanJobRef>;
  poll(ref: ScanJobRef): Promise<RawScanResult>;
}

// Capability interfaces named in the brief (mix-ins over SecurityScanner):
interface StaticAnalyzer extends SecurityScanner {
  kind: 'STATIC_ANALYSIS';
}
interface DependencyScanner extends SecurityScanner {
  kind: 'DEPENDENCY';
}
interface SecretScanner extends SecurityScanner {
  kind: 'SECRET';
}
interface MalwareScanner extends SecurityScanner {
  kind: 'MALWARE';
}
interface LicenseScanner extends SecurityScanner {
  kind: 'LICENSE';
}
interface SBOMGenerator extends SecurityScanner {
  kind: 'SBOM';
}
interface MobileScanner extends SecurityScanner {
  kind: 'MOBILE';
}
interface WebScanner extends SecurityScanner {
  kind: 'WEB';
}
```

**Scanner → capability mapping (illustrative, not mandatory-to-integrate-all):**

| Scanner          | Capability                       | Typical target    | Notes                 |
| ---------------- | -------------------------------- | ----------------- | --------------------- |
| Semgrep          | StaticAnalyzer                   | source tree       | self-host or SaaS     |
| CodeQL           | StaticAnalyzer                   | source tree       | deeper, slower        |
| OSV              | DependencyScanner                | lockfiles/SBOM    | free DB               |
| Snyk             | DependencyScanner                | manifests/SBOM    | SaaS/licensing        |
| Gitleaks         | SecretScanner                    | git dir / tree    | fast                  |
| TruffleHog       | SecretScanner                    | git history       | —                     |
| ClamAV           | MalwareScanner                   | any uploaded blob | self-host             |
| VirusTotal       | MalwareScanner                   | blobs/URLs        | SaaS, rate-limited    |
| Trivy            | DependencyScanner/Malware/Config | containers/fs     | —                     |
| Syft             | SBOMGenerator                    | fs/image          | produces SBOM         |
| ScanCode Toolkit | LicenseScanner                   | source tree       | license detection     |
| OWASP ZAP        | WebScanner                       | running web app   | DAST                  |
| MobSF            | MobileScanner                    | APK/IPA           | mobile static+dynamic |

> **Do not assume all are integrated immediately.** Phase 7 wires a first wave
> (e.g. Gitleaks + OSV/Trivy + ClamAV + Semgrep + Syft + ScanCode); the rest plug in behind the
> same interfaces later. Each integration is confirmed against its own licensing hosting model (A5).

---

## 3. NORMALIZED FINDING (our canonical shape — Phase 0.7)

```ts
export interface SecurityFinding {
  scanner: string; // 'semgrep'
  ruleId: string; // scanner-native rule id
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
  category: string; // 'injection' | 'secret' | 'cve' | 'malware' | 'license' | ...
  file: string | null;
  line: number | null;
  title: string;
  description: string;
  evidence: string; // sanitized snippet/ref; secrets are REDACTED
  remediation: string;
  fingerprint: string; // stable dedupe key
}
```

**Normalization rules:** map each scanner's severities to our 5-level scale; strip/redact secret
values before storage (never store a live secret from a finding); attach a stable `fingerprint`
(hash of ruleId+file+line+category) so re-scans dedupe in `security_findings`.

---

## 4. QUALITY POLICY ENGINE

```
quality_reports.decision = evaluate(findings[], policy)
```

- Policies are **config rows** (`quality_policies.rules_json`), **versioned**, so changing thresholds
  never rewrites history — each report references the policy version used.
- Default policy (illustrative, tune with security):
  - any `CRITICAL` malware/secret → **FAIL**
  - `CRITICAL`/`HIGH` in security category → **REVIEW** (or FAIL by asset type)
  - license conflict → **REVIEW**
  - only `LOW`/`INFO` → **PASS**
- `PASS` is required for a listing to reach `ACTIVE` (or an explicit admin override with reason).

---

## 5. ISOLATION & SAFETY (rules #16, #17)

- Scanners run **only** in `workers/scan-runner`, in **sandboxed** containers (no network by default
  for static scanners; egress-restricted allowlist for SaaS calls).
- **Uploaded code is NEVER executed inside the API server.** Dynamic analysis (ZAP/MobSF) runs in
  disposable, network-isolated sandboxes.
- **ZIP-bomb / decompression-bomb defense:** limit archive depth, entry count, uncompressed size,
  and ratio; reject path-traversal entries; enforce total scan time & memory caps.
- Resource limits (CPU/mem/time) per scan job; a hung scanner is killed and reported as `ERROR`
  (never silently `PASS`).
- Scanner worker has **no** access to payment secrets or PII stores.
