# DOMAIN MODEL

**Status:** Greenfield blueprint. Bounded contexts, aggregates, invariants, and state machines.
**Rule:** each context is a **module** in the monolith (not a service) unless TARGET_ARCHITECTURE.md
§ "Deployable units" says otherwise.

---

## 1. BOUNDED CONTEXTS

| Context             | Type       | Core aggregates                                                | Owns                                                   |
| ------------------- | ---------- | -------------------------------------------------------------- | ------------------------------------------------------ |
| **Identity**        | Core       | `User`, `Credential`, `Session`, `RefreshToken`                | authn, account lifecycle                               |
| **Sellers**         | Core       | `SellerProfile`, `SellerTier`, `PayoutAccount`                 | seller identity, tier, payout routing                  |
| **Buyers**          | Supporting | `BuyerProfile`                                                 | buyer preferences, KYC-lite                            |
| **Verification**    | Core       | `VerificationCase`, `OwnershipProof`, `KycRecord`              | identity/ownership/asset verification                  |
| **Catalog**         | Core       | `DigitalAsset`, `AssetMetadata`, `Category`                    | canonical asset abstraction                            |
| **Listings**        | Core       | `Listing`                                                      | fixed-price + auction listing lifecycle                |
| **Auctions**        | Core       | `Auction`, `Bid`, `Offer`                                      | bidding, offers, timers, reserve                       |
| **Watchlists**      | Supporting | `Watchlist`, `WatchlistItem`                                   | saved assets                                           |
| **Messaging**       | Supporting | `Conversation`, `Message`                                      | buyer↔seller comms (scoped, moderated)                 |
| **Quality Control** | Core       | `ScanRun`, `SecurityFinding`, `QualityReport`, `QualityPolicy` | orchestration + normalized findings + PASS/REVIEW/FAIL |
| **Orders**          | Core       | `Order`                                                        | purchase transaction                                   |
| **Payments**        | Core       | `PaymentIntent`, `PaymentEvent`                                | provider-agnostic payment lifecycle                    |
| **Escrow**          | Core       | `EscrowHold`, `EscrowRelease`                                  | marketplace escrow + 7-day lock                        |
| **Ledger**          | Core       | `LedgerAccount`, `LedgerEntry`, `Settlement`                   | immutable double-entry money                           |
| **Tax/FX**          | Supporting | `TaxRate`, `FxQuote`                                           | tax rules + currency conversion                        |
| **Storage**         | Supporting | `StorageObject`                                                | object metadata + access policy                        |
| **Notifications**   | Supporting | `Notification`                                                 | email/SMS/push                                         |
| **Disputes**        | Core       | `Dispute`                                                      | post-sale conflict resolution                          |
| **Reviews**         | Supporting | `Review`                                                       | seller/asset ratings                                   |
| **Audit**           | Generic    | `AuditLog`                                                     | append-only compliance trail                           |
| **Admin**           | Generic    | —                                                              | cross-context operations + moderation                  |
| **Reporting**       | Generic    | materialized views                                             | analytics/read models                                  |

**Asset transfer & custody** is a sub-context spanning Listings→Orders→Escrow (see §4).

---

## 2. DIGITAL ASSET ABSTRACTION (Phase 0.6)

**One table, many metadata shapes.** We do NOT create an unrelated DB schema per asset type.

```
DigitalAsset (common columns: id, type, title, sellerId, country, currency,
              verificationStatus, qualityStatus, createdAt, ...)
     ├── SOFTWARE        ──► SoftwareMetadata
     ├── WEBSITE         ──► WebsiteMetadata
     ├── MOBILE_APP      ──► MobileAppMetadata
     ├── YOUTUBE_CHANNEL ──► YouTubeMetadata
     ├── INSTAGRAM_PROFILE ─► InstagramMetadata
     ├── GAME_ACCOUNT    ──► GameAccountMetadata
     ├── DOMAIN          ──► DomainMetadata
     └── OTHER           ──► (flexible JSON `extra` + reviewed manually)
```

