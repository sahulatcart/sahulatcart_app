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

Current suite: **44 files, 496 tests**. `src/negotiation/engine.test.ts` mirrors the scenario table in
[docs/spec/06-negotiation-engine.md](docs/spec/06-negotiation-engine.md) §10 and is expected to stay at
100% — treat a failure there as a product-behavior regression, not a flaky test.

Run tests via the npm script, not bare `npx vitest`: without `node_modules` installed, `npx` silently
fetches a different major version than the pinned `^2.1.1`.

[backend/vitest.config.ts](backend/vitest.config.ts) gives every test a dummy environment. `config.ts`
validates env the moment the logger is imported, so without it only pure modules were testable. The
values are fake on purpose — a test must never reach the real database, WhatsApp or Gemini.

**Whole conversations are tested** in
[orchestrator/orchestrator.flow.test.ts](backend/src/orchestrator/orchestrator.flow.test.ts): scripted
intents in, replies and DB rows out, over [test-support/fake-db.ts](backend/src/test-support/fake-db.ts),
an in-memory stand-in for the Supabase query builder. The fake implements only the builder calls the
order flow uses — a new call (`.or()`, `.range()`, …) needs adding there — and its RPCs are JS twins
of the SQL in migrations 0006/0008. Change one, change the other; the SQL itself is tested in Postgres.

### Database

Migrations are plain SQL applied in filename order, either via `npm run db:migrate` or `psql` against the
Supabase connection string (see [db/README.md](db/README.md)). After `0002_rls_and_auth_hook.sql`, the
Supabase **Custom Access Token Hook** must be enabled in the dashboard (Authentication → Hooks →
`public.custom_access_token_hook`) or every tenant query fail-closes to zero rows by design.

Storage buckets: `product-images` (public-read), `payment-screenshots`, `inbound-media`, `order-slips`,
`catalog-imports` (all private).

**Backups** (since 2026-10-12): the project is on Supabase's free plan, which has **no automatic
backups**. `db/backup.sh` dumps `public` (schema + data) and the portal logins to
`~/Sahulatcart-Backups/` on the owner's Mac and keeps 30 days. `db/backup-schedule.sh install` runs it
daily through a LaunchAgent. It only runs while that Mac is on, and Storage files are not included.
Details and restore steps are in [db/README.md](db/README.md).

**Browsers get no direct table access** (`0007_lock_direct_table_access.sql`, live since 2026-09-29). The portal uses Supabase
only to sign in; all reads and writes go through the backend's service role, where roles are enforced.
RLS stays on as defence in depth. Two rules follow for every new migration:
- New tables are locked for `anon`/`authenticated` automatically (default privileges) — keep it that way.
- New **functions** are not: Postgres grants `EXECUTE` to `PUBLIC` globally and that cannot be revoked
  per schema. End every new function with `revoke execute on function … from public, anon, authenticated;`
  (see 0006) or anyone can call it through `/rest/v1/rpc`.

**Order numbers** come from `next_order_number()`, an atomic per-merchant counter (0006, live since
2026-09-29). If it can't allocate a number, checkout stops rather than guessing one.

**Stock** (0008): a placed order (COD confirmed, or bank transfer awaiting payment) reserves its items
with `reserve_stock()` — all or nothing, so a sold-out item cancels the checkout instead of overselling.
Any cancellation calls `release_stock()`. Both are idempotent via `orders.stock_reserved`. Only products
with `track_stock` and a known count are touched. If the reservation call itself fails, the order goes
back to draft and checkout stops, as with a missing order number. Unknown stock never sells (since
2026-10-12; before that the order went through untracked).

## Architecture

### Inbound message pipeline

[backend/src/whatsapp/webhook.ts](backend/src/whatsapp/webhook.ts) verifies `X-Hub-Signature-256` over
the exact raw bytes (a scoped content-type parser preserves `rawBody`), records each message, ACKs, then
processes out of band: dedupes by `wa_message_id` via a `webhook_events` insert (the unique-constraint
violation *is* the idempotency check), transcribes voice notes, upserts customer + conversation,
persists the message, and calls `runOrchestrator`.

Nothing Meta was told we received may be lost:
- **Claim before the 200.** `claimWebhookPayload()` records every message in a payload (`webhook_events`
  row, storing `{ phoneNumberId, msg }`) *before* the route answers; `processClaimed()` runs them after.
  Each row is then marked `processed` or `error`. If a row can't be written, or the tenant lookup fails,
  the route answers **500** and Meta redelivers. Rows already written come back as duplicates, and the
  unwritten message isn't processed now. Before 2026-10-12 the 200 went out first, so a DB blip at
  that moment lost the message for good.
- **One at a time per buyer.** [lib/keyed-queue.ts](backend/src/lib/keyed-queue.ts) `serialize()` keys on
  merchant + sender, so a burst ("hi", "ye kitne ka?") can't race over one conversation's state. It is
  in-process: correct while the backend runs as **one instance**; more replicas need a DB lock instead.
  So are the admin-token lockout and the rate-limit store (P6). Railway exposes `RAILWAY_REPLICA_ID`
  but no count, so the boot only warns when the id is present; a second replica needs all three
  moved to Postgres (advisory locks / a counter table) or Redis first.
- **Replay.** `startReplaySweeper()` re-runs messages left `received` for 5–60 minutes (a crash or
  redeploy killed them), at most 3 times, then `dead_letter`. It runs **only when `NODE_ENV=production`**:
  a local backend shares the live DB and WhatsApp token via `.env` and must never answer real customers.
  A replay can repeat a reply that was already sent — a duplicate beats silence.
