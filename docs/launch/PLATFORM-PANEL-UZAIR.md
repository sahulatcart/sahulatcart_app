# Platform panel — Uzair's part

Plan of 14 October 2026, revised from Uzair's draft of the same day. Uzair owns the rename, the
read-only look inside a shop, the founders' inbox and the sign-up settings; Fazal's part (migration,
job heartbeats, audit and jobs tabs, invite-by-email admins) is in
[PLATFORM-PANEL-FAZAL.md](PLATFORM-PANEL-FAZAL.md). Every file, column and function named below was
checked against `main` at PR #36.

## The whole thing in one paragraph

The founders get a panel at `/platform` in the existing admin app, behind the existing
`requirePlatformAdmin()` gate. It gains: a Jobs tab, an Audit tab, a read-only look inside any shop,
a founders' inbox (invoice claimed, plan requested, a WhatsApp number in trouble, a job failed) with
email, an Access tab (invite a platform admin, open or close sign-up, edit the allow-list), and the
portal is renamed "Merchant Dashboard". Nothing in the panel writes inside a shop. No new dependencies.

## Merge order (both developers)

| # | Branch | Who | Needs |
|---|---|---|---|
| 1 | `fix/p5-followups`, `fix/p4-followups` | Uzair | — (live bugs, [REVIEW-UZAIR-2026-10-13-part2.md](REVIEW-UZAIR-2026-10-13-part2.md); before any panel work) |
| 2 | `fix/merchant-dashboard-name` (**U0**) | Uzair | — |
| 3 | `feat/platform-jobs-audit` (**F1**) | Fazal | — |
| 4 | `feat/platform-shop-detail` (**U1**) | Uzair | F1 merged |
| 5 | `feat/platform-inbox` (**U2**) | Uzair | F1 merged and migration 0020 applied |
| 6 | `feat/platform-access` (**F2**) | Fazal | U2 merged |
| 7 | `feat/signup-gate-db` (**U3**) | Uzair | F2 merged |

The one migration, **0020**, lands in F1 and creates `platform_notifications`, `job_runs` and
`platform_settings`, and makes `platform_admins.auth_user_id` nullable. Nothing in Uzair's PRs adds
a migration. Each PR rebases on `main` before opening; every PR touches `PlatformTabs.tsx`.

## Ground rules (also in Fazal's file)

1. **Shop id from the URL only.** Platform routes read `:id` from `req.params`, never from
   `req.merchantCtx`. Every `:id` route starts with one `merchants` lookup and answers 404 when it
   finds nothing; child reads also match `merchant_id = :id` and answer 404, never 403.
2. **Look only.** Nothing under `/api/v1/platform/merchants/:id/*` writes to `orders`,
   `conversations`, `products`, `customers` or `merchants`, except the existing suspend, unsuspend
   and plan routes in `routes/platform.ts`. The chat reader never zeroes `unread_count` the way
   `GET /api/v1/admin/conversations/:id` does (`routes/admin.ts` line 183).
3. **Every look inside a shop is audited.** The shop-detail read and each chat read insert one
   `audit_log` row: `actor 'platform'`, `user_id` = `req.platformCtx.authUserId` (null for the pilot
   token), `action 'platform_view'`, `entity 'merchant'` or `'conversation'`, `entity_id` the row
   read, `merchant_id` the shop, `diff {}`. We are the processor for buyer data; this is the record.
4. **Merchants are told only through `notify()`**; founders only through `notifyPlatform()`.
5. **New route groups are their own files** with `app.addHook('preHandler', requirePlatformAdmin)`,
   registered from `backend/src/server.ts` after `platformRoutes`.
6. **Deploy runs before the migration.** A merge to `main` deploys on its own; Fazal applies the
   migration afterwards. Code that touches a 0020 table must survive the table being absent: log
   at `warn`, keep going.
7. **A page file exports only the page.** Shared pieces go in `admin/components/`. Run
   `cd admin && npm run build` (then `rm -rf .next`) before pushing admin changes.
