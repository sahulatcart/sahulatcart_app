# Platform panel — Fazal's part

Plan of 14 October 2026, revised from Uzair's draft. Fazal owns the pieces that touch auth, the
database and the background jobs; Uzair's part is in [PLATFORM-PANEL-UZAIR.md](PLATFORM-PANEL-UZAIR.md).
Every file, column and function named below was checked against `main` at PR #36.

## The whole thing in one paragraph

The founders get a panel at `/platform` in the existing admin app, behind the existing
`requirePlatformAdmin()` gate. It gains: a Jobs tab (are the four background jobs running), an Audit
tab (a reader for `audit_log`), a read-only look inside any shop, a founders' inbox (invoice claimed,
plan requested, a WhatsApp number in trouble, a job failed) with email, an Access tab (invite a
platform admin by email, open or close sign-up, edit the allow-list), and the portal is renamed
"Merchant Dashboard". Nothing in the panel writes inside a shop. No new dependencies.

## Merge order (both developers)

| # | Branch | Who | Needs |
|---|---|---|---|
| 1 | `fix/p5-followups`, `fix/p4-followups` | Uzair | — (live bugs; before any panel work) |
| 2 | `fix/merchant-dashboard-name` | Uzair | — |
| 3 | `feat/platform-jobs-audit` (**F1**) | Fazal | — |
| 4 | `feat/platform-shop-detail` (**U1**) | Uzair | F1 merged (it adds to `PlatformTabs` and `platform/page.tsx`) |
| 5 | `feat/platform-inbox` (**U2**) | Uzair | F1 merged (tables, `job-runs.ts`) |
| 6 | `feat/platform-access` (**F2**) | Fazal | U2 merged (the Access page gets its tab after Inbox) |
| 7 | `feat/signup-gate-db` (**U3**) | Uzair | F2 merged (it mounts a card in the Access page) |

One migration for everything, **0020**, lands in F1 and is applied by Fazal right after F1 merges.
Each later PR rebases on `main` before opening; every PR touches `PlatformTabs.tsx`, so this is the
only way to avoid the conflict dance of 13 October.

## Ground rules (also in Uzair's file)

1. **Shop id from the URL only.** Platform routes read `:id` from `req.params`, never from
   `req.merchantCtx`. Every `:id` route starts with one `merchants` lookup and answers 404 when it
   finds nothing; child reads also match `merchant_id = :id` and answer 404, never 403.
2. **Look only.** Nothing under `/api/v1/platform/merchants/:id/*` writes to `orders`,
   `conversations`, `products`, `customers` or `merchants`, except the existing suspend, unsuspend
   and plan routes in `routes/platform.ts`. The chat reader never zeroes `unread_count`.
3. **Every look inside a shop is audited.** The shop-detail read and each chat read insert one
   `audit_log` row: `actor 'platform'`, `user_id` = `req.platformCtx.authUserId` (null for the pilot
   token), `action 'platform_view'`, `entity 'merchant'` or `'conversation'`, `entity_id` the row
   read, `merchant_id` the shop, `diff {}`. We are the processor for buyer data; this is the record.
4. **Merchants are told only through `notify()`**; founders only through `notifyPlatform()` (U2).
5. **New route groups are their own files** with `app.addHook('preHandler', requirePlatformAdmin)`,
   registered from `backend/src/server.ts` after `platformRoutes`.
6. **Deploy runs before the migration.** A merge to `main` deploys on its own; Fazal applies the
   migration by hand afterwards. Any code that touches a 0020 table must survive the table being
   absent for a few minutes: log at `warn`, keep going. Never assume the table exists at boot.
7. **A page file exports only the page.** Shared pieces go in `admin/components/`. Run
   `cd admin && npm run build` (then `rm -rf .next`) before pushing admin changes.
8. **House rules for pages:** lucide icons with `aria-hidden`, a `<label>` for every input,
   `aria-label` on icon-only buttons, `td.num` for money, `.mono` for ids, `toast(await apiError(r), 'error')`
   on any failed `api()` call, `apiJson()` for reads, `rs()` and `dt()` for money and time.
