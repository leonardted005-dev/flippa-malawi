# TARGET ARCHITECTURE

**Status:** Greenfield blueprint (no existing code — see ARCHITECTURE_AUDIT.md).
**Style:** Modular monolith with hexagonal (ports & adapters) boundaries, plus independently
deployable async workers for isolation-heavy jobs.

---

## 1. ARCHITECTURAL PRINCIPLES

1. **The marketplace owns business logic.** Providers sit behind ports. Swapping a provider must
   not touch domain code.
2. **Ports & adapters (hexagonal).** Domain defines interfaces; infrastructure implements them.
3. **No provider leakage.** No DPO/scanner/storage SDK types appear in domain or client responses.
4. **Modular monolith first.** One API + a few workers. Do **not** split into microservices
   prematurely. Clean module boundaries keep future extraction cheap _if_ evidence demands it.
5. **Money is integer minor units only.** No floats anywhere in the money path.
6. **Immutable finance.** Ledger entries are append-only; corrections are compensating entries.
7. **Untrusted clients.** Prices, auction state, payment status are server-authoritative.
8. **Isolation for untrusted code.** Uploaded artifacts never execute inside the API server; they
   are scanned in sandboxed workers.
9. **Config over hard-coding.** Seller-tier limits, fees, tax rates, quotas = configuration/policy.
10. **Every mutation is evaluated** for authn, authz, ownership, idempotency, rate limit,
    validation, audit, and concurrency.

---

## 2. TECHNOLOGY BASELINE (recommended — assumptions A1/A3 require confirmation)

| Layer          | Recommended                                      | Why                                                        | Alternatives            |
| -------------- | ------------------------------------------------ | ---------------------------------------------------------- | ----------------------- |
| Backend        | **NestJS (TypeScript)**                          | Strong modules = modular monolith; DI for ports            | Django/FastAPI, Laravel |
| DB             | **PostgreSQL 16**                                | ACID, row locks (`SELECT ... FOR UPDATE`), partial indexes | MySQL                   |
| ORM            | **Prisma** (CRUD) + **raw SQL** (ledger/auction) | Type safety + explicit locking where it matters            | TypeORM, Kysely         |
| Cache/Queue    | **Redis + BullMQ**                               | Locks, rate limiting, worker queues, idempotency           | SQS, RabbitMQ           |
| Object storage | **S3-compatible** adapter                        | R2/B2/Supabase all S3-compatible                           | —                       |
| Web            | **Next.js (App Router)** SSR/ISR                 | SEO for listings, fast first paint                         | Remix                   |
| Mobile         | **Flutter**                                      | Single codebase, per brief                                 | —                       |
| Auth           | **JWT access + rotating refresh**                | Standard, stateless API                                    | Session cookies         |
| API docs       | **OpenAPI 3.1** generated                        | Contract for web + mobile                                  | —                       |
| IaC/deploy     | **Containers** (target TBD)                      | Portable                                                   | —                       |

> Stack choices are **assumptions requiring confirmation** (final report §R).

---

## 3. LAYERED MODULE STRUCTURE (per bounded context)

```
module/
├─ domain/            # entities, value objects, invariants, policies, domain events
│                     # PURE: no NestJS, no Prisma, no provider SDKs
├─ application/       # use-cases / command + query handlers (orchestration)
├─ infrastructure/    # repositories (Prisma), external adapters, mappers
├─ interfaces/        # HTTP controllers, DTOs, webhook handlers, queue consumers
└─ module.ts          # NestJS wiring of the above
```

Dependency rule: `interfaces → application → domain`, and `infrastructure → domain`.
**Domain depends on nothing.** Adapters depend inward only.

---

## 4. PORTS (interfaces owned by the domain)

```ts
// packages/domain/ports
export interface PaymentProvider {
  createPaymentIntent(cmd: CreateIntentCommand): Promise<PaymentIntentResult>;
  authorize(providerRef: string, amount: Money): Promise<AuthorizationResult>;
  capture(providerRef: string, amount: Money): Promise<CaptureResult>;
  void(providerRef: string): Promise<VoidResult>;
  refund(providerRef: string, amount: Money): Promise<RefundResult>;
  verifyWebhook(rawBody: Buffer, headers: Record<string, string>): WebhookVerification;
  // NOTE: DPO-specific multi-merchant split settlement fields are NOT defined here
  // until the official DPO merchant integration specification is provided (see §7 / A2).
}

export interface ObjectStorage {
  createSignedUploadUrl(key: string, opts: SignedUrlOptions): Promise<SignedUrl>;
  createSignedDownloadUrl(key: string, ttlSeconds: number): Promise<string>;
  head(key: string): Promise<ObjectMetadata>;
  delete(key: string): Promise<void>;
}

export interface SecurityScanner {
  // one adapter per scanner family
  readonly kind: ScannerKind;
  supports(target: ScanTarget): boolean;
  submit(target: ScanTarget): Promise<ScanJobRef>;
  poll(ref: ScanJobRef): Promise<RawScanResult>;
}

export interface SocialSnapshotProvider {
  // YouTube / Instagram / gaming
  fetchSnapshot(asset: AssetIdentity): Promise<RawSnapshot>;
  verifyOwnership(asset: AssetIdentity, proof: OwnershipProof): Promise<OwnershipResult>;
}
```

