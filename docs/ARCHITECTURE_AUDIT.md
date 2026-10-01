# ARCHITECTURE AUDIT — Phase 0

**Project:** Pan-African P2P Digital Asset Marketplace / Auction House
**Working name (placeholder):** `flippa-africa` (final product name TBD; must NOT use Flippa branding)
**Audit date:** 2026-01-10
**Auditor role:** Principal Software Architect / Staff Full-Stack Engineer / Security Architect / Product Engineering Lead
**Audit scope:** Entire repository at `c:\Users\adela\OneDrive\Desktop\flippa afrca`

---

## 0. EXECUTIVE SUMMARY

> **The repository is GREENFIELD / EMPTY.** It contains no files, no directories, no version
> control, and no source of any kind.

This single fact governs the entire document set. Every "current state" question in the audit
brief (Phase 0) is answered with **"None — no implementation exists"**, verified with the evidence
below. Because there is no existing code, there is nothing to preserve, nothing to refactor,
nothing to migrate, and nothing to break.

Consequently:

- This audit **does not fabricate** any existing framework, database, auth system, or integration.
- The documents in `docs/` are a **greenfield blueprint** ("TARGET" state), not a diff against
  working infrastructure. They are still fully valid as Phase 0.19 deliverables ("documentation
  only; do not modify production source").
- The correct first implementation phase is **repository scaffolding**, not "cleanup".

### Evidence collected

| Check                        | Command / Method                                                                                       | Result                            |
| ---------------------------- | ------------------------------------------------------------------------------------------------------ | --------------------------------- |
| Recursive file count         | `Get-ChildItem -Recurse -File -Force \| Measure-Object`                                                | **0 files**                       |
| Total item count (all types) | `Get-ChildItem -Force \| Measure-Object`                                                               | **0 items**                       |
| Hidden / `.git` present      | `Test-Path '.git'` / `Test-Path '.gitignore'`                                                          | `False` / `False`                 |
| Git repo status              | `git status`                                                                                           | `fatal: not a git repository`     |
| Manifest search              | regex `package.json`, `pubspec.yaml`, `requirements.txt\|pyproject.toml`, `docker-compose\|Dockerfile` | **No results (0 files searched)** |

**Conclusion:** There is no codebase to audit. This document records that finding and pivots to the
target architecture blueprint.

---

## 1. PHASE 0 — REPOSITORY AUDIT (30 QUESTIONS)

Because the repository is empty, each item is reported as **not present**, with the _recommended
target_ noted so the answer remains actionable. "None" = genuinely no artifact exists.

| #   | Question                              | Finding in repo | Target decision (see TARGET_ARCHITECTURE.md)                       |
| --- | ------------------------------------- | --------------- | ------------------------------------------------------------------ |
| 1   | Framework                             | **None**        | NestJS (TypeScript) modular monolith _(assumption A1)_             |
| 2   | Frontend architecture                 | **None**        | Next.js App Router, SSR/ISR web marketplace _(A1)_                 |
| 3   | Backend architecture                  | **None**        | Modular monolith, hexagonal ports/adapters                         |
| 4   | Database technology                   | **None**        | PostgreSQL 16 (ACID, row locks)                                    |
| 5   | ORM / query layer                     | **None**        | Prisma for CRUD; raw parameterized SQL for ledger/auction          |
| 6   | Authentication                        | **None**        | Auth module; JWT access + rotating refresh; optional social IdP    |
| 7   | Existing payment integrations         | **None**        | `PaymentProvider` port; first adapter = DPO Pay _(A2)_             |
| 8   | Existing storage                      | **None**        | `ObjectStorage` port; R2 / B2 / Supabase adapters                  |
| 9   | Existing API architecture             | **None**        | REST `/api/v1`, versioned, OpenAPI 3.1                             |
| 10  | Existing testing architecture         | **None**        | Jest (unit), Supertest (integration), Testcontainers, Flutter test |
| 11  | Existing CI/CD                        | **None**        | GitHub Actions _(A3)_                                              |
| 12  | Existing environment configuration    | **None**        | `.env` + typed config module; secrets only in CI/deploy            |
| 13  | Existing Docker configuration         | **None**        | `docker-compose` local (api, web, postgres, redis, minio)          |
| 14  | Existing mobile application structure | **None**        | Flutter (feature-first, Riverpod) _(A1)_                           |
| 15  | Existing web application structure    | **None**        | Next.js route groups: public/buyer/seller/admin                    |
| 16  | Existing design system                | **None**        | New token-based design system (MARKETPLACE_UX_ARCHITECTURE.md)     |
| 17  | Existing component library            | **None**        | Headless primitives + in-house components (no Flippa UI)           |
| 18  | Existing routing                      | **None**        | NestJS controllers (API) + Next.js App Router (web)                |
| 19  | Existing state management             | **None**        | Server-state query cache (web); Riverpod (Flutter)                 |
| 20  | Existing validation                   | **None**        | `zod`/`class-validator` at boundary + DB constraints               |
| 21  | Existing logging                      | **None**        | Structured JSON logs + correlation IDs                             |
| 22  | Existing error handling               | **None**        | Global filter → RFC 7807 `problem+json`                            |
| 23  | Existing security controls            | **None**        | Driven by SECURITY_THREAT_MODEL.md                                 |
| 24  | Existing database migrations          | **None**        | Prisma Migrate, forward-only, append-only                          |
| 25  | Existing seed data                    | **None**        | Idempotent seeds (tax rates, plans, categories)                    |
| 26  | Existing deployment configuration     | **None**        | Containerized; target TBD _(A3)_                                   |
| 27  | Existing third-party integrations     | **None**        | All behind adapters                                                |
| 28  | Existing TODOs                        | **None**        | —                                                                  |
| 29  | Existing unfinished features          | **None**        | —                                                                  |
| 30  | Existing technical debt               | **None**        | —                                                                  |

---

## 2. PHASE 0.1 — PROJECT MAP

The current repository has **no project tree** (empty). The _proposed_ tree below is the target
layout implementation will create; it is documented here so Phase 1 has a concrete blueprint.
Generated/vendor output (`node_modules`, `dist`, `.next`, `build`, `.dart_tool`, caches) excluded.

```
flippa-africa/                     # (to be created in Phase 1)
├─ docs/                           # ← THIS DOCUMENT SET (architecture only)
├─ apps/
│  ├─ api/                         # NestJS modular monolith (owns ALL business logic)
│  │  └─ src/
│  │     ├─ main.ts                # API entrypoint
│  │     ├─ app.module.ts          # root module wiring
│  │     ├─ modules/               # bounded contexts (see DOMAIN_MODEL.md)
│  │     ├─ integrations/          # ADAPTERS (ports live in domain)
│  │     └─ common/                # guards, filters, interceptors, config
│  ├─ web/                         # Next.js web marketplace (public/buyer/seller/admin)
│  └─ mobile/                      # Flutter app (thin client — no business logic)
├─ packages/
│  ├─ contracts/                   # shared DTOs / OpenAPI types (api ↔ web)
│  ├─ domain/                      # pure domain logic + policy engines (no I/O)
│  └─ config/                      # typed config schemas, shared constants
├─ workers/                        # independently deployable async workers
│  ├─ scan-runner/                 # isolated scanner sandbox (never runs in API)
│  ├─ media-worker/                # image/video processing, metadata extraction
│  ├─ webhook-worker/              # payment webhook processing (idempotent)
│  └─ settlement-worker/           # ledger settlement, payouts, reconciliation
├─ infra/
│  ├─ docker/                      # Dockerfiles
│  ├─ compose/                     # local docker-compose
│  └─ deploy/                      # deploy manifests (target TBD)
├─ prisma/
│  ├─ schema.prisma
│  ├─ migrations/                  # append-only
│  └─ seed/                        # idempotent seeds
├─ tests/                          # e2e / integration / load harness
└─ .github/workflows/              # CI/CD
```

**Entrypoint & responsibility index:**

| Concern                | Location                                                                  |
| ---------------------- | ------------------------------------------------------------------------- |
| Application entrypoint | `apps/api/src/main.ts`                                                    |
| API entrypoints (HTTP) | `apps/api/src/modules/*/interfaces/*.controller.ts`                       |
| Database entrypoint    | `prisma/schema.prisma` + `apps/api/src/**/infrastructure/*.repository.ts` |
| Authentication         | `apps/api/src/modules/identity/...`                                       |
| Routing                | NestJS controllers (API); Next.js App Router (web)                        |
| Shared components      | `apps/web/src/components/*`; `packages/contracts/*`                       |
| Domain logic           | `packages/domain/*` + `apps/api/src/modules/*/domain/*`                   |
| Integrations/adapters  | `apps/api/src/integrations/*`                                             |
| Workers                | `workers/*`                                                               |
| Tests                  | `tests/*` + colocated `*.spec.ts`                                         |
| Migrations             | `prisma/migrations/*`                                                     |
| Configuration          | `packages/config/*`, `apps/api/src/common/config/*`, `.env`               |
| Deployment             | `infra/*`, `.github/workflows/*`                                          |

---

## 3. PHASE 0.2 — CURRENT STATE vs TARGET STATE

Because the repository is empty, the "current" column is uniformly empty. This is not a
refactoring exercise; it is **pure construction**. The value of the table is that it pre-answers
every preserve/refactor/replace decision so Phase 1 has no ambiguity.

```
CURRENT REPOSITORY (empty)          TARGET MARKETPLACE ARCHITECTURE
      (nothing)          ──►        apps/{api,web,mobile} + packages/* + workers/*
```

| Classification                   | Items                                                                                                                                                                                                                                                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Preserve as-is**               | _None — nothing exists to preserve._                                                                                                                                                                                                                                                                                                    |
| **Exists but needs refactoring** | _None._                                                                                                                                                                                                                                                                                                                                 |
| **Incomplete**                   | _None._                                                                                                                                                                                                                                                                                                                                 |
| **Missing (must build)**         | Everything: identity, sellers, tiers, verification, digital-asset abstraction, listings, auctions, bids, offers, watchlists, messaging, orders, payments (+DPO adapter), escrow, ledger, settlements, tax/FX, storage, quality/scanning, notifications, disputes, reviews, audit, admin, reporting, web app, Flutter app, CI/CD, infra. |
| **Should NOT be built**          | Homemade static-analysis engine used as the _primary_ security mechanism; WebView payment flows designed to circumvent store policies; provider-specific logic baked into domain/UI; separate DB per asset type; microservice-per-domain.                                                                                               |
| **Should be replaced**           | _None (nothing to replace)._                                                                                                                                                                                                                                                                                                            |
| **Can be reused**                | _None of ours yet_ — but we intentionally reuse mature **external** systems (DPO, scanners, social APIs, S3-compatible storage) behind adapters rather than rebuilding them.                                                                                                                                                            |

**Guiding rule applied:** _"Do not redesign working infrastructure merely for theoretical
cleanliness."_ There is no working infrastructure, so all effort goes to net-new construction with
correct boundaries from day one.

---

## 4. PHASE 0.3 — TARGET DOMAIN MODEL (summary)

Full detail lives in **DOMAIN_MODEL.md**. Headline decisions:

- **Modular monolith**, not microservices. Contexts (identity, sellers, buyers, verification,
  catalog, listings, auctions, watchlists, messaging, quality, orders, payments, escrow, ledger,
  tax/FX, storage, notifications, disputes, reviews, audit, admin, reporting) are **modules**.
- **Four deployable workers only** (scan-runner, media-worker, webhook-worker, settlement-worker),
  justified by isolation/resources, not theory.
- **Digital asset abstraction**: one `DigitalAsset` + typed per-type metadata, each with its own
  validator — never one unrelated schema per asset type.

---

## 5. FINAL AUDIT REPORT

### A. Repository stack

**Empty.** No language, framework, runtime, or package manifest exists. **(Verified: 0 files.)**

### B. Current architecture

None. No layers, modules, services, or boundaries exist.

### C. Current database

None. No schema, migration, ORM, or seed. **Target:** PostgreSQL 16 + Prisma Migrate (append-only).

### D. Current authentication

None. **Target:** own identity module (JWT access + rotating refresh), optional social IdP.

### E. Current frontend

None. **Target:** Next.js (App Router) web marketplace, public/buyer/seller/admin route groups.

### F. Current mobile state

None. **Target:** Flutter thin client (feature-first, Riverpod), no business logic on device.

### G. Existing integrations

None. **Target:** DPO Pay, S3-compatible storage, scanner fleet, social APIs — **all behind ports**.

### H. Existing tests

None. **Target:** Jest + Supertest + Testcontainers (API), Flutter test (mobile), k6 (load),
failure-injection suites for payments/webhooks/concurrency.

### I. Critical architectural problems

There is no architecture to critique. The _risk_ is construction error, mitigated by this blueprint

- the "Strict Rules" gates in `IMPLEMENTATION_ROADMAP.md`. Specific risks to avoid:

* building a homemade scanner as the primary security engine;
* baking DPO specifics into domain/UI;
* inventing DPO API fields before the spec is available;
* using WebView to bypass store payment policy;
* per-asset-type database fragmentation;
* premature microservices.

### J. Missing functionality

**Everything** (see §3 table). This is a greenfield build.

### K. Security risks (target-state mitigations in SECURITY_THREAT_MODEL.md)

Greenfield risk = implementing without the threat model. Top risks to pre-empt: fake sellers / stolen
assets, malicious uploads / ZIP bombs, API-key leakage, webhook forgery/replay, IDOR, admin
compromise, object-storage abuse.

### L. Payment risks

Greenfield. Key hazards: trusting client prices, trusting a browser redirect as confirmation,
non-idempotent webhooks, double settlement, currency mismatch, missing reconciliation. All addressed
in PAYMENT_ARCHITECTURE.md.

### M. Data-model risks

Greenfield. Key hazards: float money, mutable financial rows, missing idempotency keys, missing
unique constraints on bids/refunds, asset-type schema fragmentation. Addressed in
DATABASE_ARCHITECTURE.md.

### N. Recommended target architecture

Modular monolith (NestJS) + PostgreSQL + Redis/BullMQ + 4 workers + Next.js web + Flutter mobile,
hexagonal ports/adapters, config-driven tiers/policies. (TARGET_ARCHITECTURE.md.)

### O. Exact implementation phases

See **IMPLEMENTATION_ROADMAP.md** (Phases 1–16, dependency-ordered).

### P. Files that will need modification in Phase 1

**None exist yet.** Phase 1 _creates_ the scaffold. It will create (all new):
`package.json`, `pnpm-workspace.yaml`/`turbo.json`, `tsconfig.base.json`, `docker-compose.yml`,
`apps/api/*`, `apps/web/*`, `packages/{domain,contracts,config}/*`, `prisma/schema.prisma`,
`.github/workflows/ci.yml`, `.env.example`, `.gitignore`, `README.md`.

### Q. Files that must NOT be modified

- **This `docs/` set** — treat as the frozen Phase-0 baseline; update only via new revisions/ADRs.
- Any future `prisma/migrations/*` **already applied to a shared environment** — never rewrite DB
  history; add forward migrations only.
- No third-party provider code (DPO, scanners) is vendored; do not fork their SDKs.

### R. Assumptions requiring confirmation

- **A1** Tech stack: NestJS + Next.js + Flutter + PostgreSQL + Prisma _(recommended, not confirmed)_.
- **A2** Payment: DPO Pay is the **first** provider, but the **official DPO merchant integration
  specification is NOT yet available** — fields must not be invented.
- **A3** CI/CD provider (GitHub Actions assumed) and deploy target (hosting) are unconfirmed.
- **A4** Object storage provider among R2/B2/Supabase is unconfirmed.
- **A5** Scanner fleet: which scanners are self-hosted vs SaaS, and licensing — unconfirmed.
- **A6** Seller-tier commercial parameters (quota numbers, fee percentages) are **placeholders**
  here — must be confirmed as business policy (kept configuration-driven).
- **A7** Tax rules per country and FX source are business/legal inputs — unconfirmed.
- **A8** Apple/Google policy stance for mobile payments (regional rules) — requires legal review.

### S. External credentials / API contracts required

| Need                                                          | Purpose                        | Status                   |
| ------------------------------------------------------------- | ------------------------------ | ------------------------ |
| **DPO merchant integration spec + sandbox + merchantId/keys** | Payment adapter fields & flows | **BLOCKING for Phase 9** |
| Object-storage credentials + bucket policy                    | Uploads/downloads              | Needed Phase 1/4         |
| YouTube Data API key + OAuth                                  | Channel snapshots/ownership    | Phase 8                  |
| Instagram Graph API access tier                               | Profile snapshots/ownership    | Phase 8                  |
| Scanner accounts/licenses (as chosen)                         | Quality engine                 | Phase 7                  |
| Email/SMS providers                                           | Notifications                  | Phase 2+                 |
| KYC/identity provider (if any)                                | Verification                   | Phase 2/8                |
| FX rate source                                                | Multi-currency                 | Phase 11                 |

---

## 6. DOCUMENT SET

| Document                           | Covers                                                                  |
| ---------------------------------- | ----------------------------------------------------------------------- |
| `ARCHITECTURE_AUDIT.md`            | **This file** — Phase 0 audit + final report                            |
| `TARGET_ARCHITECTURE.md`           | Layers, ports, deployables, layout                                      |
| `DOMAIN_MODEL.md`                  | Bounded contexts, aggregates, digital-asset abstraction, state machines |
| `DATABASE_ARCHITECTURE.md`         | Schema, constraints, ledger, migrations                                 |
| `API_ARCHITECTURE.md`              | REST boundaries, authz, idempotency, rate limiting                      |
| `PAYMENT_ARCHITECTURE.md`          | PaymentProvider port, DPO boundary, webhooks, reconciliation            |
| `QUALITY_ENGINE_ARCHITECTURE.md`   | Scanner adapters, normalization, policy engine                          |
| `SECURITY_THREAT_MODEL.md`         | Threats, mitigations, detection                                         |
| `MOBILE_ARCHITECTURE.md`           | Flutter structure + payment-routing abstraction                         |
| `MARKETPLACE_UX_ARCHITECTURE.md`   | Information architecture + design language                              |
| `IMPLEMENTATION_ROADMAP.md`        | Phases 1–16 in dependency order                                         |
| `OBSERVABILITY_AND_CONCURRENCY.md` | _Additional_ — concurrency (0.17) + observability (0.18)                |
