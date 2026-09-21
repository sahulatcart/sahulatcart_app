# Changelog

A running, reverse-chronological log of work on this project: what changed, why, and what was left open.
Read this before starting new work. Append a dated entry after any meaningful chunk of work.

Entries for 2026-07 and earlier were reconstructed from git history and commit messages.

---

## 2026-09-21 — Migrated onto our own infrastructure

The project was inherited from a previous owner. Everything ran on his Supabase,
his Meta app and his Railway account, none of which we can access. This moves it
onto ours end to end.

**Infrastructure**
- New **Supabase** project: 5 migrations applied, auth hook enabled, 22 tables
  with RLS forced, 5 storage buckets, seeded merchant + 3 products.
- New **Meta** app: webhook registered, `messages` field subscribed, WABA linked.
- New **Railway** project (`exemplary-charm`) with three services — backend,
  admin and site — all building from `sahulatcart/sahulatcart_app`.
- Repo moved to the org: `sahulatcart/sahulatcart_app`.
- Admin login created and linked as owner of the seeded merchant.

**Root causes found (each cost real time)**

- **`railway.json` at the repo root broke every other service.** It set
  `startCommand: node backend/dist/index.js`, which applied to any service built
  from the repo root — so the admin *and* the site both booted the backend and
  died on missing Supabase vars. Deleted; each service now declares its own start
  command in `.railway/railway.ts` (Railway Infrastructure-as-Code).
- **`SUPABASE_URL` on Railway was truncated to `https://`.** Zod's `.url()`
  accepts that, so the backend booted and reported healthy while every query
  failed. A service can be "Online" and completely broken.
- **Supabase's direct DB host is IPv6-only.** `db.<ref>.supabase.co` resolves but
  is unreachable on IPv4 networks (`ENOTFOUND`). Migrations must use the session
  pooler (`aws-0-<region>.pooler.supabase.com:5432`, username `postgres.<ref>`).
- **`gemini-2.5-flash` is retired for new Google accounts.** The API says so
  explicitly. Existing accounts are grandfathered, which is why it worked for the
  previous owner. Moved to `gemini-3.5-flash`.
- **Gemini free tier is 20 requests per DAY per model**, not per minute — quota id
  `GenerateRequestsPerDayPerProjectPerModel-FreeTier`. That is ~10 customer
  messages/day. The previous owner's account had the older, far larger allowance;
  commit `209d72c` ("free-tier resilience") shows they hit limits too, just at a
  survivable volume. **Billing must be enabled for this product to function.**
- **`/readyz?llm=1` makes a live Gemini call.** Polling it for monitoring silently
  consumes the daily quota. Do not poll it.
- **The site Dockerfile `sed`-edited `/etc/nginx/conf.d/default.conf`**, which does
  not exist in current `nginx:alpine`; the `&&` chain short-circuited and nginx
  never started. Now uses `/etc/nginx/templates/` + envsubst — and that directory
  must be `mkdir -p`'d first, it does not exist either.

**Also fixed**
- `.env.example` described Anthropic (unimplemented) and omitted Gemini entirely.
  Railway reads it to suggest service variables, so fresh deploys were
  pre-populated with the wrong ones.
- Added `site/privacy.html` (required for Meta app publishing; the footer linked
  "Privacy" to `#` on every page).
- Site "Login" links pointed at the **previous owner's** admin deployment.

**Live URLs**
- site `https://site-production-d318.up.railway.app`
- admin `https://appadmin-production-0a30.up.railway.app`
- backend `https://appbackend-production-dae8.up.railway.app`

**Known issues / TODO**
- **Gemini billing not enabled** — the bot only sends `fallbackText()` templates
  until it is. This is the single blocker to a working product.
- Railway CLI `redeploy`/`up` frequently return FAILED or SKIPPED with empty logs;
  forcing a variable change is what reliably triggers a deploy.