Implementation options (decide in Phase 3, record ADR):
(a) **Class-table inheritance** — `DigitalAsset` + one 1:1 metadata table per type (typed, indexable).
(b) **Single-table + validated JSONB** — `DigitalAsset.metadata JSONB` validated per type by a schema.
**Recommendation:** (a) for the asset types with searchable numeric metrics (software, website,
youtube, instagram, gaming, domain), because filtering/sorting on columns stays fast and indexable;
allow a small validated `extra JSONB` for long-tail fields. Each type has its **own Zod schema** and
its **own `AssetTypeValidator`** in `packages/domain`.

### Per-type validation rules (target)

| Type                  | Required / captured fields                                                                                      | Validation rules                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| **Software**          | package size, repo/source, framework, runtime, dependencies, license findings, security findings, quality score | size ≤ tier quota; dependency + secret + malware scan required; no critical findings; license compatibility checked; never executed in API |
| **Website**           | domain, traffic, technology, hosting, revenue, analytics                                                        | DNS/Domain ownership proof; analytics read-only OAuth; revenue requires statement evidence; traffic snapshot retained                      |
| **Mobile App**        | platforms, store links, installs, revenue, bundle id                                                            | store-ownership proof; MobSF scan for APK/IPA; version match                                                                               |
| **YouTube Channel**   | channelId, subscribers, views, videos, age                                                                      | channel ownership (OAuth); API snapshot retained with timestamp; monetization status                                                       |
| **Instagram Profile** | accountId, followers, engagement, media count                                                                   | account ownership (Graph API); snapshot retained; engagement window defined                                                                |
| **Game Account**      | game, platform, accountId, level/rank, inventory, ban state                                                     | ban/transfer-eligibility check; platform ToS transfer feasibility; ownership challenge                                                     |
| **Domain**            | domain name, registrar, expiry, DNS                                                                             | registrar-level ownership/EPP/auth-code proof; transfer lock check                                                                         |
| **Other**             | free metadata + evidence                                                                                        | manual review mandatory                                                                                                                    |

**Cross-cutting:** every asset carries `verificationStatus`, `qualityStatus`, `country`,
`currency`, and `evidenceRefs[]`. Metrics that don't apply to a type are simply absent (see UX doc:
"only show metrics that apply").

---

## 3. STATE MACHINES (all server-authoritative)

State transitions are validated in the domain layer; invalid transitions are rejected even if a
client sends them.

```
LISTING:     DRAFT → PENDING_REVIEW → QUALITY_REVIEW ─┬→ ACTIVE → SOLD
                                                     ├→ REJECTED
                                                     └→ DRAFT (returned for edits)
             ACTIVE → PAUSED → ACTIVE
             ACTIVE → EXPIRED | WITHDRAWN

AUCTION:     SCHEDULED → LIVE → (ENDING_SOON) → CLOSED
             CLOSED ─┬→ RESERVE_MET  → AWAITING_PAYMENT → COMPLETED
                     ├→ RESERVE_NOT_MET (no sale)
                     └→ CANCELLED (admin/seller before bids, policy-bound)
             AWAITING_PAYMENT → PAYMENT_EXPIRED (winner default) → relist/re-offer

BID/OFFER:   PLACED → (ACTIVE) → OUTBID | ACCEPTED | REJECTED | WITHDRAWN | EXPIRED

ORDER:       CREATED → AWAITING_PAYMENT → PAID → IN_ESCROW → ASSET_TRANSFER_PENDING
             → TRANSFER_VERIFICATION → RELEASED → SETTLED
             side paths: DISPUTED, REFUNDED, CANCELLED, CHARGEBACK

PAYMENT:     INITIATED → PENDING → AUTHORIZED → CAPTURED → (REFUNDED | PARTIALLY_REFUNDED)
             failure: DECLINED | FAILED | EXPIRED | VOIDED
             (Authorization ≠ capture; both are provider-agnostic states.)

ESCROW:      NOT_FUNDED → HELD → RELEASE_ELIGIBLE (after 7-day lock) → RELEASED
             ESCROW: HELD → DISPUTE_HOLD → (RELEASED | REFUNDED_TO_BUYER | SPLIT)

ASSET CUSTODY: WITH_SELLER → TRANSFER_INITIATED → TRANSFER_VERIFIED → WITH_BUYER
               (independent from payment + escrow states — see Phase 0.9)

DISPUTE:     OPENED → EVIDENCE_COLLECTION → UNDER_REVIEW → (RESOLVED_BUYER
             | RESOLVED_SELLER | RESOLVED_SPLIT | ESCALATED) → CLOSED
```

