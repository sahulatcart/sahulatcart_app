# Changelog

A running, reverse-chronological log of work on this project: what changed, why, and what was left
open. Read this before starting new work. Append a dated entry after any meaningful chunk of work.

Entries before 2026-09-16 were reconstructed from git history and commit messages.

---

## 2026-09-17 — apple-touch-icon

**Changed**
- Added `apple-touch-icon.png` (180×180) to `site/assets/` and `admin/public/`, linked from all 4 site
  pages and from the admin's Next.js `metadata.icons.apple`.

**Decisions**
- **Baked a white background in rather than keeping transparency.** iOS renders a transparent
  apple-touch-icon as solid black on the home screen, so an opaque background is required, not optional.
  White matches how the mark reads on light surfaces; a teal-filled background with a knockout cart would
  be bolder but means altering the supplied artwork.
- Art fills 76% of the canvas, leaving ~12% margin per side so iOS's rounded-rect mask doesn't clip it.
- Composited from the 2048px PNG and downsampled with LANCZOS, rather than rasterizing the SVG — no SVG
  rasterizer (rsvg/cairosvg/ImageMagick) is installed on this machine, and downsampling from 2048 gives
  cleaner edges than upscaling the 512.

**Verified**
- Site on :4173 — asset 200, decodes to a real 180×180 square, `rel="apple-touch-icon"` on all 4 pages.
- Admin on :3000 — Next emits both `icon` and `apple-touch-icon` links; asset 200 and decodes 180×180.
  Login page re-screenshotted: no regression to the existing mark.
- admin typecheck exit 0; backend tests 71/71.

**Still open** (unchanged from the logo entry)
- `og:image` is still a relative path — needs the production domain.
- 16px favicon legibility.
- The Sahulatkaar / SahulatCart naming split.
- **Railway still has not deployed anything** — see the investigation in the logo entry below.

---

## 2026-09-16 — Real logo replaces the placeholder marks

**Changed**
- Added the SahulatCart cart mark as real assets, sourced from
  `~/Downloads/sahulatcart_icon_logo/sahulatcart-cart-mark.svg`:
  `site/assets/logo.svg`, `site/assets/favicon.svg`, `site/assets/logo-1024.png`,
  and `admin/public/{logo,favicon}.svg` (**`admin/public/` did not exist** — Next.js had no static dir).
- Replaced all 8 placeholder marks across `site/{index,features,pricing,demo}.html` (nav + footer on
  each) — these were a hardcoded Urdu **س** glyph, not a logo.
- Replaced the admin marks in [admin/components/AppShell.tsx](admin/components/AppShell.tsx) and
  [admin/app/login/page.tsx](admin/app/login/page.tsx), which rendered `PRODUCT_NAME.charAt(0)` in a
  gradient tile.
- Swapped the favicon on all 4 site pages — it was an inline 🛺 **rickshaw emoji** data-URI — and wired
  `icons.icon` into the admin's Next.js `metadata`.
- Added `og:image` to all 4 site pages; the site previously had **zero** `og:`/`twitter:` tags.
- Rewrote `.brand .mark` ([site/assets/style.css](site/assets/style.css)) and `.sidebar .logo .mark`
  ([admin/app/globals.css](admin/app/globals.css)).

**Decisions**
- **Dropped the gradient tile behind the mark.** Both marks previously sat in a filled rounded square
  (conic rose→amber→emerald on the site; a teal linear gradient in admin) built to frame a *letter*. The
  cart is a fine-lined teal glyph and turned muddy inside it, so the mark now sits directly on the
  background. Both nav and footer are dark (`--ink #071410`) and the teal holds up against them.
- **Stripped the C2PA content-credentials block** from the web copies — 7.7KB of the original 16.6KB,
  which would have shipped on every page load for zero rendering benefit. The original file in
  `~/Downloads/` is untouched and still carries its provenance metadata.
- **`<img src>` rather than inline SVG.** The path data is ~8.9KB; inlining it at 10 sites would have
  added ~64KB of duplicated markup across the pages. One cached file instead. Costs the ability to theme
  via `currentColor`, which is moot here since the mark is a fixed brand color.