- Admin password is weak and was set in plain sight; rotate before real data.
- Custom domains (`www`/`app`/`api`.sahulatcart.com) not configured. Changing the
  backend domain requires re-pointing the Meta webhook or inbound silently stops.
- `db/seed.mjs` omits the `catalog-imports` bucket (created manually).
- `hello@sahulatkaar.pk` on the contact page is still the previous owner's address.

---

## 2026-09-18 — Rolled back to the pre-session state

**Changed**
- `9bbbfe8` reverts the four commits pushed on 09-16/09-17. The tree is now byte-identical to `df33be8`
  (2026-07-06), the state before this work began.
- Recreated this file and [CLAUDE.md](CLAUDE.md) from scratch afterwards, describing the **current**
  (reverted) code rather than the rebranded version.

**Reverted by `9bbbfe8`**
- `1276028` apple-touch-icon · `485763c` Railway investigation log · `a842bd0` CLAUDE.md + CHANGELOG.md ·
  `4622f29` cart logo replacing the placeholder marks

**Decisions**
- **Revert, not reset + force-push.** A force-push would erase the commits from GitHub and break anyone
  who had pulled. A revert undoes the content while preserving history, and is itself reversible with
  `git revert 9bbbfe8`.
- **Everything preserved** on the local branch `backup/pre-rollback-2026-09-18` (8 commits), including
  the full Sahulatcart rebrand, which was never pushed.

**Important context for whoever reads this next**
The rollback did **not** change the live Railway site. Railway had been serving `df33be8` throughout —
verified repeatedly: `/logo.svg` and `/apple-touch-icon.png` both 404, and the deployed login page still
contained CSS that had been deleted days earlier. None of the reverted work ever ran in production, so it
cannot have caused any production behaviour.

**Also cleaned**
- `admin/.next` held 50MB of production build output from the rebrand. It is gitignored, so `git revert`
  could not touch it, and Next.js would have served those stale chunks from a repo that no longer
  contained that code. Removed, along with a stale `shared/dist`, which was then rebuilt from source.

**Known issues / TODO**
- **Railway auto-deploy is broken** — the single most important open item. See the entry below.
- The Sahulatcart rebrand is implemented and verified but unshipped, on the backup branch.

---

## 2026-09-16 → 09-17 — Logo, icons and a full rebrand (all subsequently reverted)

Kept for reference: this describes work that is no longer in the codebase. Recoverable from
`backup/pre-rollback-2026-09-18`.

**What was built**
- Replaced the placeholder marks with the real cart logo — the site had rendered a hardcoded Urdu **س**
  glyph and the admin `PRODUCT_NAME.charAt(0)`, each inside a gradient tile. Added `logo.svg`,
  `favicon.svg`, an og:image and a 180×180 `apple-touch-icon.png`, and created `admin/public/`, which
  did not exist. Replaced the inline 🛺 emoji favicon on all four site pages.
- Applied the Sahulatcart brand guidelines v1.0: the 8 brand tokens and 3 sanctioned gradients,
  Kaisei Decol + Poppins + JetBrains Mono, the two-tone gradient wordmark, and the
  Sahulatkaar → Sahulatcart rename. Removed all Urdu-script copy (Roman Urdu kept).

**Findings worth keeping even though the code is gone**
- The **standalone icon is flat teal, never gradiented** — the gradients belong to the wordmark. Easy to
  get backwards.
- Both wordmark gradients are drawn for **light** surfaces. `--grad-cart` passes through forest
  `#113320` at its 55% midpoint, which swallows the letterforms at 20px on a dark nav.
- The `"Sahulat"` trust gradient is **70% opacity**, not full — that is what makes the fade subtle. Easy
  to miss when transcribing the hex stops.
- The CSS `background` **shorthand resets `background-clip`**, so a gradient set that way paints as a
  solid block instead of filling glyphs. Use `background-image`.