8. **House rules for pages:** lucide icons with `aria-hidden`, a `<label>` for every input,
   `aria-label` on icon-only buttons, `td.num` for money, `.mono` for ids, `toast(await apiError(r), 'error')`
   on any failed `api()` call, `apiJson()` for reads, `rs()` and `dt()` for money and time,
   `humanize()` for enum values, `StatusPill` / `PaymentPill` / `Pill` from `AppShell.tsx`.
9. **Tests are the proof.** Route tests through `app.inject` over `FakeDb`, copying the boot and
   seed pattern of `backend/src/routes/platform.test.ts`. `FakeDb` has `eq neq in is not gt gte lt lte
   match order limit single maybeSingle upsert(onConflict)` and head counts; it embeds
   `customers(...)` and `merchants(business_name)` through the `<singular>_id` column. Anything
   else needs adding to the fake first.

## What changed from your draft, and why

- **`handoff` is not an inbox kind.** A handoff is the merchant's business; one Gemini outage would
  write a row per chat across every shop. The inbox carries the four things only founders act on:
  `invoice_claimed`, `plan_requested`, `whatsapp_attention`, `job_failed`.
- **Reads inside a shop are audited** (rule 3). The draft had no record of who looked at what.
- **The migration is not a precondition of the deploy** (rule 6).
- **One PR became five.** Your draft's PR A held a migration, four job wrappers, two route files
  and five pages; it is now F1 (Fazal) + U1 (you), and PR B is U2 + F2 + U3.
