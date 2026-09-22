# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Read this first

[docs/PITFALLS.md](docs/PITFALLS.md) — rules distilled from real mistakes made on this repo: leaked
secrets, an admin outage caused by blind redeploys, a burned API quota, a falsely reported passing
typecheck. **Read it before your first change**, whether you are a person or an AI agent. It is short.

## Project History

See [CHANGELOG.md](CHANGELOG.md) for a chronological log of changes and decisions. Read it at the start
of every session before making changes.

**Update it after every change — not at the end of the session.** And record the *hassle*, not just the
outcome: what was tried that failed, what the misleading symptom was, and what the real cause turned out
to be. A note saying "the site now deploys" is nearly worthless; "the site failed four times because the
root railway.json overrode its start command, and the build log said so on the first attempt" is what
saves the next person hours. Dead ends are the most valuable thing in this file.

## What this is

Sahulatcart (formerly "Sahulatkaar" — see Branding below) is a multi-tenant
SaaS that gives a Pakistani merchant an autonomous **WhatsApp sales agent**. The bot chats with buyers in
**Roman Urdu**, negotiates price within merchant-set floors, builds and confirms orders, handles COD or
bank-transfer-by-screenshot payments, generates an order slip, and notifies the merchant. Merchants
configure and oversee everything from a web admin portal, including manual takeover of any chat.

### Product invariants (non-negotiable)

Per [docs/spec/00-overview.md](docs/spec/00-overview.md):

1. **Deterministic pricing** — the negotiation floor and all discount logic live in code
   ([backend/src/negotiation/engine.ts](backend/src/negotiation/engine.ts)). The LLM never decides
   prices; it only classifies intent and phrases replies.
2. **Never touch money** — no payment gateway, no fund custody. COD, or the merchant's own bank account
   with manual merchant verification. This keeps the product clear of SBP/EMI licensing.
3. **Merchant always in control** — human takeover on any chat; the bot must never trap a customer with
   no way to cancel or reach a human.
4. **Roman-Urdu native** — real Pakistani code-switched WhatsApp language, not formal English.
5. **Multi-tenant from the schema up**, even though launch is single-merchant (Path C).
6. **Never invent facts** — the same philosophy as the price guard extends to product and shop Q&A: the
   bot answers only from merchant-supplied description/attributes/knowledgebase, otherwise it defers
   ("malik se confirm kar ke batata hoon").

The **spec in `docs/spec/`** (10 numbered docs) is the source of truth for product behavior. When
behavior is ambiguous, check the relevant spec doc before guessing.

## Repository layout

npm workspaces: `shared`, `backend`, `admin`. The other top-level directories are not workspaces.

```
backend/   Node + TypeScript (Fastify) — webhook, admin API, orchestration, negotiation engine
admin/     Next.js (App Router) — merchant admin portal
shared/    TS enums + types, single source consumed by both backend & admin (@app/shared)
db/        Supabase SQL migrations (schema, RLS, auth hook) — plain SQL, applied in filename order
site/      Static marketing site + legal pages (pure HTML/CSS/JS, no deps; nginx Dockerfile)
pitch/     Investor/competition deck + financial model, plus their generator scripts
docs/      spec (docs/spec/) + dev and founder plans
```

## Commands

```bash
cp .env.example .env              # fill Supabase keys; Meta/LLM keys optional until needed
npm install                       # installs all workspaces
npm run build:shared              # compile @app/shared — run after changing shared types
npm run dev:backend               # backend on :8080 (tsx watch); GET /healthz, /readyz
npm run dev:admin                 # admin portal on :3000
npm run build                     # build shared then backend
npm run typecheck                 # typecheck shared + backend
npm run db:migrate                # node --env-file=.env db/migrate.mjs
```

Admin typechecks separately: `cd admin && npm run typecheck`. Root `npm run lint` is a placeholder
("lint not configured yet") — there is no linter in this repo.

