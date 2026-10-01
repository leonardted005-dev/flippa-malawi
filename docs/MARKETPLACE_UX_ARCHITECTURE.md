# MARKETPLACE UX ARCHITECTURE

**Status:** Greenfield blueprint. **Rule #20–#22:** Flippa is a **reference for marketplace quality
and information density only**. We do **NOT** copy its UI, branding, wording, assets, or code. Our
design language is our own.

---

## 1. DESIGN LANGUAGE (ourown identity)

**Feel:** professional · trustworthy · financial · information-rich · fast · modern · premium ·
serious · mobile-first · easy to scan.

**Avoid:** generic startup-SaaS look, excessive gradients, glassmorphism, gratuitous animation, giant
marketing sections, empty dashboard cards, fake metrics, whitespace that hides information.

**Foundations (tokens, not ad-hoc styles):**

- **Color:** a restrained, high-contrast palette. Deep neutral base + a single confident brand accent
  - semantic finance colors (positive/negative/neutral) used **only** for real data. No rainbow charts.
- **Type:** one workhorse sans (variable) + tabular-figure numerals for all money/metrics so columns
  align. Tight but readable density.
- **Spacing:** compact 4/8px scale; density over airiness in data contexts.
- **Surfaces:** subtle borders + minimal elevation; avoid glass/shadows as decoration.
- **Motion:** 120–180ms functional transitions only (state changes, sheets) — no decoration.
- **Data honesty:** never show a metric as a card/percent that isn't backed by real data (rule #23).

---

## 2. INFORMATION ARCHITECTURE (Phase 0.4)

### PUBLIC

`/` Home · `/browse` Browse (all) · `/search` Search · `/categories`, `/categories/:slug`
`/auctions` Live/Upcoming/Ending-soon · `/fixed-price` Classified/Buy-now · `/featured` ·
`/recent` Recently added · `/verified` Verified assets · `/high-value` High-value assets
`/sellers/:id` Seller profile · `/listings/:id` Listing detail

### BUYER (authenticated)

`/dashboard` · `/watchlist` Saved/watchlisted · `/bids` · `/offers` · `/purchases` ·
`/transactions` Active transactions · `/escrow` · `/messages` · `/history` Transaction history ·
`/verification` · `/settings` Account settings

### SELLER (authenticated, seller role)

`/seller` Dashboard · `/seller/listings/new` Create listing · `/seller/listings/drafts` Drafts ·
`/seller/quality` Quality checks · `/seller/listings/active` Active · `/seller/auctions` Auctions ·
`/seller/bids` Bids received · `/seller/offers` Offers received · `/seller/sales` Sales ·
`/seller/escrow` Escrow · `/seller/payouts` Payouts · `/seller/verification` ·
`/seller/analytics` Analytics · `/settings` Account settings

### ADMIN

`/admin` Dashboard · `/admin/users` User verification · `/admin/listings` Listing review ·
`/admin/quality` Quality queue · `/admin/security` Security queue · `/admin/verification` Asset
verification · `/admin/payments` Payment monitoring · `/admin/escrow` Escrow monitoring ·
`/admin/disputes` Disputes · `/admin/reports` Reports · `/admin/fraud` Fraud/risk ·
`/admin/audit` Audit logs · `/admin/sellers` Seller management · `/admin/health` System health

---

## 3. LISTING CARD (the core unit of the marketplace)

The card is the single most important component — it must be **dense, scannable, honest**, and show
**only the metrics that apply to that asset type**.

**Always shown**

- Asset type badge (Software / Website / Mobile App / YouTube / Instagram / Game Account / Domain / Other)
- Title (truncated, 2 lines max, no clickbait)
- Seller name + tier/verified badge
- Country flag/label
- **Verification status** chip (Unverified · In review · Verified)
- **Quality/security status** chip (PASS · REVIEW · FAIL-pending)
- Price **or** current bid: `{amountMinor → formatted}` + currency
- Mode: AUCTION (with countdown + bid count) **or** FIXED-PRICE
- Reserve status (reserve met / reserve not met)
- Watchlist toggle (optimistic, reconciled by server)

**Shown conditionally (only when the asset type provides it)**

- Revenue / profit (websites/apps — with "verified" indicator if analytics-verified)
- Users / traffic / subscribers / followers / installs (per type)
- Age (channel age, domain age, account age)
- Technology stack (website/app/software)
- Industry/category
- Ending time + bid count (auctions)
- Quality/security summary (e.g., "3 low · 0 critical")

**Rules**

- **No fake metrics, no placeholders** (rule #23). If a metric has no real value, the slot is absent.
- Tabular numerals so numbers align across cards in a grid.
- Chips have text labels (not color-only) for accessibility and trust.
- Auction cards show **server** time remaining; click-through reveals full detail.

### Card visual grammar (no Flippa visuals)

- Flat surface, 1px hairline border, 8px radius, minimal/no shadow.
- Type badge = neutral chip with icon; verification/quality chips = semantic but restrained.
- Price is the visual anchor (largest figure on the card), then secondary metrics in a compact grid.
- Hover/focus: subtle border emphasis only (no lift/gradient).

---

## 4. LISTING DETAIL (high-value presentation)

- **Above the fold:** title, type, verification + quality chips, price/current bid + countdown,
  primary CTA (Bid / Buy Now / Make Offer / Watch), seller mini-card.
- **Verified information panel:** clearly separates **Verified** (platform-checked: ownership,
  analytics, scans) from **Seller-reported** (claimed). Verified data gets a distinct marker so
  buyers know what the platform actually attested.
- **Metrics grid** adapts to asset type (revenue, traffic, subscribers, technology, age, etc.).
- **Quality & security report:** normalized findings summary (counts by severity/category), with
  methodology note ("analyzed by <scanner> on <date>"), linking to the report — never raw secrets.
- **Transfer & escrow explainer:** what transfers, the custody checklist, and the 7-day lock.
- **Trust & risk:** dispute/review history, seller tier, response time.

---

## 5. MOBILE-FIRST & PERFORMANCE

- Cards collapse gracefully to a single column on small screens; countdown and price stay visible.
- Server-side filtering/sorting/pagination (no client-side "fake" filtering of a truncated set).
- SSR/ISR for public listing pages (SEO + fast first paint); images lazy-loaded and sized.
- Skeleton loaders that mirror real layout (no empty cards, no fake numbers).

---

## 6. EXPLICIT ANTI-PATTERNS (do not do)

- No giant marketing hero sections on browse/category pages.
- No empty dashboard cards or "coming soon" tiles with fake counts.
- No color-only meaning; no rainbow gradients as decoration.
- No copying Flippa copy, icons, colors, layouts, or assets (rule #20).
- No infinite spinners without progress or error states.
