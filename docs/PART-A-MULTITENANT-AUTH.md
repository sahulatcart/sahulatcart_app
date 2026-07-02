# Part A — Multi-Tenant Auth & RLS (Design & Rollout Plan)

Goal: turn the single-password pilot into a real multi-tenant app where **each merchant has
their own login** and can **only ever see/touch their own data** — without breaking the live
pilot, the WhatsApp bot, or the deployed portal.

> **Decisions (2026-07-03):** login = **email + password** (Supabase Auth). Signup = **invite-only** —
> only the platform admin (you) creates merchant accounts (no public signup page). JWT verification =
> Supabase `auth.getUser(token)` (offloads verification to Supabase; no JWT-secret/JWKS handling — a
> local-verify optimization is a later follow-up).

> **This is app-level multi-tenancy only.** Each merchant bringing their *own WhatsApp number*
> (Embedded Signup / Meta Tech Provider) is **Part B** — out of scope here. After Part A, new
> merchants can sign up, log in, and configure their shop; going *live on WhatsApp* still uses the
> manual number-connection path until Part B.

---

## 1. Current state (what we're changing)

| Area | Today (pilot) | After Part A |
|---|---|---|
| Login | One shared password (`ADMIN_API_TOKEN`) | Per-user **Supabase Auth** (email + password) |
| Merchant resolution | Backend picks the *one* merchant via `META_DEFAULT_PHONE_NUMBER_ID` | Derived from the **logged-in user** |
| Isolation | None (single tenant) | Backend scopes every query to the user's `merchant_id`; **RLS** as DB backstop |
| Accounts | None | `merchant_users` linked to Supabase `auth.users`; roles owner/manager/staff |
| Signup | None | "Create your shop" → new merchant + owner user |

**Already in place (no change needed):** `merchant_id` on every table, RLS policies (0002/0003/0004),
the auth-hook function, `merchant_users` + `platform_admins` tables, and — crucially — the **webhook
already routes by `phone_number_id → merchant`**, so the bot path is untouched by this work.

---

## 2. Design decisions

### 2.1 Auth mechanism: Supabase Auth (email/password)
- The **portal** authenticates with the Supabase JS client → receives a Supabase **JWT**.
- The portal sends that JWT to our backend as `Authorization: Bearer <jwt>`.
- Rationale: Supabase Auth is already our stack (DB + Storage + it). No new auth service. Password
  reset, sessions, etc. come free. (Magic-link is a trivial future add.)

### 2.2 Tenant scoping: backend derives `merchant_id` from the verified JWT (primary), RLS as backstop
- The backend **verifies** the Supabase JWT (signature), reads the user id (`sub`), and looks up
  `merchant_users` → `merchant_id` + `role`. **The backend never trusts a client-supplied
  merchant_id** — it always derives it from the verified token.
- Every admin endpoint is scoped to that `merchant_id`. This is the **primary** isolation.
- **RLS stays enabled** as a defense-in-depth backstop (protects against any accidental direct-DB or
  anon-key access). The bot/worker path keeps using the service role and stamping `merchant_id` from
  routing (unchanged).
- *Why backend-lookup instead of relying on the auth hook's claims:* it removes a hard dependency on a
  manual Supabase dashboard step and is trivially unit-testable. Enabling the Custom Access Token Hook
  (so JWTs carry `merchant_id` for direct-Supabase/RLS use) is a **recommended follow-up hardening**,
  not a blocker for Part A.

### 2.3 Dual-auth during transition (the safety valve)
The backend will accept **either**:
- **(a)** a Supabase user JWT (Bearer) → **merchant-scoped** (the new path), OR
- **(b)** the existing `ADMIN_API_TOKEN` (`x-admin-token`) → treated as **platform-admin** (sees the
  pilot/default merchant) — kept as a fallback so the pilot never goes dark and so we can roll back
  instantly by pointing the portal back at token auth.

The portal switches to Supabase Auth, but token auth remains available for platform-admin/emergency.
Token auth is removed only *after* the new path is proven in production.