**Do not run `npm run build -w @app/admin` while the admin dev server is running.** The production build
overwrites `admin/.next`, after which the dev server 404s on its client chunks and pages render but never
hydrate — they look fine and respond to nothing. Fix: `rm -rf admin/.next` and restart.

### Tests

Vitest, backend only (no admin test suite). Test files sit next to their source as `*.test.ts`.

```bash
npm run test -w @app/backend                                   # all backend tests once
npm run test:watch -w @app/backend                             # watch mode
cd backend && npx vitest run src/negotiation/engine.test.ts    # a single file
cd backend && npx vitest run -t "accepts at floor"             # a single test by name
```

Current suite: **8 files, 71 tests**. `src/negotiation/engine.test.ts` mirrors the scenario table in
[docs/spec/06-negotiation-engine.md](docs/spec/06-negotiation-engine.md) §10 and is expected to stay at
100% — treat a failure there as a product-behavior regression, not a flaky test.

Run tests via the npm script, not bare `npx vitest`: without `node_modules` installed, `npx` silently
fetches a different major version than the pinned `^2.1.1`.

### Database

Migrations are plain SQL applied in filename order, either via `npm run db:migrate` or `psql` against the
Supabase connection string (see [db/README.md](db/README.md)). After `0002_rls_and_auth_hook.sql`, the
Supabase **Custom Access Token Hook** must be enabled in the dashboard (Authentication → Hooks →
`public.custom_access_token_hook`) or every tenant query fail-closes to zero rows by design.

Storage buckets: `product-images` (public-read), `payment-screenshots`, `inbound-media`, `order-slips`,
`catalog-imports` (all private).

## Architecture

### Inbound message pipeline

[backend/src/whatsapp/webhook.ts](backend/src/whatsapp/webhook.ts) verifies `X-Hub-Signature-256` over
the exact raw bytes (a scoped content-type parser preserves `rawBody`), fast-ACKs within 5s, then
processes out of band: dedupes by `wa_message_id` via a `webhook_events` insert (the unique-constraint
violation *is* the idempotency check), transcribes voice notes, upserts customer + conversation,
persists the message, and calls `runOrchestrator`.

Tenant routing: one backend, one webhook endpoint; inbound is routed to a merchant by looking up
`phone_number_id` in `whatsapp_numbers`. Unknown numbers are logged and ignored.

### Conversation orchestrator

[backend/src/orchestrator/orchestrator.ts](backend/src/orchestrator/orchestrator.ts) is the state machine
over `BotState` (`shared/src/enums.ts`): greeting → browsing → product_qa → negotiating →
collecting_delivery → selecting_payment → awaiting_payment_proof → completed, plus `handoff`. Rules baked
in that are easy to break accidentally:

- **Human takeover**: if `conversations.status === 'human_takeover'`, the bot stays silent — it only
  stores the message and bumps `unread_count`.
- **Order-flow states skip intent classification** (`collecting_delivery`, `selecting_payment`,
  `awaiting_payment_proof`) to cut LLM calls, but each still routes through `handleEscape()` first so
  cancel and human-handoff always work — otherwise customers get trapped in "send your address" loops.
- **Price-match guard**: every LLM-composed reply that states a price is checked by
  [orchestrator/guard.ts](backend/src/orchestrator/guard.ts) `priceGuardOk()` against the engine's actual
  number. A mismatch discards the LLM output in favor of a deterministic Roman-Urdu template
  (`fallbackText()`). Only the unit price and the engine-derived line total are sanctioned numbers; a
  third number trips the guard. This is the concrete enforcement of invariant #1.
- **Context lifecycle**: conversation `context` resets when `current_state === 'completed'`, so a new
  message starts a fresh shopping session rather than re-quoting the last item. The `upsell` flag lives
  exactly one turn.
- **Product carry-forward**: the active product is only carried forward when the customer names no new
  product. An explicit mention that doesn't resolve is "not found" — never a silent fallback to the
  previous item.