- **The sign-up env vars are retired after U3** (Fazal's ops item), so the panel is the only source.
- The title string in `layout.tsx` is currently `` `${PRODUCT_NAME} — Admin` `` with description
  `'Merchant admin portal'`; the manifest says `"Merchant portal"`. Your draft quoted them slightly
  differently; the fix is the same.

---

## U0 — `fix/merchant-dashboard-name`

Three files, one commit:
- `admin/app/layout.tsx` lines 33–34: title `` `${PRODUCT_NAME} — Merchant Dashboard` ``,
  description `'Merchant Dashboard'`.
- `admin/components/AppShell.tsx` line 87: `<span className="tag">Merchant Dashboard</span>`.
- `admin/public/manifest.json`: `"description": "Merchant Dashboard"`.

Before pushing: `grep -rn "Merchant admin\|Merchant portal\|— Admin" admin/app admin/components admin/public`
must return nothing. `AuthLayout.tsx` and the login page carry no such string; say so in the
CHANGELOG. `cd admin && npm run build` then `rm -rf .next`.

---

## U1 — `feat/platform-shop-detail`

Branch from `main` after F1 merges.

### 1. `backend/src/routes/platform-shops.ts` (new)

Own file, `app.addHook('preHandler', requirePlatformAdmin)`, registered in `server.ts` after
`platformRoutes`. A local helper:

```ts
async function shop(id: string) { return (await db.from('merchants').select('*').eq('id', id).maybeSingle()).data; }
```

Every route: `const m = await shop(id); if (!m) return reply.code(404).send({ error: { code: 'NOT_FOUND', message: 'merchant not found' } });`

| Route | Reads |
|---|---|
| `GET /api/v1/platform/merchants/:id` | In parallel: `merchant_users` (`id, email, name, role, is_active`); `bank_accounts` (`id, bank_name, account_title, is_default, is_active` — **never** `account_number`, `iban` or `branch`); `delivery_zones` (`id, area_name, city, charge, is_serviceable, eta_text`); `getSubscription(db, id)`, `conversationsThisMonth(db, id)` from `lib/billing.ts`; `getUsage(db, id)` from `lib/usage.ts`; `computeReadiness(db, id)` from `lib/readiness.ts`; `getConnectionStatus(db, id)` from `whatsapp/connect.ts`; `invoices` (`id, plan, period_start, period_end, amount_paisa, status, reference, claimed_at, paid_at, created_at`) order `period_start` desc limit 12. Then `botMode(m, sub, convs)`. Payload: `{ merchant: { id, business_name, owner_name, email, phone, address, category, logo_url, status, plan, created_at, business_hours, bot_persona, negotiation_defaults, settings }, members, bankAccounts, zones, subscription, invoices, usage, conversationsThisMonth, botMode, readiness, connection }`. Then the audit row (rule 3, entity `merchant`). |
| `GET …/:id/orders` | The select of `GET /admin/orders` (`routes/admin.ts` line 112): `id, order_number, status, payment_method, payment_status, total, delivery_name, delivery_area, created_at`, `eq('merchant_id', id)`, `not('order_number', 'is', null)`, newest first, limit 100; optional `?status=` and `?payment=` as there. |
| `GET …/:id/conversations` | The select of the admin list (line 172) including `customers(name, wa_id, wa_opt_in_status, is_blocked)`, `eq('merchant_id', id)`, `neq('status', 'closed')`, order `last_message_at` desc, limit 50. |
| `GET …/:id/conversations/:cid` | `conversations` select `id, status, current_state, window_expires_at, unread_count, customers(name, wa_id, wa_opt_in_status, is_blocked)` with `match({ id: cid, merchant_id: id })` → 404; `messages` select `direction, sender, type, body, status, created_at`, `eq('conversation_id', cid)`, newest 200, reversed (as line 182). **No** `unread_count` update. Then the audit row (entity `conversation`, `entity_id` cid). |
| `GET …/:id/products` | The manager column list of `GET /admin/products` (line 270, with `cost`), `eq('merchant_id', id)`, `is('deleted_at', null)`, order `created_at`; each row gets `thumbnailUrl: productImageUrl(cfg.SUPABASE_URL, images?.[0])` exactly as lines 273–276. |

Nothing here writes to any table but `audit_log`. The `merchants(business_name)` and
`customers(...)` embeds work in `FakeDb` because the foreign key is the singular name plus `_id`.

### 2. Admin pages

- `admin/app/platform/page.tsx`: the shop name cell becomes
  `<Link href={`/platform/shops/${m.id}`} className="strong">{m.businessName}</Link>`. Nothing else.
- `admin/app/platform/shops/[id]/page.tsx` (new): `AppShell`, `BackLink` to `/platform`,
  `PageHead` with the shop name and a `Pill` each for status, plan and `connection.status`.
  Cards, all from the one detail payload:
  - **Overview**: owner, email, phone (`.mono`), address, category, joined (`dt`), members (email,
    role, active pill).
  - **WhatsApp**: `connection.displayPhone`, `qualityRating`, `messagingTier`, `flagReason`,
    `message`, `lastTestAt`, templates with their status.
  - **Readiness**: the seven `readiness.steps` as pills (success / warning, with `reason` as a hint).
  - **Billing**: subscription status, plan, trial end or period end (`dt`), `botMode.mode` and
    `reason`, conversations this month vs the plan limit (`PLANS` is not in the admin bundle; send
    `limits.conversations` from the route using `PLANS[plan].conversations` as `routes/billing.ts`
    does), invoices table (`rs(amount_paisa)`, `dt`, status pill, reference `.mono`).
  - **Usage**: `usage.outbound` vs `usage.freeQuota`, `paidOutbound`, `estimatedCostPaisa` with `rs`,
    `llmCallsToday` vs `llmDailyCap`.
  - **Settings**: bot on/off, COD on/off, default delivery charge (`rs`), persona name and style,
    negotiation defaults, hours per day, zones table (`rs(charge)`), bank accounts (name, title,
    default pill; no numbers). `humanize()` for enum values.
  - Three lazy sections, each fetched on first expand with its own skeleton: **Orders**
    (`StatusPill`, `PaymentPill`, `rs(total)`, `.mono` order number), **Chats** (a row per
    conversation; expanding one fetches `…/conversations/:cid` and shows the messages read-only,
    inbound left, outbound right, `dt` under each), **Catalog** (`rs(price)`, `rs(cost)`, stock,
    active pill, thumbnail 32 px with `alt=""`).
  - A link "Audit trail for this shop" to `/platform/audit?merchantId=<id>`.
  - Every section's failed fetch shows the toast; nothing on this page can write.

### 3. Tests: `backend/src/routes/platform-shops.test.ts` (new)

Seed as in `platform.test.ts` plus: a `bank_accounts` row with `account_number '01234567890123'`,
two conversations (one for M1, one for M2) each with messages and `unread_count 3`, orders and
products for both shops, a deleted product (`deleted_at` set) for M1.

| Case | Expect |
|---|---|
| detail 200 | `readiness.steps` has seven keys, `connection.status`, `botMode.mode`, `invoices` array; `JSON.stringify(body)` does **not** contain `01234567890123`; one `audit_log` row `platform_view` / `merchant` / `entity_id M1` / `user_id user-fazal`. |
| unknown id | 404 on every route. |
| another shop's conversation under M1 | `GET …/M1/conversations/<M2's cid>` → 404. |
| chat read | 200, messages oldest-first, `unread_count` of that conversation still 3; one audit row `platform_view` / `conversation`. |
| orders, products | only M1's rows; the deleted product is absent; `cost` present. |
| owner JWT, staff JWT | 403 `PLATFORM_ONLY`; anonymous 401; pilot token 200 with audit `user_id null`. |

### 4. Docs and verify

CHANGELOG entry. CLAUDE.md "Platform console" gains: "`routes/platform-shops.ts` is read-only
(rule 2) and every read writes a `platform_view` audit row". Verification block at the end of this
file.

---

## U2 — `feat/platform-inbox`

Branch from `main` after F1 merges **and** Fazal has applied 0020 (the tests do not need the
table, the live triggers do).

### 1. `notifyPlatform()` in `backend/src/lib/notify.ts`

```ts
export type PlatformKind = 'invoice_claimed' | 'plan_requested' | 'whatsapp_attention' | 'job_failed';
export interface PlatformNotifyInput { kind: PlatformKind; merchantId?: string | null; title: string; body: string; data?: Record<string, unknown> }
export async function notifyPlatform(db: SupabaseClient, input: PlatformNotifyInput): Promise<string | null>
```

1. When `merchantId` is given, read `merchants.business_name` and prefix the title: `"Ali Store: Invoice claimed"`.
2. Insert the `platform_notifications` row (`kind, merchant_id, title, body, data`); on `.error`
   `logger.warn` and continue (rule 6). Resolve with the row id or null.
3. Background, added to `inflight` so `flushNotifications()` awaits it in tests: read
   `platform_admins` `select('email').eq('is_active', true).not('email', 'is', null)`; when any,
   call the existing private `emailMembers('platform', emails, title, body, '/platform/inbox')`.
   The literal key `'platform'` is a `Map` key like any merchant id, so the five-in-five-minutes
   digest and `flushPendingDigests()` on SIGTERM apply with no new code. Push is not used: push
   subscriptions belong to merchant members.
4. `notificationUrl()` is untouched; the link is always `/platform/inbox`.

### 2. The four triggers

| Kind | Where | Call |
|---|---|---|
| `invoice_claimed` | `routes/billing.ts` claim route, before the `return reply.send({ ok: true })` (line 46) | `notifyPlatform(db, { kind: 'invoice_claimed', merchantId: mid, title: 'Invoice claimed', body: `Reference ${reference}`, data: { invoiceId: id } })` |
| `plan_requested` | `routes/billing.ts` plan-request route, after the audit insert (line 57) | title `'Plan change requested'`, body `` `${currentPlan} → ${plan}` `` (read `plan` in the same update's `select('id, plan')`), data `{ plan, subscriptionId: data.id }` |
| `whatsapp_attention` | `whatsapp/credentials.ts` `markTokenInvalid()` after the merchant `notify` (line 128); `whatsapp/account-events.ts` in the two `patchNumbers` calls that set `flag_reason: 'policy'` (line 100) and `'token'` (line 106), one call per distinct `merchant_id` in `rows`; `whatsapp/templates.ts` `applyTemplateStatus()` inside the `for (const r of rows)` loop (line 154) for rejected / paused / disabled | title `'WhatsApp needs attention'`, body = the same `message` / reason the merchant got, data `{ phoneNumberId?, reason: 'token' \| 'policy' \| 'template', template?, status? }`. The quality flag (line 58) is **not** included: the merchant fixes that one, and it is noisy. |
| `job_failed` | `lib/job-runs.ts` failure branch (F1) | title `` `Job failed: ${job}` ``, body the error text, data `{ job }`, `merchantId` absent. **Suppression:** a module-level `Map<JobName, number>` of the last time each job was reported; report at most once per job per hour (the sweeper runs every minute; a DB outage would otherwise write 60 rows an hour). |

### 3. Routes, appended to `routes/platform-ops.ts`

| Route | Behaviour |
|---|---|
| `GET /api/v1/platform/inbox?count=1` | `select('id', { count: 'exact', head: true }).is('read_at', null)` → `{ unread }`. |
| `GET /api/v1/platform/inbox` | last 100 rows with `merchants(business_name)` (flattened to `businessName`), newest first → `{ notifications }`. |
| `POST /api/v1/platform/inbox/read {ids?: string[]}` | `update({ read_at: now }).is('read_at', null)`, plus `in('id', ids)` when given (≤ 100 ids) → `{ ok: true }`. |

### 4. Pages

- `admin/app/platform/inbox/page.tsx` (new): `AppShell`, `PageHead` "Inbox" with a "Mark all read"
  button, `PlatformTabs` (add Inbox between Shops and Audit). A list: unread rows `strong`, each
  showing `dt(created_at)`, the kind as a `Pill` (`invoice_claimed` info, `plan_requested` brand,
  `whatsapp_attention` warning, `job_failed` danger), title, body; a row with `merchant_id` links to
  `/platform/shops/<id>`, a `job_failed` row to `/platform/jobs`. After marking read, dispatch
  `window.dispatchEvent(new Event('platform-inbox'))`. `EmptyState` with the `Inbox` icon.
- `admin/components/AppShell.tsx`: when `platformAdmin`, poll `/api/v1/platform/inbox?count=1`
  every 30 s (same shape as the merchant badge effect at lines 54–62, listening for
  `'platform-inbox'`), and render the `.count` span on the Platform link like the Notifications
  link does (lines 110–112).

### 5. Tests

| File | Cases |
|---|---|
| `lib/notify.test.ts` (extend; it mocks `./email`) | `notifyPlatform` writes the row with the shop-name prefix and emails every active admin once; no email when no admin has an email; six calls in a row → five sends and one digest (as the merchant test does); a `db` whose insert errors still resolves. |
| `routes/billing.test.ts` (extend) | claim and plan request each add one `platform_notifications` row with the right `kind` and `data`. |
| `whatsapp/credentials.test.ts` (extend) | a 190 adds a `whatsapp_attention` row. |
| `whatsapp/templates.test.ts` (extend) | a rejected template adds a `whatsapp_attention` row; an approved one adds nothing. |
| `lib/job-runs.test.ts` (extend) | a failure adds one `job_failed` row; a second failure of the same job within the hour adds none; a different job does. |
| `routes/platform-ops.test.ts` (extend) | count, list (newest first, `businessName`), mark all read, mark some by ids; owner 403. |

### 6. Docs and verify

CHANGELOG entry. CLAUDE.md: beside the `notify()` rule add "founders are told only through
`notifyPlatform()` (four kinds; email to every active platform admin; the merchant digest rule
applies under the key `'platform'`)".

---

## U3 — `feat/signup-gate-db`

Branch from `main` after F2 merges (the Access page and its tab exist).

### 1. `backend/src/lib/signup.ts`

`signupAllowed(email, cfg)` stays exactly as it is (its tests keep passing). Add:

```ts
export interface SignupGate { SIGNUP_OPEN: boolean; SIGNUP_ALLOWLIST: string; source: { open: 'db' | 'env'; allowlist: 'db' | 'env' } }
export async function signupGate(db: SupabaseClient): Promise<SignupGate>
export function _resetSignupGateCache(): void   // tests, and the PUT route
```

1. Read `platform_settings` `in('key', ['signup_open', 'signup_allowlist'])`. `signup_open` must be
   a boolean, `signup_allowlist` an array of strings; anything else (or no row, or an error) falls
   back to env for that key. `SIGNUP_ALLOWLIST` stays a comma-separated string so `signupAllowed`
   is unchanged.
2. Append every active `platform_admins.email` to the allow-list, so an invited admin can create
   their auth user and land on the existing 409 → `/platform` path.
3. Cache the result in-process for 60 seconds (`/api/v1/config` is public; one DB read per minute
   is plenty). The PUT route below clears the cache.

Call sites: `routes/signup.ts` `check` and `bootstrap` → `signupAllowed(email, await signupGate(db))`;
`routes/admin.ts` `/api/v1/config` → `signupOpen: (await signupGate(db)).SIGNUP_OPEN` (the `/signup`
page reads it, `admin/app/signup/page.tsx` line 23).

### 2. Routes, appended to `routes/platform-ops.ts`

| Route | Behaviour |
|---|---|
| `GET /api/v1/platform/signup` | `{ open, allowlist: string[], source }` from `signupGate` (the stored list only, without the admin emails that are appended at check time). |
| `PUT /api/v1/platform/signup {open, allowlist}` | Validate: `open` boolean; `allowlist` an array of ≤ 500 strings, each a valid email ≤ 254 chars, lowercased, trimmed, deduped. Two `upsert({ key, value, updated_at, updated_by: authUserId }, { onConflict: 'key' })`. Clear the cache. Audit: `merchant_id null, actor 'platform', action 'signup_settings_changed', entity 'platform_settings', diff { open, count }` — never the list itself (same rule as `/api/v1/config`). |

### 3. Component `admin/components/SignupSettings.tsx` (new), mounted in the Access page

At the slot F2 left (`{/* U3 mounts <SignupSettings /> here */}`). One card "Sign-up": a labelled
checkbox "Anyone may sign up", a labelled textarea "Allowed emails, one per line", a hint under each
saying "from the panel" or "still from Railway" by `source`, a Save button with the usual toast.
`PlatformTabs` is not touched (Access already exists).

### 4. Tests

| File | Cases |
|---|---|
| `lib/signup.test.ts` (new; `lib/auth.test.ts` already covers `signupAllowed`) | `signupGate`: no rows → env values and `source env`; a `signup_open` row overrides env; a malformed row falls back; admin emails are appended; the cache returns the same object within 60 s and `_resetSignupGateCache()` clears it. |
| `routes/platform-ops.test.ts` (extend) | `GET` reports env source → `PUT` → `GET` reports db source and the saved values; invalid email 400; 501 emails 400; owner 403; the audit row has `count`, not the list. |
| `lib/auth.test.ts` (extend) | with `SIGNUP_OPEN=false` in env and a `signup_open true` row, `POST /signup/check` answers `allowed true`; with the row removed and the cache reset, `allowed false` for a stranger; `GET /api/v1/config` `signupOpen` follows the row. |

### 5. Docs and verify

CHANGELOG entry. CLAUDE.md: in the sign-up paragraph, replace "Until `SIGNUP_OPEN=true` only emails
on `SIGNUP_ALLOWLIST` may join" with "sign-up is open or allow-listed from `/platform/access`
(`platform_settings`, cached 60 s); the two env vars are only a fallback". After this merges Fazal
copies the live values into the panel and removes the env vars (his ops item).

---

## Verification (every PR, in this order)

```bash
npm run build:shared && npm run typecheck
cd admin && npm run typecheck
npm run test -w @app/backend
npm run lint -w @app/admin
cd admin && npm run build && rm -rf .next
```

A visual check needs a signed-in session against the live backend, which we do not do from a local
portal (CLAUDE.md), so the route tests are the proof and `next build` plus lint check the pages. A
CHANGELOG entry per PR, with the hassles, is part of the PR.

## Skipped on purpose

Viewing payment screenshots or media from the panel (signed URLs; not needed to supervise),
hard-deleting admins, impersonating a merchant, any write inside a shop, `handoff` in the inbox,
a history of job runs (one row per job is a heartbeat; Sentry has the errors).
