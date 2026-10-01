# Architecture Documentation — Phase 0 (Audit + Blueprint)

This folder is the **Phase 0 deliverable**: a repository audit and a greenfield target
architecture blueprint for the Pan-African P2P Digital Asset Marketplace / Auction House.

> **Audit result:** the repository was **empty** (0 files) at Phase 0. There was no existing code,
> framework, database, auth, or integration to audit. These documents therefore describe the
> **target** architecture, not a diff against existing infrastructure. See `ARCHITECTURE_AUDIT.md`.

## Read in this order

1. [`ARCHITECTURE_AUDIT.md`](./ARCHITECTURE_AUDIT.md) — Phase 0 audit (30 questions), project map,
   current-vs-target, and the **Final Audit Report (A–S)**.
2. [`TARGET_ARCHITECTURE.md`](./TARGET_ARCHITECTURE.md) — principles, stack, ports/adapters,
   deployable units, repository layout.
3. [`DOMAIN_MODEL.md`](./DOMAIN_MODEL.md) — bounded contexts, digital-asset abstraction, state
   machines, tier policy, invariants.
4. [`DATABASE_ARCHITECTURE.md`](./DATABASE_ARCHITECTURE.md) — target schema, constraints, ledger,
   migrations, seeds.
5. [`API_ARCHITECTURE.md`](./API_ARCHITECTURE.md) — REST boundaries, per-mutation controls, authz.
6. [`PAYMENT_ARCHITECTURE.md`](./PAYMENT_ARCHITECTURE.md) — PaymentProvider port, DPO boundary,
   webhooks, escrow.
7. [`QUALITY_ENGINE_ARCHITECTURE.md`](./QUALITY_ENGINE_ARCHITECTURE.md) — scanner adapters,
   normalized findings, policy engine.
8. [`SECURITY_THREAT_MODEL.md`](./SECURITY_THREAT_MODEL.md) — threats, mitigations, detection.
9. [`MOBILE_ARCHITECTURE.md`](./MOBILE_ARCHITECTURE.md) — Flutter structure, payment routing.
10. [`MARKETPLACE_UX_ARCHITECTURE.md`](./MARKETPLACE_UX_ARCHITECTURE.md) — IA, design language,
    listing card.
11. [`IMPLEMENTATION_ROADMAP.md`](./IMPLEMENTATION_ROADMAP.md) — Phases 1–16.
12. [`OBSERVABILITY_AND_CONCURRENCY.md`](./OBSERVABILITY_AND_CONCURRENCY.md) — concurrency (0.17) +
    observability (0.18).

## Status

**No production source code was created or modified.** This is documentation only, per Phase 0.19.
Implementation begins at **Phase 1** in `IMPLEMENTATION_ROADMAP.md`.

## Key blockers (see audit §R/S)

- **DPO Pay merchant integration specification** (fields must not be invented).
- Confirmation of assumptions **A1–A8** (stack, storage, scanners, tier numbers, tax/FX, store policy).