Composed from independently tested modules: `resolve.ts` (product matching), `upsell.ts` (add-on picker),
`order-service.ts` (draft/confirm orders), `payment-service.ts`, `slip.ts` (PDF slips), `guard.ts`.

### Negotiation engine

[backend/src/negotiation/engine.ts](backend/src/negotiation/engine.ts) is pure — no I/O, no randomness,
no clock. [docs/spec/06-negotiation-engine.md](docs/spec/06-negotiation-engine.md) is normative.

`decide()` takes product/defaults/history/customerOffer/intent and returns `{action, price, audit}` where
action is ACCEPT | COUNTER | HOLD | REJECT | ASK. Floor precedence: absolute `min_price` wins over
`list × (1 − max_discount_pct)`; bulk tiers add extra discount on top; a cost-based margin guard can only
ever **raise** the floor. Every returned price is guaranteed within `[floor, listPrice]`. The engine
ignores any model-suggested price and recomputes from product + rules.

Bargaining personality (narm/standard/sakht) is **pure config** — concession-curve presets fed into the
engine, not engine logic. Keep it that way.

### LLM layer

[backend/src/llm/](backend/src/llm/) is provider-agnostic behind `LlmClient`
([llm/types.ts](backend/src/llm/types.ts)): `classify`, `compose`, `extractDelivery`, `transcribeAudio`.
All language understanding and generation funnels through this one interface, with negotiation math
entirely outside it. `compose` never gets free rein — it is handed a structured `ReplySpec` (a
discriminated union of ~20 reply kinds) and only phrases it.

**Gotcha:** the spec docs describe "Claude" as the bot brain and `@anthropic-ai/sdk` is a dependency, but
**Gemini is the default and only implemented provider**. `getLlmClient()` throws
`'Anthropic client not implemented yet'` if `LLM_PROVIDER=anthropic`. Check
[llm/index.ts](backend/src/llm/index.ts) before assuming Anthropic is wired up.

### Admin API and portal

- Backend serves `/api/v1/*` from [backend/src/routes/admin.ts](backend/src/routes/admin.ts). Auth is
  **dual-mode** via [lib/auth.ts](backend/src/lib/auth.ts) `resolveCtx()`: a Supabase JWT
  (`Authorization: Bearer`) resolved through `merchant_users` membership, **or** a pilot-only
  `x-admin-token == ADMIN_API_TOKEN` fallback scoped to the default merchant.
- `merchant_id` is **always** derived server-side from verified auth — never from client input. By-id
  endpoints ownership-check and return 404 (not 403) cross-tenant.
- `canManagePayments()` gates money-sensitive actions (payment verify/reject, bank accounts, cost/margin
  visibility) to owner/manager/platform-admin. Staff must not see cost or verify payments.
- The portal never calls the backend directly from the browser. It proxies same-origin through
  [admin/app/api/[...path]/route.ts](admin/app/api/[...path]/route.ts), which reads `BACKEND_URL` at
  **request** time and forwards client headers through unchanged.
- [admin/lib/api.ts](admin/lib/api.ts) is the client fetch wrapper: attaches the Supabase token,
  redirects to `/login` on 401, and holds the formatters `rs()` (paisa → `Rs N`) and `dt()` (timestamps
  in `Asia/Karachi`).

**There is no default merchant password.** `db/seed.mjs` creates the merchant row but no auth user.
Logins are created invite-only via `POST /api/v1/admin/merchants`, which calls
`db.auth.admin.createUser({ email, password })`. Credentials live in Supabase Auth, not in this repo.
Locally the portal cannot authenticate at all without `.env` + a running backend: `/api/v1/config`
returns 502 and the client throws `supabaseUrl is required`.

### Config

[backend/src/config.ts](backend/src/config.ts) is Zod-validated env with fail-fast boot. Only Supabase
vars are required at boot; Meta and LLM secrets are optional and asserted only when their feature path is
exercised (`assertMetaSecrets`, `assertAnthropicSecrets`). Not every var in `.env.example` is needed to
boot locally.

## Deployment