### 2.4 Signup model
- **Self-serve signup:** "Create your shop" → creates `auth.users` (Supabase) + a `merchants` row +
  an owner `merchant_users` row, in one transaction (backend endpoint using the service role).
- New shops start with the bot **paused** and no WhatsApp number (they connect later — Part B / manual).
- Can be gated to invite-only later; not needed now.

---

## 3. Data model

Mostly reuse. Minor additions:
- `merchant_users` — already has `auth_user_id`, `role`, `is_active`. **No schema change** required.
- Possibly add `merchants.created_by` (audit) — optional.
- Confirm `auth.users` is the Supabase-managed table (it is). We link via `merchant_users.auth_user_id`.
- Migration to **backfill the pilot**: create a Supabase auth user for you (Farhan) and a
  `merchant_users` row linking it to the existing **Test Shop** merchant (so the pilot keeps working
  under the new auth). Done as a one-time script, reversible.

No destructive migrations. No table drops. No column removals.

---

## 4. Backend changes

1. **Config:** add `SUPABASE_JWT_SECRET` (to verify Supabase JWTs). *(Supabase provides this; already
   have URL + keys.)* Keep `ADMIN_API_TOKEN` for the fallback path.
2. **Auth middleware** (`requireMerchant`): 
   - If `Authorization: Bearer <jwt>` → verify signature + expiry → get `sub` → look up
     `merchant_users` (active) → attach `{ merchantId, role, userId }` to the request. Reject if no
     active membership.
   - Else if `x-admin-token === ADMIN_API_TOKEN` → attach platform-admin context (default merchant).
   - Else → 401.
3. **Refactor `routes/admin.ts`:** replace the single `merchantId(db)` resolver with
   `req.merchantId` from the middleware. Every query already filters by `merchant_id` — just source it
   from the request instead of the global. Enforce **role checks** (staff can't verify payments / see
   cost — already specified).
4. **Signup endpoint:** `POST /api/v1/auth/signup { email, password, businessName }` → create auth
   user (Supabase admin API) + merchant + owner membership; return session.
5. **`/session` / `/me`:** return the merchant + role for the logged-in user.
6. **No changes** to: webhook, orchestrator, order/payment services (they're service-role + routed by
   `phone_number_id`; they already stamp `merchant_id`). This is the key to not breaking the bot.

## 5. Frontend changes

1. Add `@supabase/supabase-js` to the portal; a Supabase client using the **anon key** +
   `NEXT_PUBLIC_SUPABASE_URL`.
2. **Login page:** email + password → `supabase.auth.signInWithPassword` → store the session; the API
   client sends the Supabase access token as `Authorization: Bearer`.
3. **Signup page:** "Create your shop" (email, password, business name) → backend signup → logged in.
4. `lib/api.ts`: attach the Supabase JWT; on 401, refresh the session or bounce to login. Keep the
   token fallback behind a flag during transition.
5. Everything else (dashboard, orders, catalog, inbox, analytics, settings, onboarding) is unchanged —
   they call the same endpoints, now merchant-scoped by the token.

## 6. Auth hook & RLS

- **RLS:** already enabled/written. Keep it. Add an automated test proving default-deny + cross-tenant
  deny (part of §8).
- **Custom Access Token Hook:** document the one-time dashboard enablement (Authentication → Hooks) as
  a **follow-up hardening** so JWTs carry `merchant_id`/`role` for any future direct-Supabase/RLS-scoped
  reads. Not required for Part A because the backend derives `merchant_id` server-side.

---

## 7. Migration plan (do NOT break the pilot)

Ordered, each step reversible:
1. Ship the backend with **dual auth** (JWT *or* token). Token path unchanged → pilot keeps working,
   zero downtime. Deploy + verify pilot still works.
2. Run the **backfill script**: create your Supabase auth user + `merchant_users` row for Test Shop.
3. Switch the **portal** to Supabase Auth (login/signup). The token path stays as a hidden fallback.
   Deploy the portal; log in with the new account; verify everything works.
