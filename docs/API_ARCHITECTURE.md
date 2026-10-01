# API ARCHITECTURE

**Status:** Greenfield blueprint. **Style:** REST, JSON, `/api/v1`, OpenAPI 3.1 (generated).
**Rule:** the API is the _only_ trust boundary that touches business logic. Clients (web, mobile)
are dumb; the API is authoritative.

---

## 1. CONVENTIONS

- Base path `/api/v1`. Breaking changes → `/api/v2`.
- Auth via `Authorization: Bearer <access_token>`; refresh via `/auth/refresh`.
- **Idempotency:** mutating endpoints accept `Idempotency-Key` header; server stores request hash +
  response in `idempotency_keys` and replays safely.
- **Errors:** RFC 7807 `application/problem+json` → `{ type, title, status, detail, instance, code }`.
- **Pagination:** cursor-based (`?cursor=&limit=`) for listings/search; offset only for admin tables.
- **Validation:** Zod/class-validator at the edge; DB constraints as second line of defense.
- **Versioning of responses:** numeric money always serialized as `{ amountMinor, currency }`
  strings/ints — never floats, never locale-formatted in the API.
- **Correlation:** every request carries/propagates `X-Request-Id`; responses echo it.

---

## 2. EVERY MUTATION IS EVALUATED FOR (Phase 0.14)

For each write endpoint the review checklist is:

| Control              | Implementation                                                           |
| -------------------- | ------------------------------------------------------------------------ |
| **Authentication**   | JWT guard (or explicit public route marker)                              |
| **Authorization**    | role/permission guard (`buyer`, `seller`, `admin`, resource-scoped)      |
| **Object ownership** | domain check: actor owns/may-act-on the target object (defeats IDOR)     |
| **Idempotency**      | `Idempotency-Key` + unique constraint where money/state moves            |
| **Rate limiting**    | per-IP + per-user + per-route buckets (Redis)                            |
| **Validation**       | schema + numeric ranges + enum whitelists                                |
| **Audit logging**    | append `audit_logs` with actor/before/after/requestId                    |
| **Concurrency**      | transaction + row lock / optimistic `version` / state-machine validation |

---

## 3. ENDPOINT MAP

### Authentication

```
POST   /auth/register
POST   /auth/login
POST   /auth/refresh
POST   /auth/logout
POST   /auth/logout-all
POST   /auth/password/forgot
POST   /auth/password/reset
POST   /auth/mfa/enroll   |  POST /auth/mfa/verify
GET    /auth/me
```

### Users & account lifecycle

```
GET    /users/me                          PATCH /users/me
GET    /users/me/sessions                 DELETE /users/me/sessions/:id
POST   /users/me/email/verify             POST /users/me/phone/verify
DELETE /users/me                          # account deletion (grace + retention policy)
GET    /users/me/export                    # data portability
```

### Seller profiles & tiers & payouts

```
POST   /sellers                           GET/PATCH /sellers/:id
GET    /sellers/me                        GET /sellers/:id/listings
GET    /sellers/me/tier                   POST /sellers/me/tier/upgrade
GET    /sellers/me/payout-accounts        POST /sellers/me/payout-accounts
GET    /sellers/:id/reviews
```

### Verification (identity, ownership, asset)

```
POST   /verification/cases                GET /verification/cases/:id
POST   /verification/cases/:id/proofs
POST   /verification/ownership/:assetId/challenge    # begin ownership challenge
GET    /verification/status
```

### Catalog / assets

```
GET    /categories                        GET /categories/:slug
GET    /assets/:id
POST   /assets                            # create draft asset (seller)
PATCH  /assets/:id                        # blocked once an order exists
GET    /assets/:id/quality                # latest quality report
GET    /assets/:id/verification
```

### Listings / auctions / bids / offers