**Critical rule (Phase 0.9):** payment state, escrow state, asset-custody state, and transaction
state are **four independent dimensions**. A 7-day marketplace lock is NOT a card preauthorization;
they are separate concepts and separate columns/tables.

---

## 4. ASSET TRANSFER & CUSTODY

Not every asset transfers the same way. Custody is modeled explicitly:

| Asset type        | Transfer mechanism (target)                                                   |
| ----------------- | ----------------------------------------------------------------------------- |
| Software          | deliver artifact bundle + IP/rights assignment doc; revoke seller-side access |
| Website           | domain EPP/auth-code + hosting + analytics handover checklist                 |
| Mobile app        | store account/ownership transfer per store process                            |
| YouTube/Instagram | account ownership handover process + credential reset                         |
| Game account      | platform-specific transfer/rename + recovery info reset                       |
| Domain            | registrar push / auth-code                                                    |

Each transfer has a **checklist model** (`AssetTransferChecklist`, `TransferStep`) so custody can be
tracked and requires **buyer verification** before escrow release.

---

## 5. SELLER TIERS AS CENTRAL POLICY (Phase 0.11)

**Do not hard-code arbitrary limits in feature code.** All tiers resolve through one policy service:

```ts
// packages/domain/policies/plan-policy.ts
interface PlanPolicy {
  code: 'FREE_CODER' | 'PRO_CODER' | 'CORPORATE_SELLER';
  storageQuotaBytes: number | 'unlimited';
  maxUploadBytesPerFile: number;
  maxActiveListings: number | 'unlimited';
  commissionBps: number;              // basis points; 1500 = 15.00%
  qualityQueue: 'standard' | 'priority';
  scannersEnabled: ScannerKind[];
  verificationLevel: 'basic' | 'enhanced' | 'enterprise';
  features: Record<string, boolean>;
}
resolvePolicy(sellerTier, config): PlanPolicy
```

**Placeholder values (A6 — must be confirmed as business policy, not hard-coded in features):**

| Tier               | Storage quota | Max file   | Commission       | Queue    | Verification |
| ------------------ | ------------- | ---------- | ---------------- | -------- | ------------ |
| `FREE_CODER`       | 50 MB*        | 50 MB      | 15% (`1500 bps`) | standard | basic        |
| `PRO_CODER`        | configured    | configured | 10% (`1000 bps`) | priority | enhanced     |
| `CORPORATE_SELLER` | commercial    | commercial | configurable     | priority | enterprise   |

\* 50 MB is stated in the brief; the rest are placeholders. **Truth lives in `seller_tiers` config
rows**, not in code constants. Fee math uses basis points (integers) — never floats.

---

## 6. DOMAIN INVARIANTS (enforced in domain + mirrored by DB constraints)

1. A bid must exceed the current top bid by ≥ the configured minimum increment.
2. A bid cannot be placed by the asset's seller (self-bidding) — enforced + audited.
3. A bid cannot be placed after `auction.ends_at` (server clock, not client).
4. Price/amount/reserve always come from server state — **never** from the client payload.
5. An order cannot transition to `RELEASED` before the 7-day escrow lock elapses (unless a dispute
   resolution or admin override records an explicit reason + actor).
6. A seller cannot modify a listing/asset after an order exists for it (asset frozen post-sale).
7. A listing must pass `qualityStatus = PASS` (or explicit admin override) before `ACTIVE`.
8. Money movements always produce balanced ledger entries (debits == credits per currency).
9. Currencies are never mixed within a single transaction/ledger batch.
10. Every state transition is written to `audit_logs` with actor, before/after, and reason.
