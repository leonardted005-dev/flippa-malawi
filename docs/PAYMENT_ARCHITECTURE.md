# PAYMENT ARCHITECTURE

**Status:** Greenfield blueprint. **First provider:** DPO Pay. **Rule #18:** DPO-specific fields are
**NOT invented** — they await the official merchant integration specification.

---

## 1. PRINCIPLE: PROVIDER-AGNOSTIC, MARKETPLACE-OWNED

```
Marketplace (domain)                ← owns policy, pricing, fees, escrow, ledger
        │
        ▼
Payment Orchestrator (application)  ← decides intent/authorize/capture/refund, idempotency, retries
        │
        ▼
PaymentProvider PORT (domain interface)
        │
        ▼
DPO Adapter (infrastructure)        ← ONLY place DPO field names live
        │
        ▼
DPO Pay
```

**Hard rules**

- No DPO type/field/constant appears outside the DPO adapter.
- Payment logic never lives in a UI component (web or Flutter).
- The client never determines price, amount, fee, currency, or payment status.
- A **browser redirect is NOT payment confirmation** — only a **verified webhook** (or a
  server-to-server verification call) confirms payment (rule #11).
- Webhooks are **idempotent** (rule #12) via `UQ(provider, event_id)`.

---

## 2. DOMAIN MODEL (provider-agnostic)

| Concept          | Meaning                                                                       |
| ---------------- | ----------------------------------------------------------------------------- |
| `PaymentIntent`  | intent to collect a specific amount/currency for an order                     |
| `PaymentSession` | provider handoff descriptor (redirect URL / SDK token) — **opaque to domain** |
| `Payment`        | the tracked attempt with a provider reference                                 |
| `Authorization`  | funds reserved (where the provider supports it)                               |
| `Capture`        | funds taken                                                                   |
| `Void`           | cancel an uncaptured authorization                                            |
| `Refund`         | return funds (full/partial)                                                   |
| `Webhook`        | provider event, signature-verified, deduped                                   |
| `Reconciliation` | periodic server-to-server truth check vs `payments`/ledger                    |

**Statuses (canonical, provider-independent):**
`INITIATED → PENDING → AUTHORIZED → CAPTURED → (REFUNDED | PARTIALLY_REFUNDED)`
with failure states `DECLINED | FAILED | EXPIRED | VOIDED`.

**Money:** integer minor units + ISO currency. Matching currency is validated before any call.

---

## 3. THE DPO BOUNDARY (what we know vs what we must NOT invent)

### Known (from the brief)

- DPO Pay is the **initial provider**.
- It supports **Multi-Merchant Split Settlement** (marketplace + seller splits) — _a capability, not
  a confirmed field set_.
- Zambia is the corporate/payment anchor country; multi-country rails expected.

### NOT known (must come from official DPO merchant integration spec — do not guess)

- Exact endpoint URLs & HTTP methods.
- Auth mechanism (API key header name? signature scheme? OAuth?).
- Request/response field names for create/authorize/capture/refund.
- Webhook format, **signature header name & algorithm**, and event naming.
- Split/settlement payload shape (how the platform fee + seller proceeds are expressed).
- Currency & country coverage matrix and supported payment methods.
- Test/sandbox base URL and credentials.

### Adapter seam (implement now, fill later)

```ts
// apps/api/src/integrations/payments/dpo/dpo-payment.provider.ts
export class DpoPaymentProvider implements PaymentProvider {
  // TODO(spec): wire real endpoints/fields once DPO merchant spec is provided.
  // Until then these throw PAYMENT_PROVIDER_NOT_CONFIGURED in non-test envs,
  // and are backed by a conformance test double in tests.
  async createPaymentIntent(cmd: CreateIntentCommand): Promise<PaymentIntentResult> {
    throw new ProviderNotConfiguredError('DPO spec pending'); // TODO(spec)
  }
  async verifyWebhook(rawBody: Buffer, headers: Record<string, string>): WebhookVerification {
    // TODO(spec): verify using DPO's documented signature header + algorithm.
    throw new ProviderNotConfiguredError('DPO webhook spec pending'); // TODO(spec)
  }
  // authorize/capture/void/refund → same TODO(spec) contract
}
```

**Conformance tests** are written against the **port**, so any adapter (DPO or future) must pass the
same suite. DPO-specific integration tests are added only after the spec arrives.

---

## 4. FLOWS

### A. Auction / fixed-price purchase

```
1. Buyer wins auction OR clicks Buy Now
2. Server creates Order (price from server state) — idempotent
3. Orchestrator -> createPaymentIntent(order) -> provider port
4. Provider returns PaymentSession (opaque) -> client performs provider checkout
   (web: hosted page; mobile: see MOBILE_ARCHITECTURE.md payment routing)
5. Provider webhook (verified + deduped) -> payment AUTHORIZED/CAPTURED
6. On CAPTURED: escrow HELD, ledger entries written, order -> IN_ESCROW
7. Browser redirect only updates UI ordering; it never flips payment state
```

### B. Refund / chargeback

```
Refund:  orchestrator.refund(payment, amountMinor) -> provider -> webhook/lookup -> ledger REFUND entry
Chargeback: provider webhook -> order -> DISPUTED; escrow frozen; ledger CHARGEBACK entry;
            admin dispute workflow (see SECURITY_THREAT_MODEL / disputes)
```

### C. Reconciliation (settlement-worker)

```
Periodic job: pull provider settlement report -> match against payments/ledger ->
  write reconciliation findings -> alert on mismatch -> NEVER mutate history (compensating entries)
```

---

## 5. SECURITY CONTROLS (payment-specific)

- Webhook endpoint: **raw body preserved** (no JSON re-parse before signature check), signature
  verified, timestamp skew checked, replay window enforced, deduped by `(provider, event_id)`.
- All provider secrets in a secret manager / env — **never** in client bundles, logs, or repos.
- Server-to-server confirmation used where the provider supports it (defense in depth).
- Currency/country/method validation before intent creation (block unsupported combos early).
- Rate limiting + WAF on webhook endpoint; alerting on signature failures.

> **Open dependency:** DPO merchant integration specification, sandbox credentials, merchant ID/split
> config. **This blocks Phase 9 completion** (see IMPLEMENTATION_ROADMAP.md).

---

## 6. ESCROW ARCHITECTURE (Phase 0.9)

```
Auction/Listing → Winner → Order → Payment (CAPTURED) → Escrow HELD
      → 7-day transactional lock (release_eligible_at = held_at + 7d)
      → Asset transfer (custody checklist) → Buyer verification
      → Escrow RELEASED → Settlement → Seller payout
```

**Critical distinction (rule from Phase 0.9):** a 7-day **marketplace lock** is **NOT** a payment
card preauthorization. They are different mechanisms owned by different layers:

| Concern                       | Owner                        | Stored in                  |
| ----------------------------- | ---------------------------- | -------------------------- |
| Payment authorization/capture | Payment provider via adapter | `payments`                 |
| Marketplace escrow hold       | Marketplace (domain)         | `escrow_holds`             |
| Asset custody                 | Marketplace (domain)         | `asset_transfer` checklist |
| Transaction lifecycle         | Marketplace (domain)         | `orders`                   |

They advance **independently**. Escrow release requires **all** of: funds captured, lock elapsed
(or dispute resolved), and custody transfer verified. An admin override must record actor + reason.

**Dispute interaction:** opening a dispute moves escrow to `DISPUTE_HOLD` (freezes the timer effect);
resolution routes funds to buyer, seller, or split, each producing compensating ledger entries.