9. **Tests are the proof.** Route tests through `app.inject` over `FakeDb`, copying the boot and
   seed pattern of `backend/src/routes/platform.test.ts`. `FakeDb` has `eq neq in is not gt gte lt lte
   match order limit single maybeSingle upsert(onConflict)` and head counts; it embeds
   `merchants(business_name)` through `merchant_id`. Anything else needs adding to the fake first.

## What changed from Uzair's draft, and why

- **`handoff` is not an inbox kind.** A handoff is the merchant's business; one Gemini outage would
  write a row per chat across every shop. The inbox carries the four things only founders act on.
- **Reads inside a shop are audited** (rule 3). The draft had no record of who looked at what.
- **The migration is not a precondition of the deploy** (rule 6). The draft asked for 0020 before
  the backend deployed, which this repo cannot do.
- **Invite binding needs a confirmed email.** The draft bound an invited admin on any JWT whose
  email matched; now only when `email_confirmed_at` is set.
- **One PR became five**, each owned by one person, each merged before the next starts.
- **The sign-up env vars are retired** after U3, so the panel is the only source.

---

## F1 — `feat/platform-jobs-audit`

Branch from `main` after Uzair's follow-ups merge (or now; it touches none of their files except
`lib/jobs.ts`, where the change is the wrapper around `startUnpaidExpiryJob` only).

### 1. Migration `db/migrations/0020_platform_panel.sql`

```sql
-- 0020_platform_panel.sql — the founders' panel (docs/launch/PLATFORM-PANEL-*.md):
-- founders' inbox, job heartbeats, sign-up settings in the database, admins invited by email.

create table platform_notifications (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('invoice_claimed','plan_requested','whatsapp_attention','job_failed')),
  merchant_id uuid references merchants(id) on delete set null,
  title       text not null,
  body        text not null,
  data        jsonb not null default '{}'::jsonb,   -- ids and codes only: never message text, never buyer data
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index platform_notifications_unread on platform_notifications (created_at desc) where read_at is null;

-- One row per job, overwritten on every run. A heartbeat, not a history.
create table job_runs (
  job              text primary key,                -- replay_sweeper | retention | unpaid_expiry | billing
  interval_seconds integer not null,
  started_at       timestamptz not null,
  finished_at      timestamptz,
  ok               boolean,
  error            text,
  summary          jsonb not null default '{}'::jsonb
);

-- signup_open: true/false. signup_allowlist: a JSON array of lowercased emails.
create table platform_settings (
  key        text primary key,
  value      jsonb not null,
  updated_at timestamptz not null default now(),
  updated_by uuid
);

-- An admin invited by email has no auth user until their first confirmed login (F2).
alter table platform_admins alter column auth_user_id drop not null;
create unique index platform_admins_email on platform_admins (lower(email));

-- Browsers get no table access (0007 default privileges); the backend's service role does.
alter table platform_notifications enable row level security;
alter table job_runs enable row level security;
alter table platform_settings enable row level security;
grant select, insert, update, delete on platform_notifications, job_runs, platform_settings to service_role;
```

Notes that matter:
- No new SQL function, so no `revoke execute`.
- `platform_admins.auth_user_id` keeps its `unique` constraint; Postgres allows many nulls in it.
  The 0002 auth hook and the `platform_admins_self` policy both match on `auth_user_id`, so an
  invited row simply gets no claim until it is bound; nothing in the backend reads that claim
  (the backend decides with `platformAdminFor()`, not the JWT).
- The live table has one row with an email, so the unique index on `lower(email)` builds cleanly.

### 2. `backend/src/lib/job-runs.ts` (new)

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import { logger } from './logger';

export type JobName = 'replay_sweeper' | 'retention' | 'unpaid_expiry' | 'billing';
export type JobSummary = Record<string, number | string>;

/**
 * Heartbeat around one run of a background job: a job_runs row is upserted at the start
 * (finished_at null) and at the end (ok, error or summary). Never throws. A failure to write the
 * row is logged once per process per job and the job still runs — the row is for the Jobs tab,
 * it is not allowed to stop the work (and the table may not exist yet on the first deploy).
 */