Three Railway services, all built from this repo, all in the owner's own Railway account (migrated
off the previous owner's on 2026-09-21).

| Service | URL | Build |
|---|---|---|
| Marketing site | `site-production-d318.up.railway.app` | `site/Dockerfile` (nginx) |
| Admin portal | `appadmin-production-0a30.up.railway.app` | `admin/Dockerfile` |
| Backend | `appbackend-production-dae8.up.railway.app` | Railpack, `npm run build --workspace=@app/backend` |

**`www.sahulatcart.com` is live** on the `site` service (cut over from a Vercel deployment on
2026-09-22). The apex redirects to it through a Namecheap **URL Redirect Record**, not through
Railway — the plan's custom-domain limit was already reached by `www`, so the apex could not be added
as a second Railway domain.

Consequence: `https://sahulatcart.com` (bare domain, https) **fails** — Namecheap's redirect server
has no certificate. `http://sahulatcart.com` and `www` both work. Putting Cloudflare in front fixes
it; that is unresolved and touches the MX/SPF records, so it needs the owner's go-ahead.

The same limit blocks `app.sahulatcart.com` for the admin portal, which stays on its Railway URL. The
site's 8 Login links point at it directly.

Previous DNS values, and the MX/SPF rows that must not be touched, are in
[DNS-ROLLBACK.md](DNS-ROLLBACK.md). The Google Search Console verification TXT also lives on `@` —
**do not delete it**; losing it silently unverifies the property, which has already happened once.

Infrastructure is declared in [.railway/railway.ts](.railway/railway.ts) and applied with
`railway config plan` / `railway config apply`. **Always re-run `railway config plan` after an apply**
— if a field is still listed, it did not persist.

The admin's `buildCommand` is deliberately `echo docker-build` — a harmless no-op. It is **not**
leftover junk: Railway previously held a *start* command in that slot, which failed every deploy, and
setting the field to `null` silently would not persist. Do not "tidy" it away.

**There must be no `railway.json` at the repo root.** One used to sit there setting
`startCommand: node backend/dist/index.js` for *every* service built from the root, so the admin and
the site both booted the backend. Each service declares its own start command in the IaC file.

**The nginx config must go in `/etc/nginx/conf.d/`, never `/etc/nginx/templates/`.** The image runs
`envsubst` over templates from `/docker-entrypoint.sh`, but Railway's custom start command
(`start: "nginx -g 'daemon off;'"`) **replaces the image's ENTRYPOINT**, so that script never runs. A
template there is silently ignored and nginx serves its stock default config.

This cost weeks: `try_files $uri $uri.html` sat in a template and was never once in effect, so
`/privacy` 404'd while `/privacy.html` worked, and nobody could see why. The config now lives in
[site/nginx.conf](site/nginx.conf), copied straight to `conf.d/default.conf`, with `nginx -t` run at
build time so a broken config fails the build instead of deploying.

`site/nginx.conf` also holds the 301s from the previous Next.js site's paths and the WooCommerce
shop URLs that Google still has indexed, plus `absolute_redirect off` — without it nginx builds
redirects from `$scheme`, which is `http` behind Railway's TLS termination, sending every redirect
through a pointless extra hop.

## Conventions

- **Money is paisa** (integer, 1/100 rupee) everywhere in the backend and DB. Convert to rupees only at
  the reply/UI edge — `rupees()` in orchestrator.ts, `rs()` in admin. Decimal CSV prices must be parsed
  exactly (99.99 → 9999 paisa, not 10000).
- **Brand name is config** (`PRODUCT_NAME`). Never hardcode a brand name in new code. Buyer-facing text
  uses the merchant's own `merchants.business_name`, not the platform name.
- **Every `ReplySpec` kind needs a deterministic Roman-Urdu fallback** in `fallbackText()` — it is what
  ships when the LLM is down or the price guard trips. Adding a reply kind without a fallback is a bug.
