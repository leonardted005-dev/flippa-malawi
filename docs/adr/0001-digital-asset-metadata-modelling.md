# ADR 0001 — Digital asset metadata modelling

- **Status:** Accepted (Phase 3)
- **Date:** 2026-10-01
- **Deciders:** Principal Architect, Staff Full-Stack Engineer
- **Related:** `docs/DOMAIN_MODEL.md` §2, `docs/DATABASE_ARCHITECTURE.md`, `prisma/schema.prisma`

## Context

The marketplace must list eight structurally different asset kinds — software, websites, mobile
apps, YouTube channels, Instagram profiles, gaming accounts, domains, and a free-form "other" —
across 20+ African countries. Each kind has its own required fields, its own ownership-verification
path, and its own set of meaningful marketplace metrics (subscribers vs. traffic vs. level/rank).

Hard requirements from the Phase 0 brief:

- **One** asset abstraction; **not** an unrelated schema per asset kind.
- Per-kind validation rules.
- Filtering/sorting by numeric metrics (traffic, subscribers, revenue) is a core product feature.
- Scanner output and ownership proofs are **platform-owned** and must never be client-settable.
- Money is integer minor units; the domain layer must remain I/O-free.

## Options considered

1. **Class-table inheritance** (a shared `digital_assets` row + one 1:1 metadata table per kind).
2. **Single table with a validated JSONB blob** (`digital_assets.metadata`).
3. **EAV / key-value attributes** (an `asset_attributes(asset_id, key, value)` table).
4. **One independent schema/table per kind with no shared row.**

## Decision

Adopt **option 1 — class-table inheritance**, with a **narrow, validated `extra` JSONB column** for
long-tail fields:

- `digital_assets` holds the shared identity/all lifecycle fields (`type`, `title`, `slug`,
  `sellerId`, `country`, `currency`, `categoryId`, `status`, `verificationStatus`,
  `qualityStatus`, `version`, timestamps).
- Seven typed metadata tables (`asset_metadata_software`, `…_website`, `…_mobile`, `…_youtube`,
  `…_instagram`, `…_game`, `…_domain`) hold the per-kind fields as **real, indexed columns**, each
  1:1 via `asset_id` with `ON DELETE CASCADE`.
- `OTHER` keeps its human description in the validated `extra` JSONB column, because it has no
  stable shape and always requires manual review.
- Client-facing validation lives in `@fa/domain` as one **Zod schema per kind**
  (`packages/domain/src/assets/schemas.ts`) exposed through a registry
  (`ASSET_TYPE_REGISTRY`) that also declares, per kind: the ownership-verification method, whether
  manual review is required, the metric slots that apply, and the natural-key field.
- Platform-owned fields (scanner findings, `qualityScore`, `analyticsVerified`, `snapshotId`) are
  **absent from the client schemas** and can only be written by platform code (Phases 7–8).

## Why not the alternatives

- **Option 2 (single JSONB blob)** is flexible but makes the primary marketplace queries
  (`WHERE monthly_traffic > X ORDER BY subscribers DESC`) fragile and unindexable without bespoke
  expression indexes. Traffic, subscribers and revenue are first-class search dimensions.
- **Option 3 (EAV)** pushes type-safety and constraints out of the database entirely; every read
  becomes a pivot, and referential integrity is impractical.
- **Option 4 (fully separate schemas)** directly contradicts the brief's core abstraction
  requirement and would duplicate listings, orders, escrow and verification logic eight times.

## Consequences

**Positive**

- One FK graph for every downstream concern (listings, orders, escrow, quality reports).
- Per-kind columns are indexable, sortable and `NOT NULL`-able exactly where it matters.
- Adding an eighth kind is additive: new enum value + new metadata table + new Zod schema + registry
  entry — no changes to existing kinds.
- Validation rules are pure and unit-tested without a database.

**Negative / mitigations**

- A new kind requires a **migration** (accepted: kinds are a curated, slow-moving set).
- Reads must include the right relation; mitigated by a single `METADATA_INCLUDE`
  constant and one `toAssetView()` mapper that flattens the applicable relation and serialises
  `bigint`/`Date` values safely.
- Cross-kind queries that need one metric from several kinds (e.g. "all revenue-bearing assets")
  require unions or a future denormalised read model — planned for Phase 5 search/reporting if
  profiling shows it is needed.

## Validation contract (per kind, client-facing, enforced)

| Kind              | Required                   | Optional (client)                                                                  | Platform-owned                          |
| ----------------- | -------------------------- | ---------------------------------------------------------------------------------- | --------------------------------------- |
| SOFTWARE          | `packageSizeBytes` > 0     | language, framework, runtime, sourceRepo, dependencyCount, licenseSpdx             | license/security findings, qualityScore |
| WEBSITE           | `domain`                   | traffic, technology, hosting, revenue(+currency), analyticsProvider                | analyticsVerified, snapshot             |
| MOBILE_APP        | `platforms[]`              | bundleId, storeLinks, installs, revenue(+currency), appVersion                     | scan results                            |
| YOUTUBE_CHANNEL   | `channelId`                | subscribers, totalViews, videoCount, channelAgeDays, monetized, revenue(+currency) | snapshotId                              |
| INSTAGRAM_PROFILE | `accountId`                | followers, engagementBps (≤10000), mediaCount, accountAgeDays                      | snapshotId                              |
| GAME_ACCOUNT      | game, platform, accountRef | levelRank, inventory[], banState, transferable                                     | banState verification                   |
| DOMAIN            | `domainName`               | registrar, expiresAt, transferLocked, dns[]                                        | registrar proof                         |
| OTHER             | `description` (≥10)        | —                                                                                  | manual review required                  |

**Cross-field rule:** any revenue amount requires an explicit ISO-4217 `revenueCurrency`.