- **Shutdown** stops taking webhooks, then waits up to 25 s for queued messages (`drainWebhooks`).
- **Job heartbeats** (F1, since 2026-10-14): the four background jobs (replay sweeper, retention,
  unpaid expiry, billing) run through `runJob()` in [lib/job-runs.ts](backend/src/lib/job-runs.ts),
  which upserts one `job_runs` row per job at the start and end of every run (migration 0020). The
  console's Jobs tab reads it. The write may fail (the table lags the deploy by a few minutes); it
  is logged once and the job still runs. Uzair's U2 adds the founders' inbox call on failure there.
- **Retention** ([lib/retention.ts](backend/src/lib/retention.ts), spec 09 §8.2): a message's stored copy
  is dropped once it's processed. Hourly, in production only, `webhook_events` rows and `messages.raw`
  are purged after **30 days**, and payment screenshots **90 days after the claim is decided**. A claim
  still awaiting review is never touched, whatever its dates. Each purge writes an `audit_log` row. Both
  periods are shorter than the privacy policy's maximums (§10: 90 days for logs, 12 months for
  screenshots), which is allowed. The policy wording hasn't been changed.

Tenant routing: one backend, one webhook endpoint; inbound is routed to a merchant by looking up
`phone_number_id` in `whatsapp_numbers`. Unknown numbers are logged and ignored.

### Outbound credentials (M1, since 2026-10-13)

Every send and media download uses the credentials of the **number it acts for**:
[whatsapp/credentials.ts](backend/src/whatsapp/credentials.ts) `lookupToken()` goes
`whatsapp_numbers.access_token_ref` → `whatsapp_secrets` → AES-256-GCM decrypt
([lib/crypto.ts](backend/src/lib/crypto.ts), key `TOKEN_ENCRYPTION_KEY`, 32 bytes as hex or
base64, **required in production**). Callers (`sendText`, `sendImage`, `sendDocument`,
`downloadWhatsAppMedia`, catalog sync) never see a token. Rules that are easy to break:
- **The env token `META_SYSTEM_USER_TOKEN` is used only for `META_DEFAULT_PHONE_NUMBER_ID`** (the
  pilot number) until that merchant reconnects through Embedded Signup (M2). Any other number
  without a secret is refused (`errorCode: 'no_credentials'`), never sent with the platform token.
- A number that is `disconnected`, or `needs_attention` with `flag_reason='token'`, is refused.
  This one function is the whole guarantee that a disconnected shop stops sending.
- Meta error **190** (dead token) on any send calls `markTokenInvalid()`: the number is flagged, the
  cache dropped, and a `system` notification written. `SendResult.errorCode` carries Meta's code.
- Lookups are cached 10 minutes per number; `forgetNumber()` after connect, reconnect, disconnect.
- `whatsapp_secrets` bytea columns go through supabase-js as `\x<hex>` strings (`toBytea`/`fromBytea`).
- The flow test harness mocks `whatsapp/client` wholesale; client behaviour is tested in
  `client.test.ts` with a mocked `fetch` and `credentials.test.ts` over `FakeDb`.
- Migration **0009** (`whatsapp_connect`) adds `attention_message`, `last_test_at`, the connect
  attempts table and two enum values; it must be applied before a 190 error can be recorded.

### Connect WhatsApp (M2, since 2026-10-13)

[whatsapp/connect.ts](backend/src/whatsapp/connect.ts) runs Meta Embedded Signup server-side;
[whatsapp/meta-graph.ts](backend/src/whatsapp/meta-graph.ts) holds the Graph calls (every one with
`appsecret_proof`); [routes/whatsapp.ts](backend/src/routes/whatsapp.ts) is its own route file with
`requireMerchant()` from `lib/auth.ts` (the hook inside `adminRoutes` is encapsulated there, so new
route files apply their own); the page is `admin/app/settings/whatsapp/`. Rules:
- **The browser sends only the single-use `code` plus hints.** The backend verifies the hinted WABA
  and number against `debug_token` and `/{waba}/phone_numbers`; a hint that doesn't match is a 400.
- **Connected is proven by a handshake, not an outbound test.** A free-form text to the merchant's
  phone would be refused (131047: no window open). After the upsert the number is `connecting`;
  `handleConnectHandshake()` in `webhook.ts` answers the merchant's own first text (phones compared
  as digits only, `lib/phone.ts`) and sets `connected` only when the reply got a message id. A
  131042 on that reply means "no payment method on the WABA" → `needs_attention`, `policy`.
- **133005 is PIN mismatch, not "already registered".** The page asks for the merchant's existing
  PIN and `POST /whatsapp/retry {pin}` registers with it. 133006 (re-verify) and 133016 (limit) get
  their own messages. Registration with the same PIN again just succeeds.
