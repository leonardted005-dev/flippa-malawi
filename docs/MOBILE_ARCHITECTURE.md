# MOBILE ARCHITECTURE (Flutter)

**Status:** Greenfield blueprint. **Rule:** the mobile app is a **thin client**. It performs **no**
business logic, **no** pricing, **no** payment-state decisions, and holds **no** provider secrets.

---

## 1. STRUCTURE (feature-first)

```
apps/mobile/lib/
├─ main.dart
├─ app/                     # app shell, router, themes, DI (Riverpod) providers
├─ core/
│  ├─ network/              # API client (dio), auth interceptor, retry, problem+json handling
│  ├─ storage/              # secure storage (tokens), cache
│  ├─ config/               # env/feature flags, country/currency context
│  └─ analytics/observability
├─ features/
│  ├─ auth/                 # login, register, MFA, account deletion
│  ├─ browse/               # home, categories, search, filters
│  ├─ listing/              # listing detail, gallery, metrics
│  ├─ auction/              # live bidding, countdown (server time), bid confirm
│  ├─ watchlist/
│  ├─ seller/               # dashboards, create listing, uploads, quality status
│  ├─ orders/               # purchases, escrow status, transfers
│  ├─ wallet_payments/      # payment ROUTING (see §3) + status polling
│  ├─ messages/
│  └─ settings/             # profile, verification, notifications
└─ shared/                  # widgets, formatters (money/date), intl
```

**State management:** Riverpod (providers per feature) + immutable models.
**Money formatting:** API returns `{amountMinor, currency}`; the app formats for display only — it
never computes prices/fees.
**Countdowns:** derived from **server** `ends_at` (adjusted by server-time delta), never device clock
alone.

---

## 2. API LAYER

- Single typed client generated from `packages/contracts` (OpenAPI).
- Access token in memory; refresh token in **secure storage** (Keychain/Keystore).
- Silent refresh on 401 with request replay; logout clears all tokens.
- Requests carry `Idempotency-Key` for bidding/offers/orders.
- Problem responses (`application/problem+json`) mapped to typed errors → user messages.

---

## 3. PAYMENT ROUTING (Phase 0.15) — CRITICAL

**Rule #19:** do **NOT** use a WebView to circumvent Apple/Google policies. Payment routing is a
first-class, policy-aware abstraction — not a WebView hack.

```dart
abstract class PaymentRouter {
  PaymentRoute decide(PaymentRoutingContext ctx);
}

class PaymentRoutingContext {
  final PlatformType platform;        // ios | android
  final DistributionChannel channel;  // appStore | playStore | web | unknown
  final String country;               // ISO-3166 (e.g. 'ZM','NG','KE')
  final TransactionType type;         // digitalAssetPurchase | subscription | ...
  final RemotePolicy policy;          // server-driven config (see below)
}

enum PaymentRoute {
  nativeWebCheckout,   // open provider-hosted checkout in system browser (ASWebAuthenticationSession /
                       // Chrome Custom Tabs) — legitimate web checkout, NOT an in-app WebView circumvention
  providerSdk,         // provider's official mobile SDK (if available & permitted)
  inAppPurchase,       // store IAP where store policy REQUIRES it
  externalLink,        // where store policy permits an external purchase link (entitlement-based)
  blocked,             // no permitted route for this context
}
```

**Key points**

- The **decision** comes from **server-driven policy config** (`RemotePolicy`), evaluated per
  platform + country + transaction type + channel. It is **not** hard-coded in the app and can be
  updated without an app release.
- Physical-goods / real-world services vs digital goods have **different** store rules; the routing
  table encodes the distinction and is reviewed with legal (assumption A8).
- The app **never** marks a payment as paid. It polls/subscribes to server order status; the server
  flips state from a verified webhook. Browser/redirect return is UI-only (rule #11).
- If a route is `blocked` for a context, the app degrades gracefully (queue / notify / web fallback)
  instead of bypassing policy.
- Where store policy permits external web checkout, we use the **system browser** (a legitimate web
  experience), never an embedded WebView engineered to evade review.

---

## 4. FLOWS

| Flow                  | Notes                                                                                  |
| --------------------- | -------------------------------------------------------------------------------------- |
| Auth                  | register/login, refresh, MFA, **account deletion** (required by stores)                |
| Browse/search         | server-side filters; cached first page; pull-to-refresh; cursor paging                 |
| Auction bidding       | confirm sheet with server-validated amount; optimistic UI reconciled by server truth   |
| Seller create listing | draft → uploads via signed URLs → quality scan → submit for review                     |
| Uploads               | direct-to-object-storage via presigned URL; progress; resume; content-type/size checks |
| Orders/escrow         | status timeline (payment/escrow/custody independent dimensions)                        |
| Notifications         | push (FCM) + in-app; deep links to listing/order/auction                               |
| Deep links            | `app://listing/:id`, `https://app.example/listing/:id` universal links                 |

---

## 5. STORE-COMPLIANCE CHECKLIST (target)

- Account deletion path available in-app (Apple 5.1.1(v)/Google requirement).
- Sign in with Apple offered where third-party sign-in is offered.
- No WebView-based payment circumvention (rule #19).
- Privacy policy, data-safety disclosure, and permissions minimized.
- Digital-goods purchase path conforms to current store rules per region (A8).