- **Two SVG variants**: `logo.svg` keeps the natural 1736×1423 (1.22:1) ratio for lockups beside the
  wordmark; `favicon.svg` is padded to a square box, since the source art is not square and favicons are.
- Sized by height with `width: auto` so the ratio can't be squashed by a future CSS change.

**Verified**
- Served `site/` on :4173 — all 3 assets return 200; all 4 pages carry 2 marks, the new favicon and
  `og:image`, with no emoji favicon left. Nav and footer `<img>` both report `naturalWidth > 0` and
  render at 37×30, confirming the ratio survived the rewrite.
- Admin on :3000 — login page renders the mark (46×38); `/logo.svg` and `/favicon.svg` both 200, so the
  new `admin/public/` dir resolves. The sidebar can't render without a Supabase session (`AppShell`
  returns `null` until `hasSession()` succeeds), so its markup was injected into the live page to
  exercise the real `globals.css`: computed 30px × 36.61px, ratio 1.22 preserved, no gradient tile.
- Toolchain green after `npm install` finally succeeded: `build:shared` 0, backend typecheck clean,
  **admin typecheck exit 0**, backend tests **71/71** on the pinned vitest.

**Railway deploy did not pick this up** (investigated 2026-09-16, unresolved — no dashboard access)
- Pushed `df33be8..a842bd0` to `main`; `git ls-remote` confirms GitHub has `a842bd0`.
- The live admin still served the **old** build ~5 min later: `/logo.svg` 404, and the login HTML still
  contained `linear-gradient(135deg, var(--brand), var(--brand-strong))` — the exact style deleted in
  `4622f29`. Deleted CSS cannot come back from a browser cache, so this is a stale build, not caching.
- Ruled out: Dockerfiles both `COPY . .`; `.dockerignore` does not exclude `admin/public/`; repo has no
  GitHub Actions to gate a deploy.
- Remaining suspects are all Railway-side: auto-deploy disconnected, service watching another branch, or
  a failed build. Check Deployments → Settings → Source when access is available.
- Known deployed admin URL (hardcoded in the site nav): `alluring-happiness-production-9190.up.railway.app`.
  The marketing site's URL is not recorded anywhere in the repo.

**Known issues / TODO**
- **The name is still "Sahulatkaar" everywhere** while the mark reads "SC" / SahulatCart — left open per
  your call. `PRODUCT_NAME` is config, but the Urdu wordmark سہولت کار is hardcoded in the site nav and
  would need a decision of its own.
- At true 16px browser-tab size the mark's thin strokes read as a teal smudge. Inherent to the artwork;
  a dedicated simplified favicon glyph would fix it, but that's a design call.
- No `apple-touch-icon` — it needs a *square* PNG and all three supplied PNGs are 1.22:1.
- `og:image` uses a relative path; it needs an absolute URL to actually resolve when a link is shared.

---

## 2026-09-16 — Project tracking setup

**Changed**
- Cloned the repository into the working directory from `github.com/farhankazim/sahulatkaar`.
- Created [CLAUDE.md](CLAUDE.md) — durable reference only: invariants, layout, commands, architecture,
  conventions, known gotchas.
- Created this CHANGELOG and added a "Project History" pointer at the top of CLAUDE.md.

**Decisions**
- Split standing reference (CLAUDE.md) from historical log (CHANGELOG.md) so CLAUDE.md doesn't
  accumulate session cruft and stays cheap to read cold.
- CLAUDE.md documents the **actual** state of the code, not the spec's intent, wherever the two diverge.
  The clearest case: the spec says Claude is the bot brain, but only the Gemini provider is implemented.
  A future session trusting the spec here would waste time.

**Verified**
- `npx vitest run` in `backend/`: 8 files, 71 tests, all passing.

**Known issues / TODO**
- `npm install` has not been run in this clone — `node_modules` is absent. The test run above pulled a
  transient vitest (5.0.1) rather than the pinned `^2.1.1`. Run `npm install` before real work.