export async function runJob(db: SupabaseClient, job: JobName, intervalSeconds: number, fn: () => Promise<JobSummary | void>): Promise<void>
```

Behaviour, exactly:
1. `upsert({ job, interval_seconds, started_at: now, finished_at: null, ok: null, error: null }, { onConflict: 'job' })`.
   If `.error`, `logger.warn` once per job (a module-level `Set<JobName>` of jobs already warned) and continue.
2. `await fn()` inside try/catch.
3. Success: `upsert({ job, interval_seconds, started_at, finished_at: now, ok: true, error: null, summary: result ?? {} })`.
   Failure: same with `ok: false`, `error: String(e).slice(0, 500)`, `summary: {}`, and
   `logger.error({ err, job }, 'job failed')`. U2 adds the inbox call here (see Uzair's file).
4. Return. The caller's `setInterval` is untouched.

Imports only `./logger` and the Supabase type, so `whatsapp/webhook.ts` can import it without a
cycle. The caller passes the client; the wrappers pass `getServiceClient()`.

### 3. Wrap the four jobs

| File | Function | Change |
|---|---|---|
| `backend/src/whatsapp/webhook.ts` | `startReplaySweeper()` (line 354) | `run` becomes `() => void runJob(getServiceClient(), 'replay_sweeper', 60, () => replayStuckMessages())`. `replayStuckMessages` returns void; summary `{}`. `drainWebhooks` keeps clearing `sweeper`. |
| `backend/src/lib/retention.ts` | `startRetentionJob()` | `purgeLogs` returns `{ webhook_events, messages_raw }` (the two counts it already has) instead of void; the wrapper runs both purges and returns `{ screenshots, webhook_events, messages_raw }`. Interval 3600. |
| `backend/src/lib/jobs.ts` | `startUnpaidExpiryJob()` | `runJob(getServiceClient(), 'unpaid_expiry', 3600, async () => ({ cancelled: (await expireUnpaidOrders(db)).length }))`. |
| `backend/src/lib/billing.ts` | `startBillingJob()` | `runJob(getServiceClient(), 'billing', 21600, async () => { const r = await runBillingJob(db); return { warned: r.warned.length, pastDue: r.pastDue.length, invoiced: r.invoiced.length }; })`. |

The existing `.catch(... 'x job failed')` lines go away; `runJob` logs the failure itself. The
`cfg.NODE_ENV === 'production'` guard in `index.ts` stays, so locally `job_runs` stays empty.

### 4. `backend/src/routes/platform-ops.ts` (new)

Own file, `app.addHook('preHandler', requirePlatformAdmin)`, registered in `server.ts` right after
`platformRoutes`. F1 adds two routes; U2, F2 and U3 append theirs to the same file, each at the end.

| Route | Behaviour |
|---|---|
| `GET /api/v1/platform/audit?merchantId=&action=&before=&limit=` | `audit_log` select `id, merchant_id, actor, user_id, action, entity, entity_id, diff, created_at, merchants(business_name)`; optional `eq('merchant_id')` and `eq('action')`; `lt('created_at', before)` when given (ISO string); `order('created_at', { ascending: false })`; `limit` clamped to 1–100, default 50. Returns `{ rows, nextBefore }` where `nextBefore` is the last row's `created_at` when the page is full, else `null`. Rows carry `businessName` (from the embed) and no `merchants` object. |
| `GET /api/v1/platform/jobs` | `job_runs` select `*` order by `job`. Returns `{ jobs }` as stored; the page computes overdue. |

### 5. Admin pages

- **`admin/components/PlatformTabs.tsx`** (new): `<nav aria-label="Platform sections">` of
  `next/link`s with class `btn sm` (active) / `btn sm ghost`, `aria-current="page"` on the active
  one, active = `pathname === href` for `/platform`, `pathname.startsWith(href)` for the rest.
  F1 ships three tabs: Shops `/platform`, Audit `/platform/audit`, Jobs `/platform/jobs`.
  U2 adds Inbox, F2 adds Access, in that order, each inserted before Audit.
- **`admin/app/platform/page.tsx`**: render `<PlatformTabs />` directly under `<PageHead>`.
  Nothing else changes in F1 (U1 turns the shop name into a link).
- **`admin/app/platform/jobs/page.tsx`** (new): `AppShell`, `PageHead` "Jobs", `PlatformTabs`,
  one table: job (`.mono`), every N (interval as "1 min / 1 h / 6 h"), last started (`dt`), last
  finished (`dt`), result, summary (`<code>` of the JSON). Result pill: `ok === true` → success
  "ok"; `ok === false` → danger "failed" with the error in a `.hint` under it; `finished_at` null
  and `now − started_at > 2 × interval` → danger "overdue"; `finished_at` null otherwise → info
  "running". When the list is empty: `EmptyState` saying jobs run only in production.
- **`admin/app/platform/audit/page.tsx`** (new): filters with labels (shop `<select>` filled from
  `/api/v1/platform/merchants`, action `<input>`), table (when `dt`, shop, actor, action through
  `humanize`, entity + `.mono` id, diff as `<code>`), "Load more" using `nextBefore`. Reads
  `?merchantId=` with `useSearchParams` **inside a `<Suspense>` boundary** (otherwise `next build`
  fails on the static page). Default action filter is empty, so `platform_view` rows from U1 show
  too; that is intended.
- **`admin/components/AppShell.tsx`** line 97: the Platform link's label "All shops" becomes
  "Platform console". Its active test already uses `pathname.startsWith('/platform')`.

### 6. Tests

| File | Cases |
|---|---|
| `backend/src/lib/job-runs.test.ts` (new, over `FakeDb`) | success: one `job_runs` row with `ok true`, `finished_at` set, the summary; a throwing `fn`: `ok false`, `error` text, `runJob` resolves; a client whose `upsert` returns `{ error }` (a small stub): `fn` still runs and `runJob` resolves; a second run overwrites the same row (one row, not two). |
| `backend/src/routes/platform-ops.test.ts` (new, boot and `USERS` copied from `platform.test.ts`) | audit newest first; `merchantId` filter; `action` filter; `limit=2` returns `nextBefore`, and `before=<it>` returns the older rows; `limit=500` is clamped to 100; rows carry `businessName`; owner JWT 403, staff 403, anonymous 401; pilot token 200; jobs list returns the seeded rows. |
| `lib/retention.test.ts` (extend) | `purgeLogs` returns the two counts. |

### 7. Docs

CHANGELOG entry with the hassles. CLAUDE.md: a "Job heartbeats" line under "Inbound message
pipeline" (the four jobs write `job_runs`; the table may lag the deploy; the Jobs tab reads it), and
"Platform console" gains "Audit and Jobs tabs (`routes/platform-ops.ts`)".

### 8. Verify, merge, apply

```bash
npm run build:shared && npm run typecheck
cd admin && npm run typecheck
npm run test -w @app/backend
npm run lint -w @app/admin
cd admin && npm run build && rm -rf .next
```

After merge and the two deploys show SUCCESS:

```bash
npm run db:migrate
```

Then check `/api/v1/platform/jobs` with the pilot token: four rows within an hour (the sweeper's
within a minute). Record the apply and the row count in the CHANGELOG.

---

## F2 — `feat/platform-access`

Branch from `main` after U2 merges. Auth is the one place a mistake locks the founders out, so this
PR is reviewed alone and touches nothing else.

### 1. `backend/src/lib/auth.ts`

`platformAdminFor` gains two optional parameters:

```ts
export async function platformAdminFor(authUserId: string, email?: string | null, emailConfirmed = false): Promise<{ email: string | null } | null>
```

1. As today: `platform_admins` where `auth_user_id = authUserId` and `is_active` → return it.
2. Else, only when `email` is a string **and** `emailConfirmed` is true: look up
   `eq('email', email.trim().toLowerCase())`, `is('auth_user_id', null)`, `eq('is_active', true)`,
   `maybeSingle()`. If found, `update({ auth_user_id: authUserId, updated_at: now })` on that row
   `eq('id', row.id).is('auth_user_id', null)` (so two first logins cannot both bind), then return it.
3. Else null.

Callers: `jwtAuthn()` passes `data.user.email ?? null, !!data.user.email_confirmed_at`;
`routes/signup.ts` bootstrap passes `user.email, true` (`resolveAuthUser` already refused an
unconfirmed email). Emails are stored lowercased on insert (F2 route below), so the fake's exact
`eq` matches.

### 2. Routes, appended to `routes/platform-ops.ts`

| Route | Behaviour |
|---|---|
| `GET /api/v1/platform/admins` | `platform_admins` select `id, name, email, is_active, auth_user_id, created_at` order `created_at`. `auth_user_id` null means invited, not yet signed in. |
| `POST /api/v1/platform/admins {email, name?}` | Validate: email matches `/^\S+@\S+\.\S+$/`, ≤ 254 chars, lowercased and trimmed; name optional, ≤ 80. Existing row by `lower(email)` → `update({ is_active: true, name })` and 200 `{ reactivated: true }`; else insert `{ email, name, auth_user_id: null, is_active: true }`. Audit row: `merchant_id null, actor 'platform', user_id authUserId, action 'platform_admin_added', entity 'platform_admin', entity_id <row id>, diff { email }`. |
| `DELETE /api/v1/platform/admins/:id` | Soft: `update({ is_active: false })`. 404 unknown; 409 `self` when `row.auth_user_id === req.platformCtx.authUserId` (both non-null); 409 `last_admin` when the count of active rows ≤ 1. The pilot-token caller has `authUserId null`, passes the self check and is still stopped by `last_admin`. Audit `platform_admin_removed`. |

### 3. Page `admin/app/platform/access/page.tsx` (new) and the tab

`AppShell`, `PageHead` "Access", `PlatformTabs` (add Access after Inbox). One card "Platform
admins": table (name, email, state pill: success "signed in" when `auth_user_id`, info "invited"
otherwise, danger "inactive"), a Remove button per active row behind `confirm()`, and an add form
with labelled email and name inputs. All writes through `api()` with the usual toast on failure.
Leave a marked slot under the card:

```tsx
{/* U3 mounts <SignupSettings /> here */}
```

### 4. Tests

| File | Cases |
|---|---|
| `routes/platform-ops.test.ts` (extend) | add lowercases and returns the row; adding an inactive email reactivates it; remove self 409; remove the last active 409; remove another → `is_active false` plus the audit row; owner JWT 403 on all three. |
| `routes/platform.test.ts` (extend; add `email_confirmed_at` to the `USERS` rows, as `lib/auth.test.ts` does) | an invited admin's confirmed JWT reaches `/platform/me` and the row gains `auth_user_id`; the same email **unconfirmed** gets 403 `PLATFORM_ONLY` and the row stays unbound; `POST /signup/bootstrap` for an invited (confirmed) admin → 409 `PLATFORM_ADMIN` and no shop is created. |

### 5. Docs and verify

CLAUDE.md: replace "Adding a platform admin is a one-off SQL on `platform_admins` …" with "Platform
admins are invited by email from `/platform/access`; the row is bound to the auth user at the first
confirmed login (`platformAdminFor`)". CHANGELOG entry. Same verification block as F1. No migration.

---

## Fazal's ops items

- **After F1 merges:** apply 0020 (above).
- **After U3 merges:** open `/platform/access`, set the sign-up switch and paste the current
  allow-list (the Railway values) and save; confirm the page reports `source: db` for both. Then
  remove `SIGNUP_ALLOWLIST` and `SIGNUP_OPEN` from the `env` block of `@app/backend` in
  `.railway/railway.ts`, run `railway config apply`, then `railway config plan` to confirm nothing
  is still listed. `config.ts` keeps both vars as the fallback (defaults: closed, empty), so an empty
  `platform_settings` can only close sign-up, never open it. Record the date in the CHANGELOG.
- **Still open from before** (unchanged): Resend SMTP and the two redirect URLs in Supabase Auth,
  Sentry DSNs, `PLAN_*_PRICE_PAISA` and `PLATFORM_BANK_DETAILS` on Railway, the pilot attestation
  back-fill, the Meta paperwork for M7.
