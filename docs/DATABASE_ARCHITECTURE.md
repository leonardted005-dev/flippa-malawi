# DATABASE ARCHITECTURE

**Status:** Greenfield blueprint. **DBMS:** PostgreSQL 16. **Migration tool:** Prisma Migrate
(append-only, forward-only). **Money:** `BIGINT` minor units + `currency CHAR(3)`. Never `FLOAT`.

---

## 1. PRINCIPLES

1. **Integer minor units only.** `amount_minor BIGINT`. ISO-4217 `currency CHAR(3)`. Format at the edge.
2. **Immutable finance.** `ledger_entries` is append-only (no UPDATE/DELETE). Corrections = new
   compensating entries linked via `reverses_entry_id`.
3. **Idempotency everywhere money/state moves.** Natural unique constraints + `idempotency_keys`.
4. **Concurrency by design.** `SELECT ... FOR UPDATE` on hot rows (auction, escrow, listing) inside
   transactions; optimistic `version` columns elsewhere.
5. **Soft-delete where audit matters** (`deleted_at`), hard-delete only where lawful (account deletion
   with retention carve-outs).
6. **Every table** has `id (uuid)`, `created_at`, `updated_at`; financial/audit tables also
   `created_by`/`actor_id`.
7. **No DB history rewrite.** Migrations are additive; renaming uses expand→backfill→contract.

---

## 2. CORE SCHEMA (grouped by context)

> Column lists are the _minimum_ viable shape; types abbreviated. `*_id` = FK (uuid) unless noted.

### Identity & sellers

```
users(id, email_uq, phone_uq, password_hash, status, email_verified_at, phone_verified_at,
      locale, default_country, default_currency, created_at, updated_at, deleted_at)
credentials(id, user_id, type, provider, secret_hash, expires_at)         -- sessions/refresh
refresh_tokens(id, user_id, token_hash_uq, family_id, expires_at, revoked_at, rotated_from)
mfa_factors(id, user_id, type, secret_enc, confirmed_at)

seller_profiles(id, user_id_uq, display_name, country, tier, status, rating_avg, rating_count,
                payout_currency, verified_at, created_at, updated_at)
seller_tiers(id, code_uq, name, storage_quota_bytes, max_active_listings, commission_bps,
             features_json, is_config, effective_from, effective_to)     -- CONFIGURED, not hard-coded
payout_accounts(id, seller_id, provider, account_ref_enc, country, currency, status, verified_at)
buyer_profiles(id, user_id_uq, default_country, default_currency, kyc_status)
```

### Verification

```
verification_cases(id, subject_type, subject_id, type, status, assigned_admin_id,
                   decision, decided_at, created_at, updated_at)
ownership_proofs(id, case_id, asset_id, method, evidence_object_id, challenge_seed,
                 verified_at, expires_at)
kyc_records(id, user_id, provider, provider_ref, status, level, data_enc, created_at)
```

(Store KYC secrets encrypted; see SECURITY_THREAT_MODEL.md — never log.)

### Catalog (digital-asset abstraction)

```
digital_assets(id, type, slug_uq, title, seller_id, country, currency, category_id,
               verification_status, quality_status, extra_json, created_at, updated_at, deleted_at)
asset_metadata_software(id, asset_id_uq, package_size_bytes, source_repo, framework, runtime,
                        dependency_count, license_findings_json, quality_score)
asset_metadata_website(id, asset_id_uq, domain_uq, monthly_traffic, technology_json, hosting,
                       monthly_revenue_minor, currency, analytics_verified)
asset_metadata_mobile(id, asset_id_uq, platforms_json, store_links_json, installs, revenue_minor, currency, bundle_id)
asset_metadata_youtube(id, asset_id_uq, channel_id_uq, subscribers, total_views, video_count, channel_age_days, snapshot_id)
asset_metadata_instagram(id, asset_id_uq, account_id_uq, followers, engagement_bps, media_count, snapshot_id)
asset_metadata_game(id, asset_id_uq, game, platform, account_ref, level_rank, inventory_json, ban_state)
asset_metadata_domain(id, asset_id_uq, domain_uq, registrar, expires_at, dns_json, transfer_locked)
categories(id, parent_id, slug_uq, name, asset_types_json, sort)
social_snapshots(id, provider, subject_ref, raw_json, sha256, fetched_at)   -- retained for audit
```

### Listings, auctions, bids, offers, watchlists

```
listings(id, asset_id, seller_id, mode, status, price_minor, currency, reserve_minor,
         buy_now_minor, starts_at, ends_at, featured_until, published_at, version,
         idempotency_key_uq, created_at, updated_at)
auctions(id, listing_id_uq, status, current_bid_id, current_bid_minor, currency, reserve_minor,
         bid_count, winner_buyer_id, closed_at, version)
bids(id, auction_id, bidder_id, amount_minor, currency, status, placed_at,
     idempotency_key_uq, ip_hash)
   -- UNIQUE (auction_id, idempotency_key) ; monotonic amount enforced in txn
offers(id, listing_id, buyer_id, amount_minor, currency, status, expires_at, created_at,
       idempotency_key_uq)
watchlists(id, buyer_id, name, is_default)
watchlist_items(id, watchlist_id, asset_id, created_at)   -- UNIQUE(watchlist_id, asset_id)
```

### Messaging

```
conversations(id, listing_id, buyer_id, seller_id, status, last_message_at)
messages(id, conversation_id, sender_id, body, attachment_object_id, redaction_state, created_at)
   -- moderation/redaction for contact-info leakage prevention
```