- No linter configured; root `npm run lint` is a stub.
- No test suite for the admin portal.
- `pitch/` contains stray Office lock files (`~$*.xlsx`, `~$*.pptx`) that should be removed and gitignored.

---

## 2026-07-06 — Production bug fixes, demo features, marketing site, pitch materials

**Bot correctness fixes**
- Product matching ([backend/src/orchestrator/resolve.ts](backend/src/orchestrator/resolve.ts)): added
  `stem()` for English/Roman-Urdu plurals (shirts→shirt, shirtein→shirt, boxes→box). Live failure on
  06 Jul: "Mujhe kuch shirts dikhain" → "shirts abhi nahi hain", because no match step handled plurals.
  Also required the shorter side of a substring match to be ≥4 chars, killing a false positive where
  "capri pants" matched "Cap".
- Classifier: added "kr lo yr" / "chalo done" as accept examples — a mid-haggle "Kr lo yr" was being
  classified as a greeting.
- Unknown-product handling: an explicit product mention that doesn't resolve now returns "not found"
  instead of silently falling back to the previous active product (the bot was getting stuck on "T-Shirt").
- Greetings after a session no longer re-quote a leftover active product.
- Conversation context now resets on `completed`, so a chat can place a second order. `createDraftOrder`
  skips negotiations already materialized into a prior order.

**Money / negotiation fixes (P0)**
- Engine: messages with no offer and no discount ask (`intent: 'other'`) now HOLD at the standing price
  instead of advancing the concession curve — "delivery kitne din?" was walking the price to the floor.
- HOLD prices persist as `last_bot_offer`, so a following "theek hai" closes at the price actually
  quoted rather than full list.
- Unstated quantity keeps the negotiation's persisted quantity ("2 shirts" then "1900 final" stays an
  order for 2).
- Classifier returns `offerScope`; "2 shirts 3000 me" is a **total** and is divided per-unit before
  reaching the engine — previously a below-floor bulk offer looked like a premium and got accepted.
- Payment selection: "cash nahi, bank se karonga" no longer confirms COD. Both-mention answers apply
  negation handling; still-ambiguous answers re-ask instead of guessing.
- Order-flow dead-ends closed: cancel and human-handoff escapes added to `collecting_delivery`,
  `selecting_payment`, `awaiting_payment_proof`. "COD kar dein" while awaiting a screenshot switches the
  bank order to COD.

**Features**
- Quantity-aware quotes: "3 kitnay ki?" states per-piece *and* line total. The price guard treats
  `totalRupees` as a sanctioned companion number — the unit price is still required and any third number
  still trips the guard.
- Voice notes: `LlmClient.transcribeAudio` (Gemini, handles `audio/ogg; codecs=opus`). The webhook
  transcribes **before** storing so the transcript flows through every state and appears in the merchant
  inbox. Unintelligible audio gets a polite "likh kar bhej dein". Reactions (👍) became store-only.
- Bargaining personality dial (narm/standard/sakht) → concession-curve presets + reply tone. Implemented
  as pure config; the engine was deliberately left untouched.
- Post-order upsell: suggests the cheapest other in-stock product, excluding anything already bought in
  the conversation. "haan" reuses saved delivery details and skips to payment; "nahi" closes politely
  with no haggling over add-ons. Toggle `settings.upsellEnabled`, default on.
- Product knowledge: photo uploads to `product-images`, description editor with "AI se likhwao" (Gemini
  vision drafts Roman-Urdu copy from the first photo, never inventing price/brand/size), attributes
  editor. Bot gained `ask_product_info`, `ask_shop_info`, `ask_photo` — all grounded, answering only from
  merchant-supplied facts, same philosophy as the price guard.
- Shop knowledgebase in Settings (delivery/returns/payment/address/hours + FAQs) stored in `settings.kb`;
  no migration needed, PATCH deep-merges.
- Shopify import: detects a Shopify product-export CSV, groups variants by handle, takes the cheapest
  variant price, sums stock, keeps image URLs remote, maps Option1-3 → attributes, strips HTML body.
  Fixed plain-CSV decimal prices (99.99 → 9999 paisa, was 10000).

