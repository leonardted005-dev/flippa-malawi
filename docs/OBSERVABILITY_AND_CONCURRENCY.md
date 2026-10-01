# OBSERVABILITY AND CONCURRENCY

**Status:** Greenfield blueprint. Covers Phase 0.17 (concurrency) and Phase 0.18 (observability).
This is an **additional** document beyond the Phase 0.19 list; it exists so concurrency and
observability decisions are not buried in other files.

---

## 1. CONCURRENCY DESIGN (Phase 0.17)

| Scenario                              | Mechanism                                                                                                                                                                                                       |
| ------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Two simultaneous bids**             | Transaction + `SELECT ... FOR UPDATE` on the `auctions` row; re-read current bid inside the lock; reject stale/insufficient bids; write bid + update `current_bid_id` atomically; `version` bump.               |
| **Multiple payment callbacks**        | Dedupe by `UQ(provider, event_id)`; state machine allows `AUTHORIZED→CAPTURED` only once; duplicate webhook is a no-op returning 200.                                                                           |
| **Duplicate webhooks**                | Same dedupe table + idempotent handler; store raw event; `payment_events.event_id` unique.                                                                                                                      |
| **Two buyers attempting checkout**    | Fixed-price: unique constraint / lock on listing → only first `order` in `CREATED/AWAITING_PAYMENT` wins; second gets `LISTING_UNAVAILABLE`. Auction: single winner row by lock.                                |
| **Auction expiration**                | Scheduler (worker) closes auctions by `ends_at` with a lock; the first closer wins; closing is idempotent (`status` guard). Anti-snipe extension policy applied before close.                                   |
| **Payment timeout**                   | `AWAITING_PAYMENT → PAYMENT_EXPIRED` via locked state machine + provider void if authorized; winner-default policy applied.                                                                                     |
| **Seller modifying asset after sale** | Domain guard: once an `order` exists, asset/listing is **frozen** (invariant #6); attempts rejected + audited.                                                                                                  |
| **Simultaneous refund + settlement**  | Both operate on the same `order` under `FOR UPDATE`; state machine makes `SETTLED` terminal; refund after settlement creates **compensating** ledger entries and a recovery task — never mutates prior entries. |

**Concurrency toolbox (in priority order):**

1. DB transactions + row locks for money/state.
2. Unique constraints for natural dedupe (bids, webhooks, idempotency keys).
3. Optimistic `version` columns for low-contention edits.
4. Idempotency keys at the API edge for client retries.
5. State-machine validation as the final gate (reject invalid transitions).

---

## 2. OBSERVABILITY (Phase 0.18)

### Structured logging

- JSON logs with a **correlation layer**: `requestId` (per HTTP request), plus domain ids when known:
  `transactionId/orderId`, `paymentId`, `auctionId`, `listingId`, `sellerId`, `scanRunId`,
  `jobId` (workers), `userId`/`actorId`.
- Every log line includes `service`, `env`, `version`, `timestamp`, `level`, `event`.
- **Audit events** go to `audit_logs` (immutable, queryable) in addition to logs.

### Metrics

- **HTTP:** rate, latency p50/p95/p99, error rate by route.
- **Domain:** active auctions, bids/min, listings by status, orders by state, escrow held total,
  settlement latency, dispute rate.
- **Payments:** intent→capture conversion, webhook success/failure, signature failures, chargebacks.
- **Workers:** queue depth, job duration, failure/retry counts, scanner error rate, scan timeouts.
- **Reconciliation:** unmatched payments/ledger imbalance count (should always be 0; alert otherwise).

### Alerts (initial)

- Ledger batch unbalanced (any non-zero) → **page**.
- Webhook signature failures spike → alert.
- Scanner worker error/timeout rate high → alert.
- Auction-close job lagging past `ends_at` by > N seconds → alert.
- Payment reconciliation mismatch → alert.
- Admin login from new IP / role change → notify.

### NEVER LOG (hard rule)

Passwords · payment secrets/keys · API credentials/tokens · full authentication tokens ·
private keys · sensitive KYC/PII data · full card numbers. Redact or hash (e.g., `ip_hash`) instead.

---

## 3. HEALTH & READINESS

- `/health/live` (process up) and `/health/ready` (DB + Redis + storage reachable) for orchestrators.
- Worker heartbeats and queue-depth exposed; stale workers flagged.
