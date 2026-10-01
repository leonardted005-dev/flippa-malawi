# Pan-African Digital Asset Marketplace

A production-oriented marketplace / auction house for transferable **digital assets** (software,
websites, mobile apps, YouTube channels, Instagram profiles, gaming accounts, domains and more)
across 20+ African countries, with **Zambia** as the initial corporate/payment anchor.

> **Status: Phase 1 — repository foundation.** This repository contains scaffolding only. There are
> **no marketplace business features yet** (no listings, auctions, payments, escrow or ledger logic).
> The architecture blueprint lives in [`docs/`](./docs/README.md).

---

## Repository layout

```
apps/
  api/        NestJS modular monolith — owns ALL business logic
  web/        Next.js web marketplace (skeleton)
  mobile/     Flutter thin client (skeleton)
packages/
  config/     Typed environment configuration (@fa/config)
  contracts/  Shared API DTOs (@fa/contracts)
  domain/     Pure domain primitives, e.g. Money (@fa/domain)
prisma/       Schema, migrations, idempotent seed
infra/        Dockerfiles and local infra
docs/         Architecture audit + blueprint (Phase 0)
scripts/      Repo tooling (migration drift check)
```

## Prerequisites

- Node.js >= 20 and **pnpm 12** (via `corepack enable`)
- Docker (for local Postgres/Redis/MinIO)
- Flutter (only for `apps/mobile`)

## Quickstart

```bash
corepack enable
pnpm install

# start local infrastructure (Postgres, Redis, MinIO)
docker compose up -d

cp .env.example .env      # then fill in values

pnpm exec prisma generate
pnpm exec prisma migrate deploy
pnpm db:seed

pnpm dev                  # api + web via Turbo
```

- API: http://localhost:4000/api/v1/health/live
- Web: http://localhost:3000

## Common scripts

| Script                         | Purpose                               |
| ------------------------------ | ------------------------------------- |
| `pnpm build`                   | Build all workspace packages (Turbo)  |
| `pnpm typecheck`               | TypeScript project checks             |
| `pnpm test`                    | Unit + integration tests              |
| `pnpm lint`                    | Linters                               |
| `pnpm format` / `format:check` | Prettier                              |
| `pnpm db:migrate`              | Create/apply dev migration            |
| `pnpm db:migrate:deploy`       | Apply migrations (CI/prod)            |
| `pnpm db:drift`                | Fail if schema drifts from migrations |
| `pnpm db:seed`                 | Idempotent seed                       |

## Non-negotiable engineering rules

These come from the Phase 0 audit and apply to all future work:

1. The marketplace owns business logic; providers (DPO Pay, scanners, storage, social APIs) sit
   behind **ports/adapters**.
2. **Money is integer minor units** (`bigint`) — never floating point.
3. Financial records are **immutable**; corrections are compensating entries.
4. Clients are untrusted: prices, timers and payment state are **server-authoritative**.
5. Webhooks are **idempotent**; a browser redirect never confirms payment.
6. Uploaded code is **never executed** in the API; scanning runs in isolated workers.
7. **Do not invent DPO API fields** — the adapter surface awaits the official merchant spec.
8. No WebView designed to circumvent App Store / Play Store policies.
9. Flippa is a **UX reference only** — no copying of its UI, branding, wording or assets.

See [`docs/ARCHITECTURE_AUDIT.md`](./docs/ARCHITECTURE_AUDIT.md) for the full audit and
[`docs/IMPLEMENTATION_ROADMAP.md`](./docs/IMPLEMENTATION_ROADMAP.md) for the phase plan.