**Non-code**
- `site/`: 4-page static marketing site with a truck-art identity (animated WhatsApp negotiation demo,
  concession-curve SVG, pricing with PKR plans, demo booking). Pure HTML/CSS/JS, no dependencies, nginx
  Dockerfile. Later removed a personal WhatsApp number and the bot-demo CTA from the contact page, and
  pinned the Dockerfile builder via `site/railway.json`.
- `pitch/`: 11-slide competition deck (pptxgenjs source included) + a variable-driven 5-year financial
  model (Assumptions → 60-month engine → annual Forecast → Dashboard), verified free of formula errors.

**Known issues left at the time**
- Pitch survey slide carried explicit `XX%` placeholders pending real survey tallies.
- Test count reached 71/71.

---

## 2026-07-03 — Multi-tenant auth, portal redesign, Phase 5b/5c

**Part A: multi-tenant auth + RLS scoping**
- Dual auth in [backend/src/lib/auth.ts](backend/src/lib/auth.ts): Supabase JWT → `merchant_users`
  membership → per-merchant context; or `ADMIN_API_TOKEN` → platform-admin on the default merchant.
  `merchant_id` is always derived from verified auth, never client input.
- `routes/admin.ts` refactored so every endpoint is scoped to `req.merchantCtx.merchantId`. By-id
  endpoints are ownership-checked and return **404** cross-tenant (not 403 — avoids confirming existence).
- Role gates: payment verify/reject and bank accounts restricted to owner/manager; cost hidden from staff.
- Invite-only onboarding: `POST /admin/merchants` (platform-admin) creates auth user + merchant + owner.
- Public `GET /api/v1/config` returns the Supabase URL + anon key at runtime, avoiding build-time
  `NEXT_PUBLIC` baking.
- Portal moved to Supabase email/password login with JWT Bearer on all calls. Token login retired from
  the UI; the backend still accepts it for the pilot path.
- Verified cross-tenant isolation (merchant A cannot see or touch B) and pilot regression; no schema
  changes; 39 unit tests green.

**Phase 5c**
- PDF order slips via **pdfkit** — chosen over a headless browser to avoid shipping Chromium. Stored in
  `order-slips`, sent to the buyer as a WhatsApp document (on confirm for COD, on payment verify for bank).
- CSV catalog import with a dependency-free parser + `POST /admin/products/import`, plus a downloadable
  template.
- Meta catalog sync: pulls WABA Commerce products, upserting by `retailer_id` → `external_ref`
  (migration `0005` adds the unique index).
- Onboarding wizard (`/onboarding`): business → negotiation → bank → bot → go-live.

**Phase 5b**
- Live inbox with human takeover: the bot goes silent on `human_takeover` conversations; inbound is still
  stored and `unread_count` incremented.
- Admin API: conversation list/detail, takeover/release (mirrors `current_state`/`resume_state`), agent
  send, analytics (orders, collected vs gross revenue, negotiation win-rate, avg discount, COD vs bank,
  return/cancel rate).

**UI**
- Full portal redesign: design system in `globals.css` (tokens, Inter, component classes), sidebar
  `AppShell` with lucide icons + mobile drawer, toast system replacing `alert()`. Every screen reworked.
- Fixed inbox scrolling — was using `scrollIntoView`, which scrolled the whole page and hid the
  conversation list and chat header. Replaced with `min-height: 0` + container `scrollTop`.
- Fixed empty-body POSTs by only sending a JSON content-type when a body is present.

---

## 2026-07-02 — Phases 0 through 5a, and deployment shakeout

**Phase 0 — foundations**
- npm workspaces (`shared`, `backend`, `admin`) + `db/`. Fastify backend skeleton with fail-fast Zod
  config, `/healthz` and `/readyz`.
- Migration `0001`: core tables + 17 enums + child-guard trigger. `0002`: hardened RLS + the Custom
  Access Token Hook. RLS default-deny verified against Supabase.