**Ports summary:**

| Port                     | Adapters (initial → later)                                                                              | Owning module |
| ------------------------ | ------------------------------------------------------------------------------------------------------- | ------------- |
| `PaymentProvider`        | DPO Pay → (add others)                                                                                  | payments      |
| `ObjectStorage`          | R2 / B2 / Supabase (pick one first)                                                                     | storage       |
| `SecurityScanner`*       | Semgrep, CodeQL, OSV, Trivy, Syft, ScanCode, Gitleaks, TruffleHog, ClamAV, VirusTotal, ZAP, MobSF, Snyk | quality       |
| `SocialSnapshotProvider` | YouTube Data API, Instagram Graph API                                                                   | verification  |
| `NotificationChannel`    | Email, SMS, Push                                                                                        | notifications |
| `TaxRateProvider`        | Config table → external tax service later                                                               | tax           |

\* The brief names specialized capability interfaces too — `StaticAnalyzer`, `DependencyScanner`,
`SecretScanner`, `MalwareScanner`, `LicenseScanner`, `MobileScanner`, `WebScanner`,
`SBOMGenerator`. These are modeled as capability mix-ins over the `SecurityScanner` family. See
QUALITY_ENGINE_ARCHITECTURE.md.

---

## 5. DEPLOYABLE UNITS

**Deploy now (Phases 1–12):** API (monolith), Web, Mobile (stores), and 4 workers.

**Independently deployable workers (justified by isolation / resource needs):**

| Worker              | Justification for isolation                                                                    |
| ------------------- | ---------------------------------------------------------------------------------------------- |
| `scan-runner`       | Runs untrusted code in sandboxes; must never share the API process; CPU/IO-heavy and bursty.   |
| `media-worker`      | CPU-heavy transcode/thumbnail/metadata; scale independently.                                   |
| `webhook-worker`    | Dedicated retry/idempotency surface for payment webhooks.                                      |
| `settlement-worker` | Financial batch jobs (payouts, reconciliation) need audited isolation + controlled scheduling. |

**NOT microservices (keep in monolith):** identity, listings, auctions, bids, offers, watchlists,
messaging, orders, disputes, reviews, admin, reporting. These share a transactional database and
have tight consistency needs — splitting now adds distributed-transaction pain for zero benefit.

---

## 6. REPOSITORY LAYOUT RESPONSIBILITIES

| Path                 | Responsibility                                                       |
| -------------------- | -------------------------------------------------------------------- |
| `apps/api`           | Public/private REST API; owns ALL business logic; hosts adapters.    |
| `apps/web`           | Next.js marketplace UI (public/buyer/seller/admin route groups).     |
| `apps/mobile`        | Flutter thin client; talks only to API; no business rules.           |
| `packages/domain`    | Pure domain + policy engines (scoring, fees, tiers, state machines). |
| `packages/contracts` | Shared request/response types generated from OpenAPI.                |
| `packages/config`    | Typed configuration schemas + validation.                            |
| `workers/*`          | Async processors; consume queues; no direct user traffic.            |
| `infra/*`            | Docker, compose, deploy manifests.                                   |
| `prisma/*`           | Schema, append-only migrations, idempotent seeds.                    |
| `tests/*`            | E2E, integration (Testcontainers), load (k6), failure injection.     |

---

## 7. OPEN INTEGRATION BOUNDARIES (do NOT invent contracts)

| Boundary                    | Status                        | Action required                                                                                                                                                                                |
| --------------------------- | ----------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **DPO Pay merchant API**    | **UNKNOWN** — no spec in repo | Obtain official DPO merchant integration spec; only then define request/response fields. Until then code against `PaymentProvider` port + a `DpoPaymentProvider` **stub** marked `TODO(spec)`. |
| DPO split/settlement fields | **UNKNOWN**                   | Documented, not invented (audit rule #18).                                                                                                                                                     |
| YouTube Data API            | Public, documented            | Confirm quota + OAuth scopes.                                                                                                                                                                  |
| Instagram Graph API         | Restricted                    | Confirm business verification + access tiers.                                                                                                                                                  |
| Scanner APIs                | Mixed (SaaS / self-hosted)    | Confirm hosting + licensing per scanner.                                                                                                                                                       |
| Tax rules per country       | Business input required       | Confirm with finance/legal per country.                                                                                                                                                        |

See PAYMENT_ARCHITECTURE.md § "DPO boundary" for the exact integration seam.

---

## 8. WHY A MODULAR MONOLITH (explicit recommendation)

Per Phase 0.3: _"Do NOT automatically make each one a microservice."_ The domain list (identity,
listings, auctions, bids, payments, escrow, ledger, disputes, …) has strong transactional
coupling — e.g., **auction close → order → payment intent → escrow hold → ledger entries** must be
atomic or compensating within one database. A modular monolith:

- gives us ACID transactions across these contexts today;
- keeps refactoring cheap (move a module to a worker when profiling proves it needs isolation);
- avoids premature operational complexity (service discovery, distributed tracing, sagas) that a
  brand-new, unfunded team cannot yet absorb.

Extraction to separate services is planned **only** for the four workers in §5, and only on
evidence (isolation or resource requirements), never on theory.
