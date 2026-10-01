# IMPLEMENTATION ROADMAP

**Status:** Greenfield, dependency-ordered. Phases are **adjusted to an empty repository** (there is
no code to clean up), and each phase has an **exit criterion**. Do not start a phase until its
dependencies are met.

> No feature code before this audit/roadmap is accepted. Phase 1 begins **scaffolding only**.

---

## PHASE 1 — Foundation / repository initialization

**Goal:** a reproducible, CI-gated monorepo skeleton with **no business features**.

- Create the tree from `TARGET_ARCHITECTURE.md` § "Project map".
- Tooling: pnpm workspaces (+ Turbo/pnpm scripts), TS base config, ESLint/Prettier, Husky hooks.
- NestJS API skeleton (health endpoints), Next.js web skeleton, Flutter skeleton.
- `packages/{domain,contracts,config}`; Prisma schema bootstrap + first migration.
- `docker-compose` (postgres, redis, minio) + `.env.example`.
- CI: lint, typecheck, unit test, build, `prisma migrate diff` drift check, secret scan (Gitleaks).
- `docs/` committed as the baseline.
  **Exit:** `pnpm install && pnpm build && pnpm test` green in CI; local stack boots via compose.

## PHASE 2 — Identity / users / seller tiers

- Users, credentials, sessions, refresh rotation, MFA, password reset, email/phone verify.
- Roles (buyer/seller/admin + admin sub-roles); RBAC guards.
- Seller profiles, tiers, payout accounts; **central PlanPolicy** (config-driven).
- Audit log baseline; structured logging + request IDs.
  **Exit:** auth + tier policy covered by tests; no hard-coded limits in feature code.

## PHASE 3 — Digital asset abstraction

- `DigitalAsset` + typed metadata tables; per-type Zod schemas + validators.
- Category/type registry; draft asset lifecycle.
  **Exit:** each asset type validates and persists; ADR recorded on inheritance-vs-JSONB.

## PHASE 4 — Marketplace listings

- Listing lifecycle (draft→review→active→sold/paused/expired/withdrawn).
- Storage abstraction + presigned uploads; StorageObject registry; media-worker thumbnails.
  **Exit:** seller can create a listing end-to-end; policy quotas enforced server-side.

## PHASE 5 — Search / filtering / discovery

- Server-side browse/search filters per asset type; partial indexes + GIN; cursor pagination.
- Public pages: home, browse, categories, featured, recent, ending-soon, verified, high-value.
- Listing card component per `MARKETPLACE_UX_ARCHITECTURE.md`.
  **Exit:** filters/sort correct under load; SEO pages SSR/ISR.

## PHASE 6 — Auctions / bids / offers

- Auction lifecycle, server-authoritative timers, bid rules, offers, watchlists.
- Concurrency: row locks, idempotency keys, anti-self-bid, anti-snipe policy.
  **Exit:** concurrency tests prove no lost/oversold bids; invalid transitions rejected.

## PHASE 7 — Quality control / external scanners

- `scan-runner` worker + scanner port; first wave (e.g. Gitleaks, OSV/Trivy, ClamAV, Semgrep, Syft, ScanCode).
- Normalization → `SecurityFinding`; versioned `quality_policies`; PASS/REVIEW/FAIL.
- Raw-result retention + hashing; sandbox isolation; ZIP-bomb defenses.
  **Exit:** a malicious + a clean artifact produce correct decisions; results retained for audit.

## PHASE 8 — Asset verification

- Verification cases, ownership challenges per type, social snapshots (retained), KYC records.
- Admin verification queue.
  **Exit:** verified vs seller-reported data is distinguishable everywhere it's shown.

## PHASE 9 — Payments / DPO adapter

- Payment port + orchestrator + idempotency + webhook endpoint (raw-body verify + dedupe).
- **DPO adapter wired only after the official merchant spec is provided** (`TODO(spec)` until then).
- Conformance tests against the port.
  **Exit:** port conformance passes with a test double; **DPO integration completes when spec arrives**.

## PHASE 10 — Escrow / 7-day transaction lock

- Escrow holds, `release_eligible_at`, custody checklist + transfer verification, dispute hold.
- Independent payment/escrow/custody/transaction states.
  **Exit:** release blocked until funds + lock + verification; overrides audited with reason.

## PHASE 11 — Settlement / ledger / tax

- Immutable double-entry ledger (integer minor units), compensating entries only.
- Settlement worker, payouts, tax rates, FX (integer micro-rate), reconciliation.
  **Exit:** every money flow balances per currency; reconciliation reports zero unexplained drift.

## PHASE 12 — Admin / moderation / disputes

- Admin dashboards: users, listings, quality/security queues, verification, payments, escrow,
  disputes, fraud/risk, audit logs, sellers, health, reports.
  **Exit:** every admin action audited; admin MFA enforced; least-privilege sub-roles.

## PHASE 13 — Flutter application

- Thin client: auth, browse/search, listing detail, bidding, watchlist, seller create/upload,
  orders/escrow status, messaging, notifications/deep links, **policy-aware payment routing**.
  **Exit:** no business logic on device; store-compliance checklist satisfied.

## PHASE 14 — Security hardening

- Rate limits, WAF, IDOR/ownership review, secret hygiene, dependency/image scans, pen-test fixes.
  **Exit:** threat-model controls implemented + verified; no high findings open.

## PHASE 15 — Load / failure / payment testing

- k6 load tests (browse/search/bid peaks), failure injection (provider timeouts, webhook storms,
  duplicate events), auction-close and settlement race tests.
  **Exit:** defined SLOs met; failure modes degrade safely and reconcile.

## PHASE 16 — Production deployment

- Container images, IaC, secrets, migrations pipeline, backups/DR, monitoring/alerts, runbooks.
  **Exit:** blue/green deploy + rollback proven; on-call runbooks in place.

---

## DEPENDENCY GRAPH (why this order)

```
1 → 2 → 3 → 4 → 5 → 6 → 7 → 8
                     ↘         ↘
                      9 → 10 → 11 → 12 → 13
                                   ↘ 14 → 15 → 16
```

- Payments (9) need orders + listings; escrow (10) needs payments + custody; ledger (11) needs escrow;
  admin (12) needs all state to monitor; mobile (13) needs stable APIs; hardening/testing (14–15)
  need the full surface; deploy (16) needs everything.

## CROSS-PHASE GATES (all "Strict Rules")

At every phase: #9–#11 server-authoritative, #12 idempotent webhooks, #13 immutable finance,
#14 integer money, #15 retain scanner results, #16/#17 no execution in API + isolated scanners,
#18 no invented DPO fields, #19 no WebView circumvention, #20–#22 own visual identity, #23 no fake data.

## IMMEDIATE BLOCKERS

1. **DPO merchant integration specification + sandbox credentials** (blocks Phase 9 completion).
2. Confirmation of assumptions **A1–A8** (stack, storage provider, scanner hosting, tier numbers,
   tax/FX, store-payment legal stance) — see `ARCHITECTURE_AUDIT.md` §R/S.

## DEFINITION OF DONE (applies to every phase)

- Automated tests (unit + integration where state/money is involved) pass in CI.
- No secrets in code/logs/clients; audit logging present for new state changes.
- Idempotency + concurrency considered for every new mutation.
- Docs/ADRs updated; no invented provider contracts.