- Brand name made config (`PRODUCT_NAME`) and the package scope kept neutral (`@app/*`) so a rename is a
  one-variable change.

**Phase 1 — negotiation engine**
- Pure, side-effect-free `decide()` per spec doc 06: floor precedence (min_price > pct > margin guard),
  concession curve, opening stance, auto-accept, round cap/stalemate, agreed-lock, clamp + round-to-rupee.
- 21 vitest cases covering all doc-06 §10 scenarios, plus a fuzz invariant (price always within
  [floor, list]) and a prompt-injection guard. The engine ignores model-suggested prices entirely and
  recomputes from product + rules.

**Phase 2 — WhatsApp pipe**
- Webhook: GET verify handshake; POST with raw-body `X-Hub-Signature-256` verification (hardened
  compare), fast-ACK, out-of-band processing.
- Pure payload parser + type normalization; tenant routing by `phone_number_id`; per-inner-item
  idempotency via `webhook_events`; customer upsert; conversation get-or-create with the 24h window;
  delivery-status updates.
- Shipped with an echo orchestrator stub, replaced in Phase 3. Pilot seed script + Railway config added.

**Phase 3 — bot brain**
- Provider-agnostic LLM layer with a Gemini adapter (thinking disabled, JSON classify schema, retries),
  swappable via `LLM_PROVIDER`.
- Orchestrator: classify intent + extract offer → deterministic product resolution → `decide()` →
  persist round → compose Roman-Urdu reply. Greeting, product Q&A, negotiation, handoff, stop/opt-out.
- Outbound price-match guard + deterministic Roman-Urdu fallbacks; holds politely when the LLM is down.
- Migration `0003`: negotiations + notifications.
- Verified live against Gemini + Supabase: quote → haggle → accept-at-floor, never below floor,
  injection-safe.

**Phase 4 — orders and payments**
- Migration `0004`: orders, order_items, payments, payment_claims, bank_accounts, delivery_zones,
  order_status_history + enums + hardened RLS.
- Order flow wired into the FSM: ACCEPT → collecting_delivery (LLM delivery extraction) →
  selecting_payment → COD confirm (order number, slip, `cod_pending`, payments row, `new_order`
  notification) → completed. Bank path shows merchant bank details → awaiting_payment_proof.
- Decided to **skip the classify LLM call in order-flow states** for cost and rate-limit reasons — this
  is why those states need their own regex escape hatches (added 06 Jul after they caused dead-ends).
- 4b: inbound screenshot downloaded from Graph → private Supabase Storage (`payment-screenshots`) →
  claim references the storage key, with signed URLs minted on demand. `verifyPayment`, `rejectPayment`,
  `markCodCollected`, exposed via a token-gated pilot API pending the Phase-5 portal.

**Phase 5a — admin portal**
- Backend admin API (token-gated, single-merchant): login, me, dashboard, orders list/detail, screenshot
  signed URL, payment verify/reject/cod-collected, products CRUD, settings, bank accounts.
- Next.js App Router portal with login, dashboard, orders + detail, catalog with inline editing, and
  settings including a bot kill-switch.

**Deployment fixes (learned the hard way)**
- `next.config` rewrites bake at build time, so the `/api` proxy could not read a runtime `BACKEND_URL`.
  Replaced with a dynamic route handler — this is why the proxy is written the way it is.
- Node 20 → Node 22 image: `supabase-js` needs native WebSocket, absent in Node 20.
- Railway run image must carry the **whole** workspace `node_modules`; npm hoisted `@fastify/helmet` to
  the root and it wasn't being copied. Dockerfile simplified to copy the built repo, plus `.dockerignore`.
- Bumped Next to 14.2.35 to clear a Railway security scan (CVE-2025-55184 / 67779).
- `/readyz?llm=1` probe added to diagnose LLM connectivity on a deployed backend.
- Gemini client honors 429 `RetryInfo` delays with more retries, for free-tier resilience.
- Bot quotes list price on product interest (`ask_product` / `add_to_order`) rather than opening with a
  counter.