```
GET    /listings                          # browse + filters (server-side)
GET    /listings/:id
POST   /listings                          # create draft
PATCH  /listings/:id                      PATCH /listings/:id/publish | /pause | /withdraw
POST   /listings/:id/offers               GET /listings/:id/offers
POST   /offers/:id/accept                 POST /offers/:id/reject
POST   /auctions                          GET /auctions/:id
POST   /auctions/:id/bids                 # server validates amount, increment, self-bid, timing
GET    /auctions/:id/bids
GET    /listings/:id/watch               DELETE /listings/:id/watch
```

### Watchlists

```
GET    /watchlists                        POST /watchlists
POST   /watchlists/:id/items              DELETE /watchlists/:id/items/:assetId
```

### Orders / payments / escrow

```
GET    /orders                            GET /orders/:id
POST   /orders                            # create (server-priced), idempotent
POST   /orders/:id/pay                    # -> create payment intent/session
GET    /orders/:id/payment
POST   /orders/:id/cancel
GET    /escrows/:id                       POST /escrows/:id/release   # gated by lock + verification
POST   /orders/:id/confirm-transfer       # buyer confirms asset custody checkpoint
```

### Payment webhooks (provider-facing, unauthenticated but signed)

```
POST   /webhooks/payments/dpo             # raw-body signature verify -> dedupe -> enqueue
```

> Note: the webhook route name is provider-scoped but the **handler body is provider-agnostic**;
> verification + normalization happen in the adapter, then a canonical `PaymentEvent` is emitted.

### Quality scanning & uploads

```
POST   /uploads/presign                   # -> short-lived signed upload URL (server-authorized)
POST   /uploads/:id/complete              # register StorageObject, trigger scan queue
GET    /assets/:id/scans                  GET /scans/:id
POST   /assets/:id/rescan                 # seller/admin, policy-gated
GET    /assets/:id/downloads              # signed download URL, ownership-checked
```

### Notifications / messaging / disputes / reviews

```
GET    /notifications                     POST /notifications/:id/read
GET    /conversations                     GET /conversations/:id/messages
POST   /conversations/:id/messages
POST   /orders/:id/disputes               GET /disputes/:id   POST /disputes/:id/messages
POST   /orders/:id/reviews
```

### Admin

```
GET    /admin/dashboard
GET    /admin/users         POST /admin/users/:id/verify | /suspend
GET    /admin/listings      POST /admin/listings/:id/approve | /reject | /feature
GET    /admin/quality/queue GET /admin/security/queue
GET    /admin/verification  POST /admin/verification/:id/decision
GET    /admin/payments      GET /admin/escrow      GET /admin/disputes
GET    /admin/fraud         GET /admin/audit-logs
GET    /admin/sellers       PATCH /admin/sellers/:id/tier
GET    /admin/reports       GET /admin/health
```

---

## 4. RATE LIMITING (initial guidance; tune later)

| Route class                                        | Limit (starting point)                           |
| -------------------------------------------------- | ------------------------------------------------ |
| `POST /auth/login`                                 | strict per-IP + per-account, exponential backoff |
| `POST /auctions/:id/bids`                          | per-user short window (anti-snipe/spam)          |
| `POST /offers`, `POST /conversations/.../messages` | per-user window                                  |
| `POST /uploads/presign`                            | per-seller quota-aware                           |
| `POST /webhooks/*`                                 | high throughput but signature-gated + dedupe     |
| Read browse/search                                 | generous, CDN-cached                             |

---

## 5. AUTHORIZATION MODEL (summary)

- **Roles:** `buyer`, `seller`, `admin` (a user may hold buyer+seller). Admin is least-privilege by
  sub-role (`verification_admin`, `payments_admin`, `dispute_admin`, `super_admin`).
- **Ownership:** every resource read/write re-checks actor↔owner in the domain (never trust an
  `:id` from the client alone — IDOR defense).
- **Feature gating:** seller-tier policy resolves allowed actions (see DOMAIN_MODEL §5).