- **Free-text regexes are dangerous here.** `CANCEL_RE`, `HUMAN_RE`, `COD_RE`, `BANK_RE` run against text
  that may be an address or a person's name ("Malik" is a common name, "Band Road" is a real street).
  Keep new patterns multi-word or unambiguous.
- **Shared enums mirror the DB.** `shared/src/enums.ts` must stay in lockstep with the Postgres enums in
  `db/migrations/0001_core.sql`.
- Prefer dependency-free implementations where practical — the CSV parser, the marketing site, and PDF
  slips (pdfkit rather than a headless browser) all follow this.

## Branding — current state

The **Sahulatcart** brand guidelines v1.0 are **implemented and live** across the marketing site and
the admin portal (commit `55973c0`, deployed 2026-09-21). An earlier attempt was rolled back on
09-18 and then re-applied; the changelog has that history. `backup/pre-rollback-2026-09-18` is a
local-only branch preserving the pre-rollback tree.

- The name is **"Sahulatcart"** — one word, capital S, lowercase c. Explicitly *not* "SahulatCart".
- The legal entity is **Nubrix Technologies (Pvt) Ltd**, Lahore. "Sahulatcart" is the trading name.
  The terms name the company as the contracting party and the privacy policy as data controller.
- Brand tokens: teal `#249E87`, green `#268D3C`, mint `#C2FFB4`, forest `#113320`, navy `#0A0D13`,
  slate `#6D7486`, border `#E7E9ED`, surface `#F6F7F9`. Kaisei Decol / Poppins / JetBrains Mono.
- Three sanctioned gradients only. `--grad-trust` carries a deliberate **70% opacity** on both stops —
  that is part of the mark, not a styling choice, and transcribing it as solid hex is wrong.
- The **standalone icon is flat teal, never gradiented**; the gradients belong to the wordmark.
- Teal on white is 3.33:1 — "Avoid" for body text. Signal Green is for primary buttons; body text is
  navy or slate.

**The old truck-art variable names still exist and are aliases, not dead code.** `--rose`, `--amber`,
`--sky`, `--ink`, `--cream` and friends are re-mapped onto brand tokens at the top of
[site/assets/style.css](site/assets/style.css) so the existing rules keep working
(`--rose` → Signal Green, `--amber` → Mint, `--sky` → Teal). Changing a rule to a raw hex instead of
an alias is how the palette drifts. The admin does the same: `--brand: var(--color-teal)` in
[admin/app/globals.css](admin/app/globals.css).

**Wordmark gradient:** the `.wordmark` split ("Sahulat" + "cart") uses `background-clip: text`. Use
`background-image`, never the `background` shorthand — the shorthand resets `background-clip` and the
gradient paints as solid blocks. `admin/components/Wordmark.tsx` does the split for the portal.

## Legal pages and Meta Tech Provider status

`site/` carries `terms.html`, `privacy.html`, `data-deletion.html`, `about.html` and `support.html`,
written against Meta's actual Tech Provider obligations rather than a generic template. If you edit
them, these points are load-bearing and were put there for a reason:

- **Controller/processor split.** For buyer data the merchant is controller, we are processor. For
  merchant account data we are controller. Both legal pages lead with this.
- **The WhatsApp Business Solution Terms forbid** using Business Solution Data to build profiles of
  WhatsApp users, to train or improve any ML/AI model, or to share it with third parties. The privacy
  policy states each of these as a binding commitment. Do not soften them.
- **Meta business verification matches the website against Business Manager and the uploaded
  documents, character for character.** The legal name, address and phone appear in the footer of
  every page and in the `about.html` table. Registered address (full street) and NTN are still
  placeholders marked with a loud `.tbc` class — do not remove the class until the real values land.
- `data-deletion.html` exists because Meta wants a **separate** Data Deletion Instructions URL, not a
  privacy-policy section.
- Pakistan has **no enacted** data protection statute; the PDP Bill is still before the legislature.
  The policy commits to its principles and cites PECA 2016 — it must not claim compliance with a law
  that does not exist.

## Marketing site — SEO files