4. Add a **second test merchant + user**; prove isolation (§8) in production with throwaway data.
5. Only after all green: **remove the token fallback** (separate, later commit) once we're confident.

Rollback at any step = revert the portal to token login (backend still accepts it).

## 8. Testing plan (before every deploy)

**Unit**
- JWT verify: valid / expired / wrong-signature / missing → correct accept/reject.
- Role gates: staff blocked from verify/reject + cost/margin fields.

**Integration (against live Supabase, throwaway data, auto-cleaned)**
- **Cross-tenant isolation (the critical one):** create merchant A + user A and merchant B + user B,
  each with an order. Assert user A's token returns **only** A's orders/products/settings and **cannot**
  read or mutate B's (GET returns nothing; POST verify on B's order → 403/404).
- **RLS default-deny:** a query with the anon key / no `merchant_id` claim returns **zero rows** and
  cannot insert (proves the DB backstop).
- **Signup:** creates auth user + merchant + owner membership; new merchant is isolated + bot paused.
- **Regression — pilot unbroken:** Test Shop login (new account) sees its existing orders; token
  fallback still works.
- **Regression — bot path unaffected:** run the existing orchestrator/order/payment integration tests
  (they must still pass unchanged — proves we didn't touch the WhatsApp path).

**Manual smoke (staging/prod)**
- Log in as the pilot account → dashboard/orders/inbox/catalog/settings all load and are scoped.
- Sign up a throwaway merchant → confirm it sees an empty shop, not the pilot's data.

**Gate:** no deploy unless all backend tests pass (`npm run test`) **and** the cross-tenant isolation
integration test passes.

## 9. Deployment plan

1. Backend first (dual auth) → verify pilot via token still works.
2. Backfill script (pilot user).
3. Portal (Supabase Auth) → verify login + scoping.
4. Isolation test in prod with throwaway merchant → clean up.
5. Later: retire token fallback.

New env vars: backend `SUPABASE_JWT_SECRET`; portal `NEXT_PUBLIC_SUPABASE_URL` +
`NEXT_PUBLIC_SUPABASE_ANON_KEY`. All additive — nothing removed.

## 10. Risks & mitigations

| Risk | Mitigation |
|---|---|
| Breaking the live pilot | Dual auth: token path unchanged until proven; instant rollback via portal login |
| Breaking the WhatsApp bot | We touch **only** the admin API + portal auth; bot path (webhook/orchestrator, service-role) is not modified; regression tests confirm |
| Cross-tenant data leak | `merchant_id` always derived from verified JWT, never client input; dedicated isolation test is a release gate; RLS backstop |
| Supabase Auth misconfig | Test JWT verify locally against a real Supabase-issued token before deploy |
| Signup abuse | Start low-volume; can gate to invite-only trivially |

## 11. Out of scope (later)
- Part B: Embedded Signup / merchants' own WhatsApp numbers.
- Billing / subscriptions.
- Team-management UI (invite staff) — schema/roles ready; UI later.
- Platform-admin console (cross-merchant) — token path covers us short-term.
- Enabling the Custom Access Token Hook (follow-up hardening).

## 12. Task breakdown (build order)
1. Backend: config `SUPABASE_JWT_SECRET`; `requireMerchant` dual-auth middleware; unit tests.
2. Backend: refactor `routes/admin.ts` to `req.merchantId`; role gates; keep behavior identical for token path.
3. Backend: signup + session endpoints.
4. Tests: cross-tenant isolation + RLS default-deny + signup + pilot regression + bot-path regression. **All green.**
5. Deploy backend (dual auth). Verify pilot via token.
6. Backfill pilot user (script).
7. Portal: Supabase client, login + signup, JWT in API client. Build + local test.
8. Deploy portal. Verify pilot login + scoping. Isolation smoke with throwaway merchant.
9. (Later) remove token fallback.