- Steps A.2–A.5 run with the raw token (the `whatsapp_numbers` row doesn't exist yet); only sends
  after the upsert go through `credentials.ts`. The PIN is stored as a `whatsapp_secrets` row of
  kind `pin`.
- One number per merchant: a second connect sets the old row `disconnected` and deletes its secret;
  a number owned by another merchant is 409 `number_in_use` and the new token is discarded.
- `whatsapp_connect_attempts.code_hash` makes the route idempotent per code.
- `GET /api/v1/admin/whatsapp` is IC-4; `connecting` means "awaiting the handshake". With Meta's
  **test** number the merchant's phone must be one of the five test recipients, and the page says so.
- Needs `META_APP_ID`, `META_APP_SECRET` and `META_EMBEDDED_SIGNUP_CONFIG_ID` (M7 step 2) on Railway;
  without the last two the page shows "Meta app is not configured yet". The Graph field names and
  error codes come from Meta's docs as of mid-2026; re-check them in the dashboard before the first
  real connect.

### Connection status, account events, disconnect (M3, since 2026-10-13)

- **Account-level webhook fields** (`phone_number_quality_update`, `account_update`,
  `message_template_status_update`) carry no `metadata.phone_number_id`; the WABA id is
  `entry[].id`. `parseAccountEvents()` in `parse.ts` extracts them (`parseWebhook()` still ignores
  them), `claimWebhookPayload()` claims each under `item_type='event'` with id
  `field:waba:sha256(value)` so a redelivery is a duplicate, and `processClaimed()` runs
  [whatsapp/account-events.ts](backend/src/whatsapp/account-events.ts) after the ACK. A WABA-level
  event applies to every number row with that `waba_id`. FLAGGED → `needs_attention`/`quality`;
  UNFLAGGED clears **only** a quality flag (never token or policy); DISABLED/VIOLATION/RESTRICTION →
  `policy`; PARTNER_REMOVED → `token` (reconnect). The dashboard subscription for the four fields is
  M7 step 3; until then nothing arrives.
- **Disconnect** (`POST /api/v1/admin/whatsapp/disconnect`) deletes the secrets and keeps the row;
  Meta is not told. Inbound still routes to the row, is stored, and the bot is skipped; the merchant
  gets one portal notification a day (`remindDisconnected()` in `webhook.ts`, keyed on
  `data->>action = 'reconnect_whatsapp'`).
- **Send test** (`POST /whatsapp/test`) texts the merchant's own phone. It only works while their
  24-hour window with the shop is open; a 131047 puts the number back to `connecting` so the
  handshake proves it again. This is also what onboarding step 7 (P2) calls.
- **Business profile sync** (`syncBusinessProfile()`, IC-9; `POST /whatsapp/profile-sync` for P2) pushes
  name, address, description and hours to the number's WhatsApp profile, best effort, after the
  handshake. The address comes from `settings.kb.address` until P2 adds `merchants.address`; the
  picture is not pushed (needs Meta's upload API).

### Templates and the 24-hour cost rule (M4, since 2026-10-13)

Since 1 October 2026 every message past 1,000 a month per number is charged (Pakistan ≈ Rs 4,
`META_UTILITY_RATE_PAISA`), **including** free-form replies inside the buyer's 24-hour window, and a
template is **always** charged. So:
- **Nothing sends a template automatically.** `notifyBuyer()` in `payment-service.ts` sends
  free-form while the window is open; when it has closed it sends nothing, sets
  `orders.pending_buyer_notice` and writes a notification; the order page shows a button with the
  price, and `notifyBuyerNow()` (`POST /api/v1/admin/orders/:id/notify-buyer`) sends the template.
  It needs an **approved** template (`approvedTemplate()`, newest `_vN` wins) or answers 409.
- **Two UTILITY templates per shop**, `payment_update` and `order_sent`, defined in
  [whatsapp/templates.ts](backend/src/whatsapp/templates.ts) and created by `ensureTemplates()` after
  the handshake. Language `en` (Roman Urdu is Latin script). Rows in `message_templates` (migration
  **0010**, spec-02 column names, lowercase statuses); the `message_template_status_update` webhook
  updates them and notifies on rejected/paused (`template_status`). Resubmit creates `_v2`, `_v3`…
  because Meta refuses a rejected name for 30 days. Create/resubmit write `audit_log` rows.
- **Fewer messages per sale**: the payment question is two reply buttons (`sendButtons`,
  `askPaymentMethod()`) when a bank account exists; `handlePayment()` reads the tap id from
  `message.raw.interactive.button_reply.id` (parse.ts puts only the title in `text`); bank details
  and the screenshot ask are one message; the no-PDF COD confirmation is one message; a verified
  payment with a PDF is one document send with the text as caption. The flow tests assert the counts.
- The flow harness's client mock now records `type`, `buttons`, `template`, `params`; `tap(id,
  title)` simulates a button reply.

### The message meter and the AI budget (M5, since 2026-10-13)

[lib/usage.ts](backend/src/lib/usage.ts). One `message_usage` row per number per month (migration
**0011**), bumped by the atomic RPC `bump_message_usage()` from three places: every **successful**
send in `client.ts`, every inbound in `webhook.ts`, and every AI call through `chargeLlmCall()`.
- `FREE_QUOTA` is 1,000. Crossing 80% and 100% writes one `system` notification each.
  `GET /api/v1/admin/usage` (`routes/usage.ts`) is what the dashboard card, the inbox "paid" badge
  and billing (IC-6) read. The meter is an estimate; WhatsApp Manager's count is authoritative.
- `settings.afterFreeQuota` (`continue` default | `handoff`): at `handoff` and ≥ 1,000 outbound, the
  orchestrator hands **new** conversations over; the three order-flow states finish. The handoff
  reply is itself one paid message.
- `settings.llmDailyCap` (default 2,000): `runOrchestrator()` wraps the turn in `withLlmBudget()`
  (AsyncLocalStorage), and `chargeLlmCall()` runs before classify, compose and address extraction,
  and around voice transcription in the webhook. Past the cap it throws `LlmUnavailableError`, so
  classify falls into the existing "AI down" handoff and compose falls back to the template.
  Outside a budget scope (admin actions, tests) it is a no-op. Both settings are validated in
  `lib/validation.ts`.
- **Platform console (M6, since 2026-10-13).** [routes/platform.ts](backend/src/routes/platform.ts)
  behind `requirePlatformAdmin()`: a JWT whose user is in `platform_admins` (with or without a shop)
  or the pilot `ADMIN_API_TOKEN`. `jwtAuthn()` now looks up `platform_admins` beside the membership;
  a platform admin with no shop is `kind: 'platform'`, never `no_membership` (IC-7), so merchant
  routes answer 403 `NO_SHOP`, the portal's `api()` sends them to `/platform`, and
  `POST /signup/bootstrap` answers 409 for them. **Suspension**: `merchants.status='suspended'`
  (set by the console with a reason in `settings.suspension`, plus an `audit_log` row) makes the
  orchestrator store-only and every merchant route 403 `merchant_suspended` except the few in
  `SUSPENDED_OK` (`/me`, `GET /settings`, notifications) that the portal needs to show the banner.
  **Platform admins are invited by email** from `/platform/access` (F2, since 2026-10-14):
  the row starts with `auth_user_id` null and `platformAdminFor()` binds it to the auth user at
  their first login, only when the JWT's email is confirmed. Removing is soft; the last active
  admin and yourself cannot be removed. The console also has an **Audit** tab (a reader for
  `audit_log`, keyset-paged) and a **Jobs** tab, both served by
  [routes/platform-ops.ts](backend/src/routes/platform-ops.ts), where Uzair's inbox and sign-up
  settings routes also go. The fake DB has `reset()` for route tests, because route modules
  capture the client once at registration.
  **Looking inside a shop** (U1, since 2026-10-14): [routes/platform-shops.ts](backend/src/routes/platform-shops.ts)
  is read-only (the shop id from the URL only, 404 never 403, no `unread_count` write, never an
  account number) and every detail or chat read writes a `platform_view` audit row. `FakeDb`
  returns whole rows whatever the select names, so a route that must hide columns picks them in code.
- **A page file may export only the page.** `next build` refuses a named export from
  `app/**/page.tsx` ("does not match the required types of a Next.js Page"), while `tsc` is happy.
  Shared pieces go in `admin/components/`. This took the admin deploy down after PR #21 while the
  old container kept serving; run `cd admin && npm run build` (then `rm -rf admin/.next`) before
  pushing admin changes.

### Conversation orchestrator

[backend/src/orchestrator/orchestrator.ts](backend/src/orchestrator/orchestrator.ts) is the state machine
over `BotState` (`shared/src/enums.ts`): greeting → browsing → product_qa → negotiating →
collecting_delivery → selecting_payment → awaiting_payment_proof → completed, plus `handoff`. Rules baked
in that are easy to break accidentally:

- **Human takeover**: if `conversations.status === 'human_takeover'`, the bot stays silent — it only
  stores the message and bumps `unread_count`.
- **Opted-out and blocked customers** (P5, since 2026-10-13) are handled the same way, and
  **first**, before the merchant is even read: `customers.wa_opt_in_status='out'` or
  `is_blocked` → store, bump `unread_count`, no reply, no LLM call. The exact words `start` /
  `shuru` re-opt in. `STOP_RE` (whole message: stop, unsubscribe, band karo, bandh karo, msg mat
  karo) runs in every state before the order-flow handlers and the classifier; `optOut()` sends
  the one goodbye. A customer's first inbound message sets `wa_opt_in_status='in'` in the
  webhook's `upsertCustomer()`; an `out` is never flipped back by a message. Block/unblock is
  `routes/customers.ts`, managers only.
- **AI down → hand off.** If intent classification or address extraction fails (quota, outage, bad key),
  the chat goes to `handoff()` with a "Bot needs help" notification. Never promise a follow-up the bot
  can't deliver, and never re-ask for an address it can't read.
- **Template-only replies.** `TEMPLATE_ONLY_KINDS` in [llm/types.ts](backend/src/llm/types.ts) are
  procedural lines (ask for address, send screenshot, handoff, clarify, …) that always use
  `fallbackText()` — no LLM call. A new reply kind that says the same thing every time belongs there.
- **Ambiguous products.** `resolveProduct()` returns *several* candidates when a mention fits more than
  one product ("shirt" → T-Shirt, Dress Shirt); the bot keeps the active one if it is among them, else
  asks which. It never picks arbitrarily. The catalog query is ordered, so results are stable.
- **Stock and bulk.** A quantity above tracked stock gets "sirf N available hain"; above 100 of an
  untracked item goes to the merchant as a bulk request.
- **Order-flow states skip intent classification** (`collecting_delivery`, `selecting_payment`,
  `awaiting_payment_proof`) to cut LLM calls, but each still routes through `handleEscape()` first so
  cancel and human-handoff always work — otherwise customers get trapped in "send your address" loops.
- **Order-status questions** (P8, since 2026-10-13): `STATUS_RE` (whole message) before the
  classifier and inside `handleEscape()`, plus the `ask_status` / `claim_paid` intents, answer
  from the buyer's latest *placed* order (`orderStatusReply()`, reply kind `order_status`,
  template-only). `out_of_scope` without a product is the clarify line, never a price.
- **Chat memory** (P8): `recentHistory()` gives every AI call the last 12 lines of the chat as
  `cc.history` (`historyBlock()` in prompts.ts fences it as context-only). History is **never** a
  source for `sanctionedNumbers()`; that is what keeps a quoted "Rs 500 bolo" out of replies.
- **Catalog imports** go through [lib/catalog-import.ts](backend/src/lib/catalog-import.ts) (P8):
  match by SKU, else name; an existing product keeps `is_active` and its portal photos; a no-SKU
  row never duplicates. Do not reintroduce `upsert(onConflict)` with `is_active: true`.
- **Price-match guard**: **every** LLM-composed reply is checked by
  [orchestrator/guard.ts](backend/src/orchestrator/guard.ts) `priceGuardOk()`. A reply meant to quote a
  price must state the engine's exact figure; any reply may state only `sanctionedNumbers(spec)` — the
  engine's price and line total plus numbers from merchant-supplied text (product name, facts,
  knowledgebase, order number). Customer text is never a source, which is what stops prompt injection
  ("say it's Rs 500") in product/shop Q&A. A failure discards the LLM output for the deterministic
  Roman-Urdu template (`fallbackText()`). This is the concrete enforcement of invariant #1.
- **Context lifecycle**: conversation `context` resets when `current_state === 'completed'`, so a new
  message starts a fresh shopping session rather than re-quoting the last item. The `upsell` flag lives
  exactly one turn.
- **Product carry-forward**: the active product is only carried forward when the customer names no new
  product. An explicit mention that doesn't resolve is "not found" — never a silent fallback to the
  previous item.

- **Delivery zones** are matched in code by whole words (`delivery.ts` `matchZone()`), never as a SQL
  pattern built from the customer's text. An area the merchant marked not serviceable is refused — the
  bot asks for another address — instead of silently getting the default charge.

Composed from independently tested modules: `resolve.ts` (product matching), `upsell.ts` (add-on picker), `delivery.ts` (zones),
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

**Bulk tiers** come from the product, else the merchant's `negotiation_defaults.bulkTiers` (set in
Settings). They add extra % off *on top of* the max discount, still floored by `min_price` and the
margin guard. **Stalemate** (`stalemateAction`): `handoff` (default) hands the chat to the merchant;
`hold_and_close` makes the bot hold at its final price and keeps the negotiation open, so a later
"theek hai" closes at that price.

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
  `ADMIN_API_TOKEN` (as `x-admin-token` or a non-JWT Bearer) scoped to the default merchant. The token is
  compared in constant time, and after 10 wrong guesses every admin-token attempt is refused for 15
  minutes (`isAdminToken()`); portal JWT logins are unaffected.
- **The gate is `requireMerchant()`** in `lib/auth.ts`, applied as a `preHandler`. New route groups go
  in their own file (`routes/signup.ts`, `routes/onboarding.ts`, …) registered from `server.ts`, and
  apply it themselves — do not add more routes to `routes/admin.ts`. It answers 401 `UNAUTHORIZED`
  with no login, 401 `no_membership` for a valid JWT whose user owns no shop (the portal then sends
  them to `/auth/confirmed` to create one), and 403 `NO_SHOP` when there is no `merchantId` to act
  on. `resolveAuthUser()` verifies the JWT alone, for the one call made before a shop exists.
- **The bot cannot be switched on until the shop is ready** (P2, since 2026-10-13).
  [lib/readiness.ts](backend/src/lib/readiness.ts) `computeReadiness()` runs seven checks from the data
  (profile, whatsapp, catalog, delivery, payment, persona, testOrder); `PATCH settings` with
  `botEnabled: true` answers 409 `not_ready` with the failing steps unless all pass, whatever the
  client sends. `GET /admin/readiness` and the `readiness` block on `GET settings` drive the
  onboarding checklist and the settings toggle. `business_hours` is `{ mon: { open, close } }` per
  day; a day marked `{ closed: true }` does not count as "hours set". Delivery zones are edited
  through [routes/onboarding.ts](backend/src/routes/onboarding.ts); the same area in any case is
  refused, since the bot matches areas by whole words. The same file holds `PATCH /admin/profile`
  (name, owner, phone, address, category, hours — then a best-effort `syncBusinessProfile()`) and the
  logo upload.
- **The bot offers only the payment methods the merchant enabled.** `paymentMethods()` in the
  orchestrator reads `codOn(settings)` (`lib/validation.ts`: on unless `codEnabled === false`,
  the one rule shared with readiness and the routes) and the default active bank account. A live
  shop cannot drop its last method: the settings PATCH and the bank-account DELETE answer 409
  `last_payment_method`. Switching the bot on is a request of its own (400 if the body also
  changes `codEnabled`, `deliveryConfigured`, `attestations`, the persona or the name). Both →
  two buttons; COD only → a text confirm where a plain "haan" is a yes; bank only → no question, the
  details go straight out; neither → handoff. Every path that takes a payment choice, including the
  "COD kar dein" switch while waiting for a screenshot, goes through it. `settings.paymentInstructions`
  is appended under the bank details.
- **The greeting is the merchant's.** `bot_persona.greeting` and today's hours
  (`todayHoursText()` in [lib/hours.ts](backend/src/lib/hours.ts), Pakistan time) travel on the
  `greeting` reply spec as `greetingText`/`hoursText`; both are merchant text, so the guard sanctions
  their numbers. `formatHours()` folds the week for the WhatsApp business profile.
- **Phone numbers are digits only** everywhere they are stored or compared — `923001234567`, never
  `+92 300…` — because that is what WhatsApp sends as `wa_id`. Normalise with `phoneDigits()` and
  compare with `samePhone()` from [lib/phone.ts](backend/src/lib/phone.ts).
- `merchant_id` is **always** derived server-side from verified auth — never from client input. By-id
  endpoints ownership-check and return 404 (not 403) cross-tenant.
- `isManager()` (owner/manager/platform-admin) gates everything staff may not do, per the canonical
  matrix in [docs/spec/09](docs/spec/09-nonfunctional-devops.md) §2.3: payment verify/reject, bank
  accounts, **catalog and settings writes**, and reading `cost`. Staff *may* mark COD cash collected.
- Payment actions live in `payment-service.ts` as single conditional UPDATEs — the filter is the state
  check, so a double-click can't act twice (409 instead). Audit columns (`*_by_user_id`) reference
  `merchant_users.id`, which is `MerchantCtx.memberId` — **not** the Supabase auth user id.
- **Products are never deleted** (P5, since 2026-10-13): `DELETE /api/v1/admin/products/:id`
  (`routes/catalog.ts`) sets `is_active=false` and `deleted_at` (migration 0016) because
  `order_items` reference the row. Product reads filter `deleted_at is null`; the bot filters on
  `is_active`. The dashboard's "today" starts at 00:00 Pakistan time (`startOfTodayKarachi()`
  in `lib/hours.ts`), not UTC.
- **Billing** (P7, since 2026-10-13, [lib/billing.ts](backend/src/lib/billing.ts), migration 0017):
  `subscriptions` (one per shop: trial → active → past_due) and `invoices` (due → paid, by hand in
  the platform console). Plans and limits are `shared/src/plans.ts`; prices and the bank account are
  config. `botMode()` returns `sell` | `handoff` | `off`; the orchestrator hands new chats over
  while an invoice is past due or the month's conversation allowance is used, never mid-checkout,
  and a shop with no subscription row sells. The job runs every 6 h in production and is idempotent.
  A lapsed pilot is invoiced for Basic. Nothing in billing ever moves money (invariant 2).
- **Order stages** (P4, since 2026-10-13): [orchestrator/order-stages.ts](backend/src/orchestrator/order-stages.ts)
  moves an order confirmed/paid → preparing → dispatched → delivered, one step at a time (`STAGE_FROM`),
  through the same `transition()`; anything else is 409. Routes are in
  [routes/orders.ts](backend/src/routes/orders.ts); staff may set stages, **only managers cancel**, and
  any non-terminal order can be cancelled. Dispatch tells the buyer through `notifyBuyer(…, 'order_sent')`:
  free text inside the 24-hour window, else the paid notice on the order page. Unpaid bank orders
  expire hourly in production ([lib/jobs.ts](backend/src/lib/jobs.ts), `settings.unpaidExpiryHours`
  6–72, default 24); an order with a `payment_claims` row is never expired. Migration 0015.
- Merchant input is validated in [lib/validation.ts](backend/src/lib/validation.ts) (product fields,
  negotiation defaults, settings). A price is never 0 and `maxDiscountPct` is 0–100 — a typo of 150
  would otherwise put every floor at Rs 0.
- The portal never calls the backend directly from the browser. It proxies same-origin through
  [admin/app/api/[...path]/route.ts](admin/app/api/[...path]/route.ts), which reads `BACKEND_URL` at
  **request** time and forwards client headers through unchanged.
- [admin/lib/api.ts](admin/lib/api.ts) is the client fetch wrapper: attaches the Supabase token,
  redirects to `/login` on 401, and holds the formatters `rs()` (paisa → `Rs N`) and `dt()` (timestamps
  in `Asia/Karachi`). `apiJson()` **rejects** on an error status; for `api()` calls, show failures with
  `toast(await apiError(r), 'error')` — never toast "Saved" without checking `r.ok`.
- **Portal UI** is plain CSS in [admin/app/globals.css](admin/app/globals.css): semantic tokens
  (`--ink`, `--muted`, `--brand`, `--success`…) mapped onto the brand tokens, so components never use
  raw hex. Shared pieces live in [components/AppShell.tsx](admin/components/AppShell.tsx): `PageHead`,
  `BackLink`, `EmptyState`, `StatusPill`/`PaymentPill`, and `humanize()` (`cod_pending` →
  "COD pending"). Reuse them instead of new one-off markup. House rules: lucide icons with
  `aria-hidden`, never emoji; every input has a `<label>`, not just a placeholder; icon-only buttons get
  an `aria-label`; money cells use `td.num`, IDs and order numbers `.mono` (both never wrap). A
  `@media` override must come **after** the rule it overrides. One didn't, and silently did nothing.
- **Dark mode** (since 2026-09-30): `:root[data-theme="dark"]` in globals.css re-points the semantic
  tokens; the brand tokens never change. A new colour needs a token with a value in **both** blocks —
  a raw hex in a rule is exactly what breaks one theme. `data-theme` is set before first paint by
  `THEME_BOOT` in [components/ThemeToggle.tsx](admin/components/ThemeToggle.tsx) (inlined in
  layout.tsx): saved choice (`localStorage` `sk_theme`), else the OS setting. On dark, the wordmark
  uses the site's dark treatment (white "Sahulat", `--grad-glow` "cart"), never the light gradients.
- **Checking the portal visually** needs a signed-in session, and the real backend shares the live
  database. Don't point a local portal at the real backend to take screenshots. Use a mock on :8080
  instead: the admin has no `.env`, so `BACKEND_URL` falls back to `localhost:8080`, and the mock
  can't run alongside the real backend. **No mock is committed.** The one used on 2026-09-30 lived
  in a session scratchpad and is gone. A replacement needs:
  - `/api/v1/config`, returning a fake `supabaseUrl` that points back at the mock.
  - `POST <supabaseUrl>/auth/v1/token` returning a session, plus `/auth/v1/logout`, so the real
    login form works with any email and password.
  - CORS headers and a 204 for `OPTIONS`, because the browser calls that fake Supabase URL
    cross-origin.
  - Fixture JSON for the `GET /api/v1/admin/*` routes, and `{ok:true}` for any write.

  Or skip login by putting a session straight into `localStorage` `sk_auth`.
- The backend registers **no CORS** on purpose: nothing calls it from a browser on another origin.
- **Rate limits** (P6, since 2026-10-13, [lib/rate-limit.ts](backend/src/lib/rate-limit.ts)): signup
  and login 10/min per IP, WhatsApp connect 5/min, everything else 300/min per shop (per IP before
  login); the webhook and health routes are exempt. A 429 is `{ error: { code: 'RATE_LIMITED' } }`.
  `authenticate()` in `lib/auth.ts` is memoised per request so the limiter and the route gate share
  one lookup. The admin-token lockout is **per IP** (`isAdminToken(tok, req.ip)`); `trustProxy` is
  on so `req.ip` is Railway's first forwarded hop.
- **Sentry** (P6): `SENTRY_DSN` (backend) and `NEXT_PUBLIC_SENTRY_DSN` (admin, baked at build);
  empty means off. Bodies, cookies, query strings and user info are never sent (`dataCollection`
  in SDK v11, plus `beforeSend`). The Next.js build helper is `@sentry/nextjs/config`.
- **CI** (`.github/workflows/ci.yml`) runs both typechecks, the backend suite and `next lint` on
  every PR. Run `npm run lint -w @app/admin` before pushing admin changes; the config is
  `next/core-web-vitals` and the tree is warning-free.
- **Notifications go through `notify()`** in [lib/notify.ts](backend/src/lib/notify.ts) (P3, since
  2026-10-13) — never a direct `notifications` insert. It writes the portal row, then fans out in the
  background to Web Push (each owner's/manager's devices, `push_subscriptions`, migration 0014) and
  email (Resend, plain `fetch`) by `merchant_users.notification_prefs`; staff get nothing; WhatsApp is
  never used for merchant alerts. A missing `VAPID_*` or `RESEND_API_KEY` skips that channel. More than
  five emails in five minutes for one merchant become one digest (in-process counter: one instance;
  `flushPendingDigests()` runs on SIGTERM so a deploy does not drop the queue). The list is at
  `/notifications` with an unread badge in the nav; the channel switches and "send me a test" are at
  `/settings/notifications`, managers only, with a 30 s cooldown on the test. Push endpoints are
  allow-listed to the four real push services (`validPushEndpoint()`); the payload carries the row
  id so each alert gets its own lock-screen entry. Tests await the fan-out with `flushNotifications()`.
- **Founders are told only through `notifyPlatform()`** (U2, since 2026-10-14, same file): four
  kinds (`invoice_claimed`, `plan_requested`, `whatsapp_attention`, `job_failed`), a row in
  `platform_notifications` plus an email to every active platform admin under the digest key
  `'platform'`; never push, never a merchant's inbox. A missing table (0020 not applied) is a
  warning, never a failure for the caller. `job_failed` is suppressed to once per job per hour.
  The inbox is `/platform/inbox` with its count on the console nav link.
- **WhatsApp's 24-hour window.** Free-form messages to a buyer who last wrote over 24h ago are refused
  unless they use an approved template, and none exist yet. `notifyBuyer()` doesn't attempt them; it
  notifies the merchant to reach the buyer another way. The inbox disables replies and says why.

**There is no default merchant password.** `db/seed.mjs` creates the merchant row but no auth user.
Merchants join through `/signup` (self-service, P1): Supabase Auth creates the user and emails a
confirmation link that lands on `/auth/confirmed`, which calls `POST /api/v1/signup/bootstrap` →
`create_merchant_for_user()` (migration 0012) to create the shop and owner row, with the bot off.
Sign-up is open or allow-listed from `/platform/access` (U3, since 2026-10-14:
`platform_settings` keys `signup_open` / `signup_allowlist`, read by `signupGate()` and cached
60 s); the env vars `SIGNUP_OPEN` / `SIGNUP_ALLOWLIST` are only the fallback per key until a value
is saved, and active platform admins are always allowed. **Both values live in the panel since
2026-10-14 and the two vars were deleted from Railway**, so production falls back to closed and
empty if the rows ever vanish: a lost row can only close sign-up, never open it. Do not re-add them. The JWT must carry
`email_confirmed_at`, or bootstrap is 401. One login, one shop, ever: a deactivated membership is
409 `inactive_membership` (support reinstates it) and an email another shop uses is 409
`email_in_use` (migration 0019; the fake twin raises the same codes). The platform admin can still
create one via `POST /api/v1/admin/merchants`. Credentials live in Supabase Auth, not in this repo.
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

**Accounts.** Railway and Supabase both belong to `sahulatcart2026@gmail.com`. The Supabase project
(ref `cfvwxwpmwqfghstwutdp`, free plan) was transferred into that account on 2026-10-12. Ref, URL,
keys and data were unchanged, so no env var moved. The transfer required disconnecting Supabase's
GitHub integration. Nothing used it: migrations are applied by hand from `db/migrations`, and there
is no `supabase/` folder. **The free plan has no automatic backups**, so never delete the project to
"move" it. It holds the only copy of the live data.

| Service | URL | Build |
|---|---|---|
| Marketing site | `site-production-d318.up.railway.app` | `site/Dockerfile` (nginx) |
| Admin portal | `appadmin-production-0a30.up.railway.app` | `admin/Dockerfile` |
| Backend | `appbackend-production-dae8.up.railway.app` | Railpack, `npm run build --workspace=@app/backend` |

**`www.sahulatcart.com` is live** on the `site` service (cut over from a Vercel deployment on
2026-09-22). The apex redirects to it through a Namecheap **URL Redirect Record**, not through
Railway — the plan's custom-domain limit was already reached by `www`, so the apex could not be added
as a second Railway domain.

**Cloudflare is now in front of the domain** (found 2026-10-12; done by the owner, undocumented until
then): the nameservers are Cloudflare's, `https://sahulatcart.com` 301s to `www` correctly, and
mail is on Cloudflare Email Routing (`route*.mx.cloudflare.net`), not Namecheap's forwarders. The
SPF record still names Namecheap's forwarder; it only matters if mail is *sent* from
`@sahulatcart.com`. The Search Console TXT survived. DNS-ROLLBACK.md's MX rows are now historical.

The same limit blocks `app.sahulatcart.com` for the admin portal, which stays on its Railway URL. The
site's 8 Login links point at it directly.

**The plan for everything still to build is [docs/launch/PLAN.md](docs/launch/PLAN.md)** (2026-10-12):
two tracks, Meta paperwork and product, built so that Meta approval day is a settings change and not a
code change. Read it before planning any feature work; the older plans in `docs/launch/archive/` are
superseded.

Previous DNS values, and the MX/SPF rows that must not be touched, are in
[DNS-ROLLBACK.md](DNS-ROLLBACK.md). The Google Search Console verification TXT also lives on `@` —
**do not delete it**; losing it silently unverifies the property, which has already happened once.

Infrastructure is declared in [.railway/railway.ts](.railway/railway.ts) and applied with
`railway config plan` / `railway config apply`. **Always re-run `railway config plan` after an apply**
— if a field is still listed, it did not persist.

**The backend's `build` script compiles `@app/shared` first** (`tsc -p ../shared/tsconfig.json && …`).
Railway runs `npm run build --workspace=@app/backend`, and `@app/shared` resolves to `shared/dist`,
which doesn't exist in a clean checkout. Without this, every backend deploy fails while Railway keeps
serving the old container. That happened from 2026-09-21 to 2026-09-28 and looked healthy the whole time.

**To check what's actually deployed**, don't trust a 200. Look at `/healthz` `uptime` (it resets on
deploy), or probe a route that only the new code has. A CORS preflight is *not* a test: the old code
answered unknown origins with no header too.

For the admin, fetch `/login` and grep its stylesheets for a rule only the new code has.
`railway deployment list --service <name>` shows each deploy's status:
- **REMOVED** — a newer deploy replaced it. Normal, not a failure.
- **SKIPPED** — the push didn't match that service's `watchPatterns` in `.railway/railway.ts`. The
  backend and admin watch their own folder **plus** `shared/` and the root workspace files
  (`package.json`, the lockfile, `tsconfig.base.json`), since both build from them; the site watches
  only `site/`. A docs-only push (CHANGELOG, CLAUDE.md) skips all three. A new root file a build reads
  needs adding to `workspace` there, or changing it alone won't redeploy.
- **FAILED** — read the build log before changing anything.

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
  the reply/UI edge — `rupees()` in orchestrator.ts, `rs()` in admin. Parse every price *string* (CSV,
  Shopify, Meta catalog) with `parsePaisa()` in [lib/money.ts](backend/src/lib/money.ts): exact decimals
  (99.99 → 9999), formatted prices ("Rs1,500.00" → 150000), and null for anything not above zero.
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
  slips (pdfkit rather than a headless browser) all follow this. pdfkit's built-in fonts are Latin-only,
  so a slip with Urdu script or emoji skips the PDF and the buyer gets the text slip (`isPdfSafe()`).

## Branding — current state

The **Sahulatcart** brand guidelines v1.0 are **implemented and live** across the marketing site and
the admin portal (commit `55973c0`, deployed 2026-09-21). An earlier attempt was rolled back on
09-18 and then re-applied; the changelog has that history. `backup/pre-rollback-2026-09-18` is a
local-only branch preserving the pre-rollback tree. On 2026-09-30 the admin was redesigned on the
same tokens and gained dark mode (PRs #10 and #11; see "Portal UI" and "Dark mode" above).

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

- **Node 22+ required at runtime.** `supabase-js` needs native WebSocket, absent in Node 20. The root
  `engines.node` says `>=22`, and it matters: Railpack chooses its Node version from it (it said `>=20`
  until 2026-09-28).
- **The backend runs with `NODE_ENV=production` (since 2026-09-30), which needs `NPM_CONFIG_INCLUDE=dev`.**
  Railway gives service variables to the build too, and with `NODE_ENV=production` npm skips
  devDependencies. TypeScript is one, so the build dies with `tsc: command not found`. Both variables
  are declared in `.railway/railway.ts`; never remove one without the other. Before 2026-09-30 the
  backend ran with `NODE_ENV=development`, so the replay sweeper and retention job never ran.
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
  `GenerateRequestsPerDayPerProjectPerModel-FreeTier`. Once exhausted, replies fall back to
  `fallbackText()` templates and every new chat is handed to the merchant (see "AI down → hand off").
  The client fails fast on a per-day 429 and on API errors, and honors `RetryInfo` delays otherwise.
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