- iOS renders a transparent apple-touch-icon as **solid black**; it needs a baked-in background.
- Teal `#249E87` on white is **3.33:1** — the guidelines mark it "Avoid" for body text.

**Railway deploy investigation (unresolved)**
- `git ls-remote` confirmed GitHub had the commits, yet the live admin kept serving the old build:
  `/logo.svg` 404 and the login HTML still contained the exact gradient placeholder that had been
  deleted. Deleted CSS cannot return from a browser cache, so this was a stale build, not caching.
- Ruled out: both Dockerfiles use `COPY . .`; `.dockerignore` does not exclude `admin/public/`; the repo
  has no GitHub Actions to gate a deploy; `next build` succeeds locally.
- Remaining suspects are all Railway-side — auto-deploy disconnected, service watching another branch, or
  a failing build. Needs dashboard access: **Deployments**, then **Settings → Source**.
- Known deployed admin URL (hardcoded in the site nav):
  `alluring-happiness-production-9190.up.railway.app`. The marketing site's URL is recorded nowhere in
  the repo.

---

## 2026-07-06 — Production fixes, demo features, marketing site, pitch materials

- **Product matching**: added plural stemming (shirts→shirt, shirtein→shirt) after a live failure where
  "Mujhe kuch shirts dikhain" returned "shirts abhi nahi hain". Substring matches now require ≥4 chars,
  fixing "capri pants" matching "Cap".
- **Money/negotiation P0s**: messages with no offer and no discount ask now HOLD instead of advancing the
  concession curve (questions were walking the price to the floor); HOLD prices persist as
  `last_bot_offer`; total-vs-per-unit offers are divided before reaching the engine.
- **Order-flow dead-ends**: cancel and human-handoff escapes added to the three order states, which skip
  intent classification.
- **Features**: voice-note transcription (transcribed before storing, so it flows through every state),
  bargaining personality dial (pure config, engine untouched), post-order upsell, quantity-aware quotes,
  product knowledge + shop knowledgebase with grounded Q&A, Shopify CSV import.
- **Marketing site**: 4-page static site with the truck-art identity. **Pitch**: 11-slide deck and a
  5-year financial model.

---

## 2026-07-03 — Multi-tenant auth, portal redesign, Phase 5b/5c

- Dual auth (Supabase JWT or `ADMIN_API_TOKEN`); `merchant_id` always derived from verified auth, never
  client input; by-id endpoints return 404 cross-tenant. Invite-only merchant creation.
- PDF order slips via **pdfkit**, chosen over a headless browser to avoid shipping Chromium. CSV catalog
  import, Meta catalog sync, onboarding wizard.
- Live inbox with human takeover — the bot goes silent on `human_takeover` conversations.
- Portal redesign: design system, sidebar shell, toast system. Fixed inbox scrolling, which had used
  `scrollIntoView` and scrolled the whole page.

---

## 2026-07-02 — Phases 0 through 5a, and deployment shakeout

- **P0** monorepo, Supabase schema + RLS + auth hook, Fastify skeleton. Brand name made config
  (`PRODUCT_NAME`) so a rename is one variable.
- **P1** deterministic negotiation engine + 21 cases covering the spec's scenario table, a fuzz invariant
  and a prompt-injection guard.
- **P2** WhatsApp webhook: signature verification over raw bytes, fast-ACK, tenant routing, per-item
  idempotency.
- **P3** orchestrator FSM + Gemini adapter + price-match guard + Roman-Urdu fallbacks.
- **P4** orders and payments: COD and bank-transfer-by-screenshot, private storage for screenshots,
  merchant verify/reject. Order-flow states skip the classify call to cut cost — which is why they later
  needed their own regex escapes.
- **P5a** admin API + Next.js portal.
- **Deployment lessons**: `next.config` rewrites bake at build time (hence the dynamic proxy route);
  Node 20 → 22 because `supabase-js` needs native WebSocket; the Railway run image needs the whole
  hoisted workspace `node_modules`.