### Quality control (Phase 0.7)

```
quality_policies(id, version_uq, rules_json, is_active, effective_from)     -- config-driven
scanner_runs(id, asset_id, target_type, scanner_kind, status, submitted_at, completed_at,
             raw_result_object_id, result_sha256, scanner_version)
security_findings(id, scanner_run_id, scanner, rule_id, severity, category, file_path, line,
                  title, description, evidence, remediation, fingerprint)
   -- UNIQUE(scanner_run_id, fingerprint) to dedupe
quality_reports(id, asset_id, policy_version, decision, pass_count, review_count, fail_count,
                highest_severity, computed_at)
   -- decision ∈ {PASS, REVIEW, FAIL}
```

### Orders, payments, escrow

```
orders(id, listing_id, auction_id, buyer_id, seller_id, asset_id, status, price_minor, currency,
       escrow_id, idempotency_key_uq, created_at, updated_at)
payments(id, order_id, provider, provider_ref_uq, status, amount_minor, currency, capture_minor,
         authorized_at, captured_at, idempotency_key_uq, created_at, updated_at)
payment_intents(id, order_id, provider, amount_minor, currency, status, client_secret_ref,
                session_json, created_at)
payment_events(id, payment_id, provider, event_id_uq, event_type, signature_verified,
               raw_object_id, processed_at, dedupe_key_uq)
   -- UNIQUE(provider, event_id) → webhook idempotency (Phase 0.9 / rule #12)
escrow_holds(id, order_id_uq, status, amount_minor, currency, held_at, lock_days,
             release_eligible_at, released_at, dispute_id)
escrow_releases(id, escrow_hold_id, status, amount_minor, approved_by, reason, released_at)
```

### Ledger (immutable, Phase 0.10)

```
ledger_accounts(id, code_uq, type, currency, owner_type, owner_id, created_at)
   -- type ∈ {ASSET, LIABILITY, REVENUE, EXPENSE, EQUITY}
ledger_entries(id, account_id, order_id, currency, direction, amount_minor,
               entry_type, reverses_entry_id, memo, created_at, created_by)
   -- APPEND-ONLY. No UPDATE/DELETE (enforced by trigger + revoked privileges).
   -- entry_type ∈ {BUYER_PAYMENT, PLATFORM_FEE, SELLER_PROCEEDS, TAX, FUEL_ALLOCATION,
   --               REFUND, CHARGEBACK, ADJUSTMENT, SETTLEMENT}
ledger_batches(id, currency, entry_count, debit_total_minor, credit_total_minor, balanced_bool, created_at)
settlements(id, order_id, seller_id, status, gross_minor, fee_minor, tax_minor, net_minor,
            currency, provider_ref, settled_at)
tax_rates(id, country, region, asset_type, rate_bps, basis, effective_from, effective_to)
fx_quotes(id, base_currency, quote_currency, rate_micro, source, fetched_at)
   -- store FX as integer micro-rate (rate * 1e6); never float
```

### Disputes, reviews, audit, storage, admin

```
disputes(id, order_id, opened_by, reason, status, resolution, assigned_admin_id,
         opened_at, resolved_at)
dispute_messages(id, dispute_id, author_id, body, attachment_object_id, created_at)
reviews(id, order_id_uq, seller_id, buyer_id, rating, body, published_at)  -- UNIQUE(order_id)
audit_logs(id, actor_id, actor_type, action, entity_type, entity_id, before_json, after_json,
           ip_hash, user_agent, request_id, created_at)        -- APPEND-ONLY
storage_objects(id, bucket, key_uq, owner_type, owner_id, content_type, size_bytes, sha256,
                visibility, scan_status, retention_until, created_at, deleted_at)
idempotency_keys(id, scope, key_uq, request_hash, response_json, created_at, expires_at)
   -- UNIQUE(scope, key) → replays return the original response
notifications(id, user_id, channel, template, payload_json, status, sent_at, read_at)
admin_actions(id, admin_id, action, target_type, target_id, reason, created_at)
```

---

## 3. CONSTRAINT & INDEX HIGHLIGHTS

- `UQ(provider, event_id)` on `payment_events` → webhook replay safety.
- `UQ(scope, key)` on `idempotency_keys` → safe client retries on all mutations.
- Partial index on `listings(status, ends_at)` where `status='ACTIVE'` for "ending soon".
- `GIN` indexes on `asset_metadata_*` JSON fields used for filtering.
- `CHECK (amount_minor >= 0)` on monetary columns; `CHECK (currency ~ '^[A-Z]{3}$')`.
- Row-level locking used in auction bid placement and settlement transactions.

---

## 4. MIGRATIONS & SEED DATA

- **Migrations:** Prisma Migrate, **append-only**, reviewed in CI; a CI job runs `migrate diff` to
  detect drift. Never edit an applied migration.
- **Ledger protection migration:** add a trigger/rule preventing `UPDATE`/`DELETE` on
  `ledger_entries` and `audit_logs`; grant API role `INSERT`/`SELECT` only.
- **Idempotent seeds** (`prisma/seed`): categories, asset-type registry, `seller_tiers` config rows,
  default `quality_policies` v1, `tax_rates` placeholders, admin bootstrap (from env, not hard-coded
  credentials), supported `currency` list. Seeds use upsert-by-natural-key so re-running is safe.