`site/` carries `robots.txt` and `sitemap.xml`. **`sitemap.xml` lists 9 URLs and is not generated** —
adding or renaming a page means editing it by hand, or Google never learns about the page.

Canonical tags point at the **`.html`** form, which is what physically exists. Extensionless URLs work
as aliases via `try_files`; the canonical tag is what stops the two counting as duplicate content.
Keep them consistent if you add pages.

The homepage carries two JSON-LD blocks: Organization/WebSite/SoftwareApplication, and a FAQPage.
Both are validated at commit time only by eye — check them if you edit the head.

**Context worth knowing:** this domain previously hosted a WooCommerce grocery shop ("Sahulat Cart"),
then a separate Next.js marketing site on Vercel. Google indexed both. Their URLs are 301'd in
`site/nginx.conf` rather than left to 404. Search Console is verified as a **Domain property** —
DNS TXT is the only verification method those support, so there is no backup method to add.

## Known gotchas

- **Node 22+ required at runtime.** `supabase-js` needs native WebSocket, absent in Node 20, despite
  `engines.node: >=20` in package.json.
- **Next.js `next.config` rewrites bake at build time** and cannot be used for `BACKEND_URL`. That is why
  the API proxy is a dynamic route handler.
- **Railway run image needs the whole workspace `node_modules`** — npm hoists deps (e.g. `@fastify/helmet`)
  to the root, so copying only `backend/node_modules` breaks at runtime.
- **Railway auto-deploys again** (verified 2026-09-21 — pushes land on the live URLs). The old
  "not auto-deploying" note is obsolete. The traps that actually bit, all logged in the changelog:
  a **start command sitting in the `buildCommand` slot** fails every deploy while the build log looks
  like a clean Next build; setting an IaC field to `null` **silently does not persist** (use a real
  value like `echo docker-build`); and `railway variables --skip-deploys` means no container ever
  picks the change up. **Read the build log before changing anything** — see
  [docs/PITFALLS.md](docs/PITFALLS.md).
- **Gemini free tier is 20 requests per DAY**, not per minute — the quota id is
  `GenerateRequestsPerDayPerProjectPerModel-FreeTier`. Once exhausted the bot silently falls back to
  `fallbackText()` templates, which looks exactly like the bot being broken. The client honors 429
  `RetryInfo` delays.
- **The free tier also breaches Meta's terms.** Google's free tier uses submitted content to improve
  its models and human reviewers may read it; the WhatsApp Business Solution Terms forbid Business
  Solution Data being used to train or improve any ML/AI system. **Billing must be enabled** — it
  fixes the quota and the compliance problem together. Until it is, the privacy policy's "the provider
  does not use this content to train" describes the intended state, not the current one.
- **`GEMINI_MODEL` defaults to `gemini-2.5-flash` in [config.ts](backend/src/config.ts), which is
  retired for new Google accounts.** `.env` sets `gemini-3.5-flash`. Do not rely on the default.
- **`/readyz?llm=1` makes a live Gemini call — never poll it.** Background monitors hitting it every
  15s once consumed an entire day's quota and sent hours into chasing a fault the monitoring caused.
  Use plain `/readyz` for liveness.
- **Reactions (👍) are store-only.** Never generate a reply to a reaction.
- **The site's portal links are hardcoded** to `appadmin-production-0a30.up.railway.app/login` (the
  current admin). [site/assets/site.js](site/assets/site.js) rewrites any `*.railway.app` link to
  `localhost:3000` when the site is served from localhost, so local "Login" stays local.
- **The admin cannot log in locally unless the backend is running too.** It fetches `/api/v1/config`
  for the Supabase URL and anon key; with nothing on `:8080` that fetch fails and the Supabase client
  is never built. Start both (`.claude/launch.json` has entries for backend, admin and site).
- **`python -m http.server` sends no cache headers**, so the marketing site's CSS caches hard during
  local work. Hard-refresh (`Cmd+Shift+R`) after style changes or you will debug a stale stylesheet.
