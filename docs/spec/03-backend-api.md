# 03 — Backend API

The full backend surface for Sahulatcart: the REST API consumed by the Next.js admin portal, the
internal services that run the bot, the webhook endpoints Meta calls, and the realtime channels the
portal subscribes to.

- Data model / table & enum names: see [02-data-model.md](02-data-model.md) (canonical).
- Architecture / request flows: see [01-architecture.md](01-architecture.md).
- WhatsApp webhook & sending detail: see [04-whatsapp-integration.md](04-whatsapp-integration.md).
- Bot state machine / flows: see [05-bot-flows.md](05-bot-flows.md).
- Negotiation math: see [06-negotiation-engine.md](06-negotiation-engine.md).
- Payments & notifications flow: see [08-payments-notifications.md](08-payments-notifications.md).
- Security, config, deploy: see [09-nonfunctional-devops.md](09-nonfunctional-devops.md).

> All request/response JSON uses **camelCase** fields; DB tables/columns are `snake_case`. Money is
> always **integer paisa**. Enum values quoted below are the canonical values from doc 02 — do not
> change them.

---

## 1. API conventions

### 1.1 Base path & versioning
- All portal + internal HTTP endpoints live under **`/api/v1`**.
- The webhook lives under `/api/v1/webhook/whatsapp` (Meta-facing).
- Breaking changes bump to `/api/v2`; additive changes stay in `v1`.
- Health/liveness: `GET /healthz` (unversioned, no auth) → `{ "status": "ok" }`.
- Readiness: `GET /readyz` (unversioned, no auth) → `200` `{ "status": "ready", "checks": { "db": "ok", "redis": "ok" } }` when DB/Redis/queue deps are reachable, else `503`.

### 1.2 Authentication & authorization
Three distinct auth modes, distinguished by the caller:

| Caller | Mechanism | Header | Identity resolved |
|---|---|---|---|
| **Admin portal** (merchant users) | Supabase Auth JWT | `Authorization: Bearer <supabase_jwt>` | `sub` → `merchant_users.auth_user_id`; JWT custom claim `merchant_id` scopes the tenant; `role` claim mirrors `merchant_users.role` |
| **Platform admin** (us) | Supabase JWT with `platform_admin: true` claim | `Authorization: Bearer <jwt>` | cross-tenant; bypasses `merchant_id` scoping. Claim sourced from `platform_admins` by the auth hook (CD-1/CD-36), never client-supplied |
| **Internal service→service** (workers, jobs, bot) | HMAC service token | `Authorization: Bearer <service_token>` + `X-Sahulatcart-Signature: <hmac_sha256>` | uses a **restricted worker DB role** (not full service-role; CD-39) acting on behalf of a `merchant_id` passed explicitly |
| **Meta webhook** | Meta signature | `X-Hub-Signature-256: sha256=<hmac>` | verified against `META_APP_SECRET`; tenant resolved by `phone_number_id` |

> **Internal auth is HMAC-only (CD-27).** The service→service caller presents a bearer
> `service_token` **and** an `X-Sahulatcart-Signature: <hmac_sha256>` over the raw body, keyed on the
> shared `SERVICE_HMAC_SECRET` (doc 09, canonical env name). There is **no** `INTERNAL_API_KEY` — that name is
> retired to remove ambiguity. Signature comparison uses `timingSafeEqual` on decoded buffers with a
> length check (CD-44).

- **JWT `merchant_id` claim** is injected by a Supabase Auth hook (or minted at login from
  `merchant_users`). RLS (`merchant_id = auth.jwt() ->> 'merchant_id'`, see doc 02) enforces tenant
  isolation at the DB layer; the API layer additionally checks **role** for privileged actions.
- **Roles** (`user_role` enum): `owner` (full), `manager` (all except billing/team-destructive &
  merchant deletion), `staff` (orders + inbox + customers, read-only on settings/catalog).
- The API returns `401` for missing/invalid credentials, `403` for authenticated-but-unauthorized
  (wrong role or cross-tenant attempt).

**Role matrix (summary) — doc 09's strictest matrix is canonical (CD-37):**

| Capability group | owner | manager | staff |
|---|---|---|---|
| View dashboard/analytics | ✅ | ✅ | ✅ |
| Inbox: view, takeover/release, send | ✅ | ✅ | ✅ |
| Orders: view/edit/status | ✅ | ✅ | ✅ |
| **Payments: verify/reject** | ✅ | ✅ | ❌ |
| Payments: COD-collected (mark cash received) | ✅ | ✅ | ✅ |
| Products/categories CRUD & import | ✅ | ✅ | ❌ (read) |
| Read `cost` / margin / message `raw` | ✅ | ✅ | ❌ (stripped server-side) |
| Negotiation settings | ✅ | ✅ | ❌ |
| **Bank accounts (CRUD)** / delivery zones | ✅ | ✅ | ❌ |
| Templates / bot knowledge | ✅ | ✅ | ❌ (read) |
| WhatsApp number connect | ✅ | ❌ | ❌ |
| Team (merchant_users) manage | ✅ | ❌ | ❌ |
| Merchant profile / plan | ✅ | ❌ | ❌ |

> **Staff restrictions are enforced twice (CD-37):** (1) at the API route guard — `staff` receives
> `403 FORBIDDEN` on payment verify/reject and on any bank-account write; and (2) via **server-side
> field-stripping** — for `role='staff'`, the response serializer removes `products.cost`, any derived
> margin, and `messages.raw` before the payload leaves the server. Field-stripping is belt-and-braces
> on top of the doc 02 RLS/column policy.

### 1.3 Pagination
Cursor-first, offset-optional. List endpoints accept:
- `limit` (int, default `25`, max `100`)
- `cursor` (opaque, base64 of `{created_at,id}`) **or** `page` (1-based) + used with `limit`.

Response envelope for collections:
```json
{
  "data": [ /* items */ ],
  "pagination": {
    "limit": 25,
    "nextCursor": "eyJjIjoiMjAyNi0wNy0wMVQxMDowMDowMFoiLCJpIjoiLi4uIn0",
    "hasMore": true,
    "total": 214
  }
}
```
`total` is best-effort (may be omitted on very large tables for cost).

### 1.4 Filtering & sorting
- Filtering via typed query params per endpoint (e.g. `?status=confirmed&paymentStatus=claimed`).
- Free-text search via `?q=` (server decides which columns).
- Date ranges via `?from=<ISO8601>&to=<ISO8601>` (inclusive, UTC).
- Sorting via `?sort=<field>&order=asc|desc` (default `sort=createdAt&order=desc`). Allowed sort
  fields are whitelisted per endpoint.

### 1.5 Standard error envelope
Every non-2xx response uses:
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Human-readable summary in English.",
    "details": [
      { "field": "price", "issue": "must be a positive integer (paisa)" }
    ],
    "requestId": "req_01J8..."
  }
}
```
- `code` — stable machine string (`SCREAMING_SNAKE`). Canonical codes:
  `VALIDATION_ERROR`, `UNAUTHENTICATED`, `FORBIDDEN`, `NOT_FOUND`, `CONFLICT`,
  `IDEMPOTENCY_CONFLICT`, `RATE_LIMITED`, `INVALID_STATE_TRANSITION`, `WINDOW_CLOSED`,
  `TEMPLATE_NOT_APPROVED`, `UPSTREAM_ERROR` (Meta/Claude/Supabase), `PAYLOAD_TOO_LARGE`,
  `UNSUPPORTED_MEDIA_TYPE`, `INTERNAL_ERROR`.
- `details` — array, optional; field-level validation issues.
- `requestId` — echoes `X-Request-Id` (generated if not supplied) for log correlation.

### 1.6 Status codes
`200` OK · `201` Created · `202` Accepted (async, e.g. CSV import & template submit) ·
`204` No Content · `400` validation · `401` unauthenticated · `403` forbidden ·
`404` not found · `409` conflict / bad state transition / idempotency conflict ·
`413` payload too large · `415` unsupported media type · `422` semantically invalid ·
`429` rate limited · `502/503` upstream (Meta/Claude) failure · `500` internal.

### 1.7 Idempotency
- Mutating POSTs that create resources or trigger side-effects (orders, payments verify, send
  message, template submit, CSV import) accept **`Idempotency-Key: <uuid>`**.
- The server stores `(merchant_id, idempotency_key) → response` for **24h**. A repeat with the same
  key returns the original stored response (same status). A repeat key with a *different* body →
  `409 IDEMPOTENCY_CONFLICT`.
- The webhook is idempotent independently via `webhook_events.event_id` dedupe (doc 02).

### 1.8 Rate limiting
- Per-tenant + per-IP token bucket. Defaults: **600 req/min** per merchant for read, **120 req/min**
  for writes; send-message endpoint **60/min**; CSV import **5/min**.
- Exceeding → `429 RATE_LIMITED` with headers `Retry-After`, `X-RateLimit-Limit`,
  `X-RateLimit-Remaining`, `X-RateLimit-Reset`.
- Webhook endpoint is **not** rate-limited (Meta bursts); protected by signature verification only.

### 1.9 Common headers
Request: `Authorization`, `Idempotency-Key` (mutations), `X-Request-Id` (optional),
`Content-Type: application/json` (or `multipart/form-data` for uploads).
Response: `X-Request-Id`, `X-RateLimit-*`, `Content-Type`.

### 1.10 Conventions for object shapes
- IDs are UUID strings. Timestamps are ISO-8601 UTC strings (`2026-07-01T09:12:00Z`).
- Money fields are integers named `...Paisa`? **No** — for portal ergonomics money is returned as an
  integer field carrying paisa with the plain name (e.g. `price`, `total`, `subtotal`), and every
  money object includes a sibling `currency`. The value is **always paisa**; formatting to rupees is
  the client's job. (This matches doc 02 storing `int(paisa)`.)
- Nullable DB columns serialize as `null`, never omitted, unless in a sparse PATCH response.

---

## 2. REST endpoints by resource

Notation: **[owner]/[manager]/[staff]** = allowed roles. **[internal]** = service token only.
**[public]** = no auth (webhook verify / health).

### 2.1 Auth & session

| | |
|---|---|
| **`GET /api/v1/session`** | Current user + merchant context. Roles: any authenticated. |

Response:
```json
{
  "user": {
    "id": "0d2f...",
    "name": "Farhan Kazim",
    "email": "farhan.kazim1@gmail.com",
    "role": "owner",
    "isActive": true,
    "lastLoginAt": "2026-07-01T08:40:00Z"
  },
  "merchant": {
    "id": "a11c...",
    "businessName": "Farhan Fabrics",
    "status": "active",
    "plan": "pilot",
    "timezone": "Asia/Karachi",
    "currency": "PKR",
    "defaultLanguage": "roman_urdu"
  },
  "permissions": ["orders:write", "catalog:write", "team:manage"]
}
```

> **Login/logout/password reset** are handled directly by **Supabase Auth** (client SDK against
> Supabase, not this API). The backend only consumes the resulting JWT. `POST /api/v1/session/login`
> is **not** implemented; portal calls `supabase.auth.signInWithPassword`. After Supabase login the
> portal calls `GET /api/v1/session` to hydrate merchant context. See doc 09 for the auth-hook that
> injects the `merchant_id` claim.

| | |
|---|---|
| **`PATCH /api/v1/session/last-login`** | Stamps `merchant_users.last_login_at = now()`. Called once after login. Roles: any authed. → `204`. |

### 2.2 Merchants & onboarding

| Method + path | Purpose | Roles |
|---|---|---|
| `GET /api/v1/merchant` | Get the caller's merchant (full profile incl. `botPersona`, `negotiationDefaults`, `businessHours`, `settings`). | any authed |
| `PATCH /api/v1/merchant` | Update profile / persona / defaults / hours / settings. | owner |
| `PATCH /api/v1/merchant/bot` | **Global bot kill-switch (CD-33):** toggle `merchants.settings.botEnabled`. Body `{ "botEnabled": false }`. When false, the orchestrator suppresses all autonomous replies (optional holding line). | owner, manager |
| `GET /api/v1/merchant/onboarding` | Onboarding checklist + completion state (derived). | owner, manager |
| `POST /api/v1/merchant/onboarding/complete` | Marks onboarding finished (sets `settings.onboardingCompletedAt`). | owner |
| `POST /api/v1/admin/merchants` | **[platform admin]** Create a new tenant (Path C: us onboarding a merchant). | platform_admin |
| `GET /api/v1/admin/merchants` | **[platform admin]** List all tenants. | platform_admin |
| `PATCH /api/v1/admin/merchants/:id` | **[platform admin]** Change `status` (`pending`→`active`→`suspended`) / `plan`. | platform_admin |
| `POST /api/v1/admin/whatsapp-numbers` | **[platform admin]** Register a Cloud API number for a tenant (Path C): stores `phoneNumberId`/`wabaId`, creates the `whatsapp_numbers` routing row. | platform_admin |
| `POST /api/v1/admin/whatsapp-numbers/:id/token` | **[platform admin]** Attach/rotate the number's access token + secret: encrypts into `whatsapp_secrets`, sets `access_token_ref`, `token_expires_at`. | platform_admin |
| `POST /api/v1/admin/whatsapp-numbers/:id/subscribe-webhook` | **[platform admin]** Subscribe the WABA to our webhook (Graph `subscribed_apps`) and confirm delivery. | platform_admin |

> **Bot kill-switch (CD-33).** `PATCH /api/v1/merchant/bot` (or the equivalent `settings.botEnabled`
> field on `PATCH /api/v1/merchant`) flips `merchants.settings.botEnabled`. The
> `ConversationOrchestrator` gate reads this flag first and suppresses autonomous replies when false;
> go-live sets it `true`.

> **Platform-admin number registration (CD-1/CD-26).** The three `/api/v1/admin/whatsapp-numbers*`
> endpoints are the Path-C registration flow run by us (platform admins), keyed on the
> `platform_admin` JWT claim. Raw tokens are never stored on `whatsapp_numbers` — they are encrypted
> into `whatsapp_secrets` (doc 02, CD-2) and referenced by `access_token_ref`. Graph-call detail:
> doc 04.

`PATCH /api/v1/merchant` request (all fields optional):
```json
{
  "businessName": "Farhan Fabrics",
  "ownerName": "Farhan Kazim",
  "phone": "+923001234567",
  "timezone": "Asia/Karachi",
  "defaultLanguage": "roman_urdu",
  "botPersona": { "name": "Sahil", "tone": "friendly", "greeting": "Assalamualaikum! Kaise madad karun?", "emojiLevel": "low" },
  "negotiationDefaults": { "maxDiscountPct": 15, "minMarginPct": 10, "concessionSteps": [5, 3, 2], "roundsMax": 4, "autoAcceptAtFloor": true },
  "businessHours": { "tz": "Asia/Karachi", "days": { "mon": ["09:00","21:00"] }, "offHoursReply": true },
  "settings": { "lowStockThreshold": 3 }
}
```
Onboarding checklist derived state:
```json
{
  "steps": [
    { "key": "profile", "label": "Business profile", "done": true },
    { "key": "whatsapp", "label": "Connect WhatsApp number", "done": true },
    { "key": "catalog", "label": "Add products", "done": false, "count": 0 },
    { "key": "bank", "label": "Add a bank account", "done": true },
    { "key": "delivery", "label": "Set delivery zones", "done": false },
    { "key": "negotiation", "label": "Set negotiation limits", "done": true },
    { "key": "templates", "label": "Approve a template", "done": false }
  ],
  "completed": false
}
```
Errors: `403 FORBIDDEN` (non-owner writing profile); `422` (bad `negotiationDefaults` shape — e.g.
`maxDiscountPct` > 100).

### 2.3 Team — merchant_users

| Method + path | Purpose | Roles |
|---|---|---|
| `GET /api/v1/team` | List merchant users. | owner, manager |
| `POST /api/v1/team/invite` | Invite a user (creates Supabase auth user via invite + `merchant_users` row). | owner |
| `GET /api/v1/team/:id` | Get one user. | owner, manager |
| `PATCH /api/v1/team/:id` | Change `name`/`role`/`isActive`. | owner |
| `DELETE /api/v1/team/:id` | Deactivate (soft: `isActive=false`; never hard-delete auth). | owner |

`POST /api/v1/team/invite` request:
```json
{ "name": "Ali Raza", "email": "ali@example.com", "role": "staff" }
```
Response `201`:
```json
{ "id": "77aa...", "name": "Ali Raza", "email": "ali@example.com", "role": "staff", "isActive": true, "inviteSent": true }
```
Errors: `409 CONFLICT` (email already a user for this merchant); `403` (non-owner); `422`
(invalid role). An owner cannot demote/deactivate the **last active owner** → `409 CONFLICT`
(`code: LAST_OWNER`).

### 2.4 WhatsApp numbers

| Method + path | Purpose | Roles |
|---|---|---|
| `GET /api/v1/whatsapp-numbers` | List the merchant's connected numbers. | any authed |
| `GET /api/v1/whatsapp-numbers/:id` | Detail incl. `qualityRating`, `messagingTier`, `status`, `verifiedNameStatus`. | any authed |
| `POST /api/v1/whatsapp-numbers` | **Path C:** register an existing Cloud API number (we supply `phoneNumberId`, `wabaId`, and a **secret ref** to the token — never the raw token). | owner |
| `PATCH /api/v1/whatsapp-numbers/:id` | Update `displayName`; toggle `status` to `disconnected`. | owner |
| `GET /api/v1/whatsapp-numbers/:id/status` | Live status probe: pings Graph API for quality/tier, updates row, returns fresh. | owner, manager |
| `GET /api/v1/whatsapp-numbers/:id/health` | Cached health snapshot (`status`, `qualityRating`, `messagingTier`, `flagReason`, `tokenExpiresAt`) without a live Graph call. | any authed |
| `POST /api/v1/whatsapp-numbers/:id/reconnect` | Re-establish the connection after a flag/token issue: re-subscribes the webhook, re-validates the token ref, clears `flag_reason` on success. | owner |
| `POST /api/v1/whatsapp-numbers/:id/webhook-test` | Sends a test template to the merchant's own number to confirm plumbing. | owner |

`POST /api/v1/whatsapp-numbers` request:
```json
{
  "displayName": "Farhan Fabrics Sales",
  "phoneE164": "+923001112222",
  "wabaId": "1029384756",
  "phoneNumberId": "109876543210987",
  "accessTokenRef": "secret://railway/WA_TOKEN_FARHAN"
}
```
Response `201`:
```json
{
  "id": "wn_01...",
  "displayName": "Farhan Fabrics Sales",
  "phoneE164": "+923001112222",
  "wabaId": "1029384756",
  "phoneNumberId": "109876543210987",
  "status": "connecting",
  "qualityRating": null,
  "messagingTier": null,
  "verifiedNameStatus": "pending"
}
```
`status` (`whatsapp_numbers.status` enum): `connecting`, `connected`, `flagged`, `disconnected`.
Errors: `409 CONFLICT` if `phoneNumberId` already registered (unique routing key, see doc 02);
`502 UPSTREAM_ERROR` if Graph probe fails. Full connect/routing detail is in doc 04.

### 2.5 Product categories

| Method + path | Purpose | Roles |
|---|---|---|
| `GET /api/v1/product-categories` | List (with product counts). Sortable by `sortOrder`. | any authed |
| `POST /api/v1/product-categories` | Create. | owner, manager |
| `PATCH /api/v1/product-categories/:id` | Rename / reorder (`sortOrder`). | owner, manager |
| `DELETE /api/v1/product-categories/:id` | Delete (products' `categoryId` set null). | owner, manager |

Request: `{ "name": "Lawn Suits", "sortOrder": 1 }`.

### 2.6 Products

| Method + path | Purpose | Roles |
|---|---|---|
| `GET /api/v1/products` | List/search. Filters: `q`, `categoryId`, `isActive`, `negotiable`, `inStock`, `lowStock`. Sort: `name`, `price`, `stock`, `createdAt`. | any authed |
| `GET /api/v1/products/:id` | Detail. | any authed |
| `POST /api/v1/products` | Create. | owner, manager |
| `PATCH /api/v1/products/:id` | Update any field (price, stock, negotiation overrides, images, `isActive`). | owner, manager |
| `DELETE /api/v1/products/:id` | Soft-delete (`isActive=false`); hard delete blocked if referenced by orders. | owner, manager |
| `POST /api/v1/products/:id/images` | Upload image (multipart) → Storage `product-images/{merchantId}/{productId}/{uuid}.jpg`; appends URL to `images[]`. | owner, manager |
| `DELETE /api/v1/products/:id/images` | Remove an image URL from `images[]` (body `{ "url": "..." }`). | owner, manager |
| `POST /api/v1/products/import` | **Async** CSV/Excel bulk import (multipart upload). Returns a job. | owner, manager |
| `GET /api/v1/products/import/:jobId` | Poll import job status. | owner, manager |
| `POST /api/v1/products/catalog-sync` | Trigger Meta catalog sync (pull `retailer_id` → `externalRef` matching). Async. | owner, manager |
| `GET /api/v1/products/catalog-sync/:jobId` | Poll sync job status. | owner, manager |

`POST /api/v1/products` request:
```json
{
  "name": "Lawn 3-Piece Embroidered",
  "sku": "LWN-3P-014",
  "categoryId": "cat_01...",
  "description": "Unstitched, premium lawn, printed dupatta.",
  "price": 480000,
  "cost": 300000,
  "currency": "PKR",
  "stock": 25,
  "trackStock": true,
  "isActive": true,
  "negotiable": true,
  "maxDiscountPct": 12,
  "minPrice": 420000,
  "externalRef": "LWN-3P-014",
  "attributes": { "color": "teal", "fabric": "lawn", "pieces": 3 }
}
```
Response `201`: the full product object (adds `id`, `images: []`, `createdAt`, `updatedAt`).
For `role='staff'`, `cost` and any derived margin are **stripped from every product response**
server-side (CD-37).
Validation: `price` positive int paisa; `maxDiscountPct` 0–100; `minPrice` ≤ `price`; `sku` unique
per merchant when set (`409 CONFLICT`). Note: `minPrice` (absolute floor) **wins over**
`maxDiscountPct` — this is enforced by the Negotiation Engine (doc 06), not this endpoint.

**CSV import** — `POST /api/v1/products/import` (multipart `file`, optional
`mapping` JSON for column mapping, optional `dryRun=true`):
- Stores file in `catalog-imports/` bucket, creates an import job, returns `202`:
```json
{ "jobId": "imp_01...", "status": "queued", "fileName": "products.csv" }
```
- `GET /api/v1/products/import/:jobId`:
```json
{
  "jobId": "imp_01...",
  "status": "completed",
  "totalRows": 120,
  "created": 108,
  "updated": 7,
  "skipped": 5,
  "errors": [
    { "row": 14, "field": "price", "message": "not a number" },
    { "row": 51, "field": "sku", "message": "duplicate in file" }
  ],
  "startedAt": "2026-07-01T09:00:00Z",
  "finishedAt": "2026-07-01T09:00:12Z"
}
```
Job `status`: `queued`, `processing`, `completed`, `failed`. Upsert key: `sku` (per merchant), else
`externalRef`, else new row.

> **Job durability (CD-3):** import & catalog-sync jobs are backed by the **`background_jobs`** table
> (doc 02): `id, merchant_id, type enum('product_import','catalog_sync'),
> status enum('queued','processing','completed','failed'), input jsonb, result jsonb, error, file_url,
> error_report_url, created_at, started_at, finished_at`. The `GET /products/import/:jobId` and
> `GET /products/catalog-sync/:jobId` poll endpoints read `background_jobs` by `id` (the `jobId`).
> Per-row counts/errors surface via `result`; a downloadable error report via `error_report_url`.

**Catalog sync** — `POST /api/v1/products/catalog-sync` body optional
`{ "wabaId": "...", "direction": "pull" }`; returns `202 { "jobId": "..." }`. Poll shape mirrors
import. Matches Meta catalog items by `retailer_id` ↔ `products.external_ref`. Detail of the Graph
calls: doc 04. See `CatalogSyncService` (§3.9).

### 2.7 Customers

| Method + path | Purpose | Roles |
|---|---|---|
| `GET /api/v1/customers` | List/search. Filters: `q` (name/`waId`), `city`, `area`, `tag`, `isBlocked`. Sort: `lastSeenAt`, `totalSpent`, `totalOrders`. | any authed |
| `GET /api/v1/customers/:id` | Detail incl. order history summary + open conversation ref. | any authed |
| `PATCH /api/v1/customers/:id` | Edit `name`, `address`, `area`, `city`, `notes`, `tags`. | owner, manager, staff |
| `POST /api/v1/customers/:id/block` | Set `isBlocked=true` (bot stops replying; inbound still stored). | owner, manager |
| `POST /api/v1/customers/:id/unblock` | Set `isBlocked=false`. | owner, manager |

Customer detail response:
```json
{
  "id": "cus_01...",
  "waId": "+923219998877",
  "name": "Sana",
  "address": "House 12, St 4",
  "area": "Gulberg",
  "city": "Lahore",
  "tags": ["repeat", "vip"],
  "notes": "Prefers COD.",
  "isBlocked": false,
  "totalOrders": 3,
  "totalSpent": 1440000,
  "firstSeenAt": "2026-05-02T11:00:00Z",
  "lastSeenAt": "2026-07-01T08:30:00Z",
  "activeConversationId": "con_01...",
  "recentOrders": [ { "id": "ord_01...", "orderNumber": "SK-1042", "status": "confirmed", "total": 480000 } ]
}
```

### 2.8 Conversations (inbox) & takeover

| Method + path | Purpose | Roles |
|---|---|---|
| `GET /api/v1/conversations` | Inbox list. Filters: `status` (`bot_active`/`human_takeover`/`closed`), `assignedUserId`, `unread=true`, `q`. Sort: `lastMessageAt`. | any authed |
| `GET /api/v1/conversations/:id` | Conversation detail incl. `currentState` (`bot_state`), `context`, customer, active negotiation, draft order. | any authed |
| `GET /api/v1/conversations/:id/messages` | Paginated message thread (asc/desc by `createdAt`). | any authed |
| `POST /api/v1/conversations/:id/takeover` | Merchant takes over: `status`→`human_takeover`, sets `assignedUserId`. Bot stops auto-replying. | any authed |
| `POST /api/v1/conversations/:id/release` | Hand back to bot: `status`→`bot_active`, clears `assignedUserId`. | any authed |
| `POST /api/v1/conversations/:id/close` | `status`→`closed`. | owner, manager |
| `POST /api/v1/conversations/:id/messages` | **Agent sends a message** (free-form within 24h window, or a template outside it). | any authed |
| `POST /api/v1/conversations/:id/read` | Mark read (`unreadCount=0`). | any authed |
| `POST /api/v1/conversations/:id/reset-state` | Force `currentState`→`greeting` & clear `context` (recover a stuck bot). | owner, manager |

**Send message** — `POST /api/v1/conversations/:id/messages`:
```json
{
  "type": "text",
  "body": "Ji bilkul, kal tak deliver ho jayega.",
  "mediaUrl": null,
  "templateName": null,
  "templateParams": null
}
```
- If conversation is `human_takeover` → sender recorded as `agent`.
- If `bot_active`, an agent send is allowed but flips to `human_takeover` first (implicit takeover).
- Outside the 24h window (`window_expires_at < now`), free-form `type: "text"` → `409 WINDOW_CLOSED`;
  caller must use `type: "template"` with an `approved` template, else `422 TEMPLATE_NOT_APPROVED`.
Response `201`: the created `messages` row:
```json
{
  "id": "msg_01...",
  "conversationId": "con_01...",
  "direction": "outbound",
  "sender": "agent",
  "type": "text",
  "body": "Ji bilkul, kal tak deliver ho jayega.",
  "status": "queued",
  "waMessageId": null,
  "createdAt": "2026-07-01T09:15:00Z"
}
```
`status` transitions `queued`→`sent`→`delivered`→`read` (or `failed`) via webhook status callbacks;
pushed over Realtime (§5). Errors: `403` (blocked customer), `409 WINDOW_CLOSED`,
`422 TEMPLATE_NOT_APPROVED`, `502 UPSTREAM_ERROR` (Meta send fail).

### 2.9 Messages

Messages are normally read via the conversation thread endpoint above. Direct helpers:

| Method + path | Purpose | Roles |
|---|---|---|
| `GET /api/v1/messages/:id` | Single message. `raw` payload (debug) is **stripped server-side for `staff`** — owner/manager only (CD-37). | any authed |
| `GET /api/v1/messages/:id/media` | Signed URL for message media (image/document/audio) from Storage. | any authed |
| `POST /api/v1/messages/:id/retry` | Re-send a `failed` outbound message. | owner, manager |

`GET /api/v1/messages/:id/media` → `{ "url": "https://...signed...", "expiresAt": "..." }`.

### 2.10 Negotiations (read-only)

Negotiations are **created and mutated only by the Negotiation Engine** (deterministic, doc 06). The
API exposes them read-only for portal visibility.

| Method + path | Purpose | Roles |
|---|---|---|
| `GET /api/v1/negotiations` | List. Filters: `status` (`ongoing`/`agreed`/`rejected`/`abandoned`), `productId`, `conversationId`, date range. | any authed |
| `GET /api/v1/negotiations/:id` | Detail: rounds, offers, floor, agreed price. | any authed |
| `GET /api/v1/conversations/:id/negotiations` | Negotiations within a conversation. | any authed |

Response:
```json
{
  "id": "neg_01...",
  "conversationId": "con_01...",
  "productId": "prod_01...",
  "quantity": 2,
  "listPrice": 480000,
  "floorPrice": 420000,
  "rounds": 3,
  "lastBotOffer": 450000,
  "lastCustomerOffer": 430000,
  "status": "ongoing",
  "agreedPrice": null,
  "createdAt": "2026-07-01T09:05:00Z"
}
```
> There is **no** write endpoint for negotiations by design (price-floor principle, doc 00/06). The
> engine writes via service role.

### 2.11 Orders

| Method + path | Purpose | Roles |
|---|---|---|
| `GET /api/v1/orders` | List. Filters: `status` (`order_status`), `paymentStatus` (`payment_status`), `paymentMethod`, `customerId`, `q` (order number), date range. Sort: `createdAt`, `placedAt`, `total`. | any authed |
| `GET /api/v1/orders/:id` | Detail incl. `items`, `payment`, `customer`, `statusHistory`. | any authed |
| `POST /api/v1/orders` | Create a manual order (agent-built) in `draft`. | owner, manager, staff |
| `PATCH /api/v1/orders/:id` | Edit delivery fields, notes, items (only while `draft`/`pending_confirmation`). | owner, manager, staff |
| `POST /api/v1/orders/:id/items` | Add a line item (draft/pending only). | owner, manager, staff |
| `PATCH /api/v1/orders/:id/items/:itemId` | Edit qty/discount (recomputes totals). | owner, manager, staff |
| `DELETE /api/v1/orders/:id/items/:itemId` | Remove a line item. | owner, manager, staff |
| `POST /api/v1/orders/:id/status` | Transition order status (see §4). | role varies by transition |
| `POST /api/v1/orders/:id/cancel` | Cancel with `cancelledReason`. | owner, manager |
| `POST /api/v1/orders/:id/slip` | (Re)generate the order slip PDF → Storage `order-slips/`. | owner, manager, staff |
| `GET /api/v1/orders/:id/slip` | Signed URL to download the current slip. | any authed |
| `POST /api/v1/orders/:id/slip/resend` | Re-send the existing slip to the buyer over WhatsApp (document message; regenerates if missing). | owner, manager, staff |

**Create order** `POST /api/v1/orders`:
```json
{
  "customerId": "cus_01...",
  "conversationId": "con_01...",
  "paymentMethod": "cod",
  "items": [
    { "productId": "prod_01...", "quantity": 2, "discount": 0 }
  ],
  "deliveryName": "Sana",
  "deliveryPhone": "+923219998877",
  "deliveryAddress": "House 12, St 4",
  "deliveryArea": "Gulberg",
  "deliveryCity": "Lahore",
  "notes": "Call before delivery"
}
```
Server computes `subtotal`, `discountTotal`, `deliveryCharge` (from `delivery_zones` by `area`+`city`),
`total`, snapshots `nameSnapshot`/`unitPrice` per item. `orderNumber` (`SK-####`, unique per merchant)
and `placedAt` are **assigned at `confirmed`, not at `draft`** (CD-15), so they are `null` on a freshly
created draft. Response `201` full order:
```json
{
  "id": "ord_01...",
  "orderNumber": null,
  "status": "draft",
  "paymentMethod": "cod",
  "paymentStatus": "cod_pending",
  "subtotal": 960000,
  "discountTotal": 0,
  "deliveryCharge": 20000,
  "total": 980000,
  "currency": "PKR",
  "deliveryCity": "Lahore",
  "items": [
    { "id": "oi_01...", "productId": "prod_01...", "nameSnapshot": "Lawn 3-Piece Embroidered", "unitPrice": 480000, "quantity": 2, "discount": 0, "lineTotal": 960000 }
  ],
  "placedAt": null,
  "createdAt": "2026-07-01T09:20:00Z"
}
```
Errors: `422` (no items, unknown product, out-of-stock when `trackStock`), `409 CONFLICT`
(order-number race — retried server-side), `409 INVALID_STATE_TRANSITION` (editing a non-draft
order).

**Slip** — `POST /api/v1/orders/:id/slip` → `202`/`200` `{ "slipUrl": "signed...", "generatedAt": "..." }`.
Generated by `SlipGenerator` (§3.8) → `order-slips/{merchantId}/{orderId}.pdf`. See doc 08.

### 2.12 Order items

Order items are managed through the order sub-routes in §2.11 (`/orders/:id/items...`). There is no
top-level `/order-items` collection. `PATCH`/`DELETE` recompute the parent order's `subtotal`,
`discountTotal`, `total` atomically and append no status-history row (item edits are not status
transitions). Line totals: `lineTotal = unitPrice * quantity - discount` (paisa).

### 2.13 Payments

One current-state `payments` row per order (`payments.order_id` unique, doc 02), backed by a
`payment_claims` history child (CD-4). Flow detail: doc 08.

| Method + path | Purpose | Roles |
|---|---|---|
| `GET /api/v1/orders/:id/payment` | Get the order's payment record. | any authed |
| `POST /api/v1/orders/:id/payment/send-bank-details` | Bot/agent sends bank account to buyer; sets `paymentMethod=bank_transfer`, `payment_status`→`unpaid`, records which `bankAccountId` was shown. | any authed / [internal] |
| `POST /api/v1/orders/:id/payment/claim` | Record a buyer's payment claim + screenshot (usually written by bot from inbound image; also manual). Sets `payment_status`→`claimed`, `claimedAt`. | any authed / [internal] |
| `POST /api/v1/orders/:id/payment/verify` | Merchant confirms the transfer is real. `payment_status`→`verified`, `orders.status` `awaiting_payment`→`paid` (via `PaymentService`); triggers buyer confirmation. | **owner, manager** |
| `POST /api/v1/orders/:id/payment/reject` | Reject a claim with `rejectionReason`; `payment_status`→`failed`; notifies buyer to re-send. | **owner, manager** |
| `POST /api/v1/orders/:id/payment/cod-collected` | COD cash received on delivery. `payment_status` `cod_pending`→`cod_collected` (uses `cod_collected_at`). | owner, manager, staff |

> **Payment verify/reject are `owner, manager` only (CD-37).** `staff` → `403 FORBIDDEN`.
> `cod-collected` remains available to staff (delivery ops), and never passes through
> `unpaid`/`claimed`/`verified`/`paid`.
>
> **`cod-mark-pending` is retired as a required transition (CD-17).** `payment_status='cod_pending'`
> is set **at COD selection** (payment-method selection), not at dispatch. An idempotent no-op
> `POST /api/v1/orders/:id/payment/cod-mark-pending` MAY be retained for reconciliation, but it must
> not be a required step in any flow.
>
> **Concurrency (CD-20):** verify / reject / claim run under per-conversation serialization plus a
> `SELECT … FOR UPDATE` on the `payments` row and a state guard. An attempt against a payment not in
> the required state (e.g. verifying a payment not `claimed`) returns `409 INVALID_STATE_TRANSITION`.
> Each verify/reject also appends a `payment_claims` history row (decided_at, decided_by_user_id;
> CD-4); `payments` stays the current-state pointer.

`payment_status` enum values used: `unpaid`, `claimed`, `verified`, `failed`, `cod_pending`,
`cod_collected`, `refunded`.

**Send bank details** request: `{ "bankAccountId": "bank_01..." }` (defaults to
`bank_accounts.is_default`). Response includes the account snapshot sent.

**Record claim** request:
```json
{ "screenshotUrl": "payment-screenshots/{merchantId}/{orderId}/{uuid}.jpg", "reference": "TXN-8842", "amount": 980000 }
```
(`screenshotUrl` typically produced by the bot after downloading the inbound WhatsApp image to
`payment-screenshots/`.) Each claim inserts a `payment_claims` row (full history, CD-4) and updates
the current-state `payments` pointer to `status: "claimed"`, `claimedAt`. Resent screenshots append
new `payment_claims` rows rather than overwriting.

**Verify** request (optional): `{ "reference": "TXN-8842" }`. Effects (via `PaymentService`, guarded
per CD-20):
- `payments.status`→`verified`, `verifiedAt=now`, `verifiedByUserId=<caller>`; the matching
  `payment_claims` row → `verified` (`decidedAt`, `decidedByUserId`).
- `orders.payment_status`→`verified`, `orders.status` `awaiting_payment`→`paid`.
- Emits `PaymentService.onVerified` → bot sends buyer a confirmation (free-form if window open, else
  template) and creates a confirmation notification (stores `orderId`/`paymentId` only — never a
  signed screenshot URL, CD-40).
Response `200`:
```json
{
  "id": "pay_01...",
  "orderId": "ord_01...",
  "method": "bank_transfer",
  "amount": 980000,
  "status": "verified",
  "bankAccountId": "bank_01...",
  "screenshotUrl": "payment-screenshots/...jpg",
  "claimedAt": "2026-07-01T09:22:00Z",
  "verifiedAt": "2026-07-01T09:30:00Z",
  "verifiedByUserId": "usr_01...",
  "reference": "TXN-8842"
}
```
Errors: `403 FORBIDDEN` (staff caller — verify/reject is owner/manager only, CD-37);
`409 INVALID_STATE_TRANSITION` (verifying a payment not in `claimed`, guarded by `SELECT … FOR UPDATE`);
`422` (amount mismatch beyond tolerance → still allowed but flagged in `details`);
`403` if COD order (verify not applicable). Reject request:
`{ "rejectionReason": "Screenshot blurry / amount short" }` → `status: "failed"`,
buyer notified to resend (window rules apply).

### 2.14 Bank accounts

| Method + path | Purpose | Roles |
|---|---|---|
| `GET /api/v1/bank-accounts` | List merchant's own accounts. | any authed |
| `POST /api/v1/bank-accounts` | Create. | owner, manager |
| `PATCH /api/v1/bank-accounts/:id` | Edit; toggle `isDefault`/`isActive`. | owner, manager |
| `DELETE /api/v1/bank-accounts/:id` | Soft-delete (`isActive=false`). | owner, manager |

Request:
```json
{
  "bankName": "Meezan Bank",
  "accountTitle": "Farhan Fabrics",
  "accountNumber": "01234567890123",
  "iban": "PK36MEZN0001234567890123",
  "branch": "Gulberg, Lahore",
  "isDefault": true,
  "isActive": true
}
```
Setting `isDefault=true` clears the flag on the merchant's other accounts (one default enforced).
Errors: `409 CONFLICT` if deleting the only active default while orders reference it (kept for audit).

### 2.15 Delivery zones

| Method + path | Purpose | Roles |
|---|---|---|
| `GET /api/v1/delivery-zones` | List. Filter `city`, `isServiceable`. | any authed |
| `POST /api/v1/delivery-zones` | Create. | owner, manager |
| `PATCH /api/v1/delivery-zones/:id` | Edit charge/eta/serviceable. | owner, manager |
| `DELETE /api/v1/delivery-zones/:id` | Delete. | owner, manager |
| `GET /api/v1/delivery-zones/lookup` | Resolve charge for `?area=&city=` (used at order build). | any authed / [internal] |

Request: `{ "areaName": "Gulberg", "city": "Lahore", "charge": 20000, "isServiceable": true, "etaText": "1-2 days" }`.
Lookup response: `{ "matched": true, "zone": { "id": "...", "charge": 20000, "etaText": "1-2 days", "isServiceable": true } }` or `{ "matched": false, "defaultCharge": 25000 }`.

### 2.16 Message templates

| Method + path | Purpose | Roles |
|---|---|---|
| `GET /api/v1/message-templates` | List. Filter `status`, `category`, `language`. | any authed |
| `GET /api/v1/message-templates/:id` | Detail incl. `bodyJson` components + `waTemplateId`. | any authed |
| `POST /api/v1/message-templates` | Create a `draft` template. | owner, manager |
| `PATCH /api/v1/message-templates/:id` | Edit while `draft`/`rejected`. | owner, manager |
| `DELETE /api/v1/message-templates/:id` | Delete a `draft`/`disabled` template. | owner, manager |
| `POST /api/v1/message-templates/:id/submit` | Submit to Meta for approval (async). `status`→`pending`. | owner, manager |
| `GET /api/v1/message-templates/:id/status` | Refresh status from Meta (`pending`→`approved`/`rejected`/`paused`). | owner, manager |

`category` enum: `utility`, `marketing`, `authentication`. `status` enum: `draft`, `pending`,
`approved`, `rejected`, `paused`, `disabled`.
Create request:
```json
{
  "name": "order_confirmation",
  "category": "utility",
  "language": "ur",
  "bodyJson": {
    "components": [
      { "type": "BODY", "text": "Assalamualaikum {{1}}, apka order {{2}} confirm ho gaya. Total: Rs. {{3}}." }
    ]
  }
}
```
Submit → `202 { "id": "...", "status": "pending", "submittedAt": "..." }`. On Meta rejection,
`rejection_reason` is populated and status is `rejected`. Meta detail: doc 04.

### 2.17 Bot knowledge (bot training / FAQ)

| Method + path | Purpose | Roles |
|---|---|---|
| `GET /api/v1/bot-knowledge` | List. Filter `type`, `isActive`, `q`. | any authed |
| `POST /api/v1/bot-knowledge` | Create an entry. | owner, manager |
| `PATCH /api/v1/bot-knowledge/:id` | Edit. | owner, manager |
| `DELETE /api/v1/bot-knowledge/:id` | Delete. | owner, manager |

`type` enum: `faq`, `business_info`, `policy`, `shipping`, `custom`.
Request:
```json
{ "type": "shipping", "question": "Delivery time kitna hai?", "answer": "Lahore mein 1-2 din, baqi Pakistan 3-5 din.", "isActive": true }
```
`embedding` is populated later by a background job (optional retrieval); not set via API.

### 2.18 Negotiation settings

Negotiation defaults are stored on `merchants.negotiation_defaults` (jsonb); per-product overrides
are `products.max_discount_pct` / `products.min_price` / `products.negotiable`. This resource is a
convenience view over those.

| Method + path | Purpose | Roles |
|---|---|---|
| `GET /api/v1/negotiation-settings` | Get merchant defaults (`negotiationDefaults`). | any authed |
| `PATCH /api/v1/negotiation-settings` | Update merchant defaults (writes `merchants.negotiation_defaults`). | owner, manager |
| `GET /api/v1/negotiation-settings/products/:productId` | Effective per-product settings (resolved: product override → merchant default). | any authed |
| `PATCH /api/v1/negotiation-settings/products/:productId` | Set per-product `negotiable`, `maxDiscountPct`, `minPrice` (writes `products`). | owner, manager |

Merchant defaults shape (matches `merchants.negotiation_defaults`, doc 02):
```json
{ "maxDiscountPct": 15, "minMarginPct": 10, "concessionSteps": [5, 3, 2], "roundsMax": 4, "autoAcceptAtFloor": true }
```
Effective per-product response:
```json
{
  "productId": "prod_01...",
  "negotiable": true,
  "source": { "maxDiscountPct": "product", "minPrice": "product", "concessionSteps": "merchant" },
  "effective": { "listPrice": 480000, "maxDiscountPct": 12, "minPrice": 420000, "floorPrice": 420000, "concessionSteps": [5,3,2], "roundsMax": 4, "autoAcceptAtFloor": true }
}
```
Floor resolution (deterministic, doc 06): `minPrice` if set wins; else
`listPrice * (1 - maxDiscountPct/100)`; clamped by `minMarginPct` against `cost` if present.
Validation only — the engine, not this endpoint, applies the math.

### 2.19 Notifications

| Method + path | Purpose | Roles |
|---|---|---|
| `GET /api/v1/notifications` | List for the caller (merchant-wide + user-targeted). Filter `type`, `unread=true`. | any authed |
| `GET /api/v1/notifications/unread-count` | Badge count. | any authed |
| `POST /api/v1/notifications/:id/read` | Mark one read (`readAt=now`). | any authed |
| `POST /api/v1/notifications/read-all` | Mark all read. | any authed |

`type` enum: `new_order`, `payment_claim`, `takeover_request`, `bot_needs_help`, `low_stock`,
`template_status`, `system`. `channel` enum: `portal`, `whatsapp`, `email`.
Item:
```json
{
  "id": "ntf_01...",
  "type": "payment_claim",
  "title": "Payment claim on SK-1042",
  "body": "Sana submitted a bank transfer screenshot (Rs. 9,800).",
  "data": { "orderId": "ord_01...", "paymentId": "pay_01..." },
  "channel": "portal",
  "readAt": null,
  "createdAt": "2026-07-01T09:22:00Z"
}
```
Notifications are created by services (§3.6), not by portal writes. New ones arrive over Realtime (§5).

### 2.20 Analytics

| Method + path | Purpose | Roles |
|---|---|---|
| `GET /api/v1/dashboard/summary` | Home-dashboard headline tiles (today/period KPIs, open claims, low stock). Consumed by doc 07 dashboard. | any authed |
| `GET /api/v1/analytics/summary` | Headline analytics KPIs for a date range (canonical name; alias of former `/analytics/dashboard`). | any authed |
| `GET /api/v1/analytics/timeseries` | Bucketed time series (`series[]` of `{ bucket, orders, revenue, collected }`; canonical name for the former `/analytics/sales` series). | any authed |
| `GET /api/v1/analytics/top-products` | Top products by units/revenue for the range. | any authed |
| `GET /api/v1/analytics/negotiations` | Negotiation performance stats. | owner, manager |

> **Naming reconciliation (CD-26).** Doc 07 references `GET /dashboard/summary`,
> `GET /analytics/summary`, `GET /analytics/timeseries`, `GET /analytics/top-products` — these are the
> **canonical** analytics endpoints. The earlier `GET /analytics/dashboard` (→ `analytics/summary`) and
> `GET /analytics/sales` (→ `analytics/timeseries` + breakdowns) are retained as **deprecated aliases**
> returning the same shapes for one release; new callers use the canonical names. `analytics/summary`
> returns the `dashboard`-shaped payload below; `analytics/top-products` returns its `topProducts[]`.

Common query: `?from=&to=` (default last 30 days), `?granularity=day|week|month`.

`GET /api/v1/analytics/summary` (and deprecated alias `GET /api/v1/analytics/dashboard`) response:
```json
{
  "range": { "from": "2026-06-01T00:00:00Z", "to": "2026-07-01T00:00:00Z" },
  "orders": { "total": 84, "confirmed": 61, "cancelled": 9, "delivered": 44 },
  "revenue": { "gross": 24800000, "collected": 19200000, "currency": "PKR" },
  "aov": 295238,
  "conversations": { "total": 210, "botHandled": 176, "takenOver": 34 },
  "payments": { "cod": 40, "bankVerified": 21, "pendingClaims": 3 },
  "topProducts": [ { "productId": "prod_01...", "name": "Lawn 3-Piece", "unitsSold": 52, "revenue": 12480000 } ],
  "lowStock": [ { "productId": "prod_02...", "name": "Cotton Kurta", "stock": 2 } ]
}
```
`GET /api/v1/analytics/negotiations` response:
```json
{
  "totalNegotiations": 118,
  "agreed": 71,
  "rejected": 22,
  "abandoned": 25,
  "avgRounds": 2.4,
  "avgDiscountPct": 8.7,
  "avgDiscountPaisa": 41700,
  "floorHitRate": 0.19,
  "byProduct": [ { "productId": "prod_01...", "agreed": 40, "avgDiscountPct": 7.5 } ]
}
```
`GET /api/v1/analytics/timeseries` (and deprecated alias `GET /api/v1/analytics/sales`) returns a
`series` array of `{ bucket, orders, revenue, collected }` plus `byCity`, `byPaymentMethod`,
`byStatus` breakdowns. `GET /api/v1/analytics/top-products` returns `{ topProducts: [ { productId,
name, unitsSold, revenue } ] }`. `GET /api/v1/dashboard/summary` returns the home tiles
(`orders`, `revenue`, `openClaims`, `lowStock`). All money in paisa.

### 2.21 Webhook (Meta) — summary

Full detail in **[04-whatsapp-integration.md](04-whatsapp-integration.md)**. Two routes:

| Method + path | Purpose | Auth |
|---|---|---|
| `GET /api/v1/webhook/whatsapp` | Meta verification handshake. Echoes `hub.challenge` when `hub.verify_token` matches `META_WEBHOOK_VERIFY_TOKEN`. | [public] token check |
| `POST /api/v1/webhook/whatsapp` | Receives inbound messages + status callbacks. | Meta `X-Hub-Signature-256` |

**GET** query params: `hub.mode=subscribe`, `hub.verify_token`, `hub.challenge`. On match against
`META_WEBHOOK_VERIFY_TOKEN` (canonical env name, CD-27) → `200` with the raw `hub.challenge` string;
on mismatch → `403`.

**POST** flow (must ACK `200` within ~5s, see doc 01/04):
1. Verify `X-Hub-Signature-256` (HMAC-SHA256 of raw body with `META_APP_SECRET`) → else `401`.
2. Dedupe on `webhook_events.event_id` (unique). Duplicate → `200` no-op.
3. Persist raw payload to `webhook_events`; extract messages/statuses.
4. Route to tenant via `phone_number_id → whatsapp_numbers → merchant_id`. Unknown id → `200`
   (logged, dropped).
5. Enqueue per-conversation work (`ConversationOrchestrator`); update `messages.status` on status
   callbacks. Return `200` immediately.

Never blocks on Claude/Graph inside the request — all heavy work is queued (doc 01 §Key flows).

---

## 3. Internal service interfaces (non-HTTP)

These are TypeScript service classes in `backend/` (see doc 01 repo layout). They run under the
Supabase **service role** (bypass RLS) and always take an explicit `merchantId`. Signatures are
indicative.

### 3.1 ConversationOrchestrator
The state machine that drives every inbound message. Owns `bot_state` transitions (doc 05).

- `handleInbound(input: { merchantId, whatsappNumberId, waMessage }): Promise<void>`
  - Loads/creates `customers` + `conversations`; refreshes `window_expires_at`; persists inbound
    `messages` row. Runs under strict per-conversation serialization (one in-flight worker per
    `conversation_id`) + `pg_advisory_xact_lock(hashtext(conversation_id))` around the context
    read-modify-write (CD-20).
  - **Kill-switch gate (CD-33):** if `merchants.settings.botEnabled = false`, suppress the
    autonomous reply (optional holding line only).
  - If `conversations.status = human_takeover` or `customers.is_blocked` → store only, optionally
    notify; **no** bot reply. Inbound during `human_takeover` short-circuits BEFORE state routing —
    a screenshot is stored but NOT auto-claimed (CD-19).
  - Calls `ClaudeClient.classify` for intent + entities (intent enum per doc 05 §2.1; `handoff` is a
    routing outcome, not an intent — CD-25); routes per `current_state` to Q&A / `NegotiationEngine` /
    `OrderService` / `PaymentService`.
  - Calls `ClaudeClient.compose` to phrase the deterministic decision in Roman Urdu; sends via
    `WhatsAppSender`.
  - Updates `conversations.current_state` + `context`; may emit notifications
    (`bot_needs_help`, `takeover_request`).
- `applyStatusCallback(waMessageId, status): Promise<void>` — updates `messages.status`.
- **Tables touched:** `conversations`, `messages`, `customers`, `negotiations` (via engine),
  `orders`/`order_items` (via order service), `notifications`.

### 3.2 NegotiationEngine (deterministic — no LLM)
Reference **[06-negotiation-engine.md](06-negotiation-engine.md)** for the full math.

- `computeFloor(product, merchantDefaults): { floorPrice, source }` — `minPrice` wins, else
  pct-based, clamped by `minMarginPct` vs `cost`.
- `evaluateOffer(input: { negotiation, customerOfferPaisa, quantity }): NegotiationDecision`
  where `NegotiationDecision = { action: 'accept'|'counter'|'reject'|'hold', counterOfferPaisa?, agreedPricePaisa?, reason }`.
- `openNegotiation({ merchantId, conversationId, productId, quantity, listPrice, floorPrice })` → creates `negotiations` row (`status: 'ongoing'`).
- `recordRound(negotiationId, botOffer, customerOffer)` → increments `rounds`, updates
  `last_bot_offer`/`last_customer_offer`.
- `settle(negotiationId, outcome)` → sets `status` to `agreed`/`rejected`/`abandoned`, `agreed_price`.
- **Tables touched:** `negotiations`, reads `products`, `merchants.negotiation_defaults`.
- **Guarantee:** never returns a price below `floorPrice`; `autoAcceptAtFloor` and `roundsMax`
  govern acceptance. The LLM sees only the *phrasing brief*, never sets prices.

### 3.3 OrderService

- `buildDraft({ merchantId, customerId, conversationId }) → order` — creates `orders` (`status:'draft'`).
- `addItem(orderId, { productId, quantity, discount }) → order` — snapshots `nameSnapshot`,
  `unitPrice`; recomputes totals; checks stock when `track_stock`.
- `applyNegotiatedPrice(orderId, itemId, agreedPricePaisa)` — sets item discount from a settled
  negotiation.
- `setDelivery(orderId, deliveryFields)` — resolves `delivery_charge` via `delivery_zones`.
- `confirm(orderId, actor) → order` — `draft/pending_confirmation`→`confirmed`, assigns
  `order_number`, sets `placed_at`, writes `order_status_history`, decrements stock, emits
  `new_order` notification.
- `transition(orderId, toStatus, actor)` — validates against §4 rules; writes `order_status_history`.
- `cancel(orderId, reason, actor)` — →`cancelled`, restores stock.
- `recomputeTotals(orderId)` — `subtotal`, `discount_total`, `delivery_charge`, `total`.
- **Tables touched:** `orders`, `order_items`, `order_status_history`, `products` (stock),
  `delivery_zones`, `notifications`.

### 3.4 PaymentService

- `sendBankDetails(orderId, bankAccountId?)` — sets `payment_method='bank_transfer'`, records shown
  `bank_account_id`, triggers `WhatsAppSender` to send account details.
- `recordClaim(orderId, { screenshotUrl, reference, amount })` — inserts a `payment_claims` row,
  updates the `payments` pointer to `status='claimed'`, `claimed_at`; emits `payment_claim`
  notification. Guarded by `SELECT … FOR UPDATE` + state guard (CD-20).
- `verify(orderId, userId, reference?)` — `payments.status='verified'`, matching `payment_claims`→
  `verified`, `orders.payment_status='verified'`, `orders.status` `awaiting_payment`→`paid`; triggers
  buyer confirmation. **owner/manager only.**
- `reject(orderId, userId, reason)` — `payments.status='failed'`, matching `payment_claims`→
  `rejected`; notifies buyer to resend. **owner/manager only.**
- `markCodPending(orderId)` — sets `cod_pending` **at COD selection** (CD-17), not dispatch;
  idempotent. `markCodCollected(orderId, userId)` — `cod_pending`→`cod_collected` (sets
  `cod_collected_at`, `cod_collected_by_user_id`).
- **Tables touched:** `payments`, `payment_claims`, `orders`, `bank_accounts` (read), `notifications`,
  `messages` (via sender). Detail & screenshot handling: doc 08.

### 3.5 WhatsAppSender
Wraps Meta Graph send API. See doc 04.

- `sendText(conversationId, body) → messageId` — free-form; requires open 24h window else throws
  `WindowClosedError`.
- `sendTemplate(conversationId, templateName, params) → messageId` — requires `approved` template.
- `sendMedia(conversationId, { type, mediaUrl, caption })`, `sendInteractive(conversationId, payload)`,
  `sendDocument(...)` (order slips).
- Handles retries/backoff; persists an outbound `messages` row (`status:'queued'`→…); maps Graph
  message id to `wa_message_id`.
- **Tables touched:** `messages`, reads `whatsapp_numbers` (token ref, `phone_number_id`),
  `message_templates`.

### 3.6 NotificationService

- `notify({ merchantId, userId?, type, title, body, data, channel })` → creates `notifications` row
  and pushes over Realtime; may fan out to `email`/`whatsapp` channels.
- Helpers: `newOrder(order)`, `paymentClaim(payment)`, `takeoverRequest(conversation)`,
  `botNeedsHelp(conversation, reason)`, `lowStock(product)`, `templateStatus(template)`.
- **Tables touched:** `notifications`.

### 3.7 ClaudeClient
The only path to the LLM. **Never** decides prices (doc 00 principle).

- `classify(input: { conversationContext, message, catalogHints }) → { intent, entities }`
  — **`intent` is drawn from the canonical intent enum in doc 05 §2.1** (do not invent a divergent
  list here). `handoff` is a **routing outcome**, not a classifier intent (CD-25). `entities` includes
  `items[]` for multi-item turns and supports a `stop`/opt-out intent (CD-8, sets
  `customers.wa_opt_in_status='out'`).
- `compose(brief: { decision, state, personaKnobs, language }) → string` — phrases a **decision the
  code already made** in Roman Urdu (English fallback).
- `answerFromKnowledge({ question, knowledge }) → string` — grounded FAQ using `bot_knowledge`.
- Enforces token/latency budgets, structured-output parsing, and prompt-injection guards (doc 06/09).
- **Tables touched:** none directly (reads passed-in context; may read `bot_knowledge`).

### 3.8 SlipGenerator

- `generate(orderId) → slipUrl` — renders order → PDF, uploads to
  `order-slips/{merchantId}/{orderId}.pdf`, sets `orders.slip_url`, returns a signed URL.
- Delivered to buyer as a document via `WhatsAppSender.sendDocument`.
- **Tables touched:** reads `orders`/`order_items`/`customers`/`merchants`; writes `orders.slip_url`;
  Storage `order-slips/`.

### 3.9 CatalogSyncService

- `importCsv({ merchantId, fileRef, mapping, dryRun }) → jobResult` — parses `catalog-imports/`
  file, upserts `products` by `sku`/`external_ref`.
- `syncFromMeta({ merchantId, wabaId, direction }) → jobResult` — pulls Meta catalog items, matches
  `retailer_id ↔ products.external_ref`, upserts. Graph detail: doc 04.
- **Tables touched:** `products`, `product_categories`, `background_jobs` (job status/result); Storage
  `catalog-imports/`.
- Job durability via `background_jobs` (CD-3); poll endpoints read that table (§2.6).

---

## 4. Order status transition rules

`order_status` enum (doc 02): `draft`, `pending_confirmation`, `confirmed`, `awaiting_payment`,
`paid`, `preparing`, `dispatched`, `delivered`, `cancelled`, `returned`.

This is the **canonical order-status transition table (CD-15)** — the FSM in doc 05 and the flows in
doc 08 conform to it. Order materialization: the cart lives in `conversations.context` through
`order_building`; on **entry to `collecting_delivery`** the bot writes `orders(status='draft')` +
`order_items` (guaranteeing an `order_id` for payment/slip). `draft→pending_confirmation` on entry to
`selecting_payment`. `pending_confirmation→confirmed` is the buyer's explicit final confirm (assigns
`order_number`, `placed_at`, generates the slip, decrements stock, emits `new_order`).

Every transition writes an `order_status_history` row with `changed_by` ∈ (`bot`,`agent`,`system`)
and optional `user_id`/`note`. `changed_by` is **pinned per transition** below (CD-14/FL-14).

| From → To | `changed_by` | Notes |
|---|---|---|
| _(none)_ → `draft` | `bot` (agent for manual orders) | Materialized on entry to `collecting_delivery`; `order_id` now exists for payment/slip. |
| `draft` → `pending_confirmation` | `bot` | On entry to `selecting_payment`; awaiting buyer's final confirm. |
| `draft` → `confirmed` | `agent` | Manual order created + confirmed directly by staff (skips buyer-confirm turn). |
| `pending_confirmation` → `confirmed` | `bot`, `agent` | Buyer's explicit final confirm; assigns `order_number`, `placed_at`, slip, stock decrement, `new_order`. |
| `confirmed` → `awaiting_payment` | `bot` | Bank transfer selected: bot moves to `awaiting_payment_proof`, sends bank details (CD-16). |
| `confirmed` → `preparing` | `bot`, `agent` | **COD** confirmed order proceeds directly (payment_status already `cod_pending`, set at COD selection — CD-17). |
| `awaiting_payment` → `paid` | `system` | On `payments.status='verified'` **via `PaymentService.verify`** only (owner/manager triggered). |
| `paid` → `preparing` | `agent`, `system` | |
| `preparing` → `dispatched` | `agent`, `system` | No COD verb here — `cod_pending` was set at selection (CD-17). |
| `dispatched` → `delivered` | `agent`, `system` | COD: `cod_collected` recorded on delivery via `PaymentService.markCodCollected`. |
| `delivered` → `returned` | `agent` | Post-delivery return; sets `returned_reason`. |
| `draft` → `cancelled` | `agent` | **Manual only.** Requires `cancelled_reason`; restores any decremented stock. |
| `awaiting_payment` → `cancelled` | `agent` | **Manual only.** Requires `cancelled_reason`. |
| any of `pending_confirmation`,`confirmed`,`paid`,`preparing` → `cancelled` | `agent` | **Manual only.** Requires `cancelled_reason`; restores stock. |

Rules:
- **No automatic abandonment auto-cancel (CD-21).** There is **no** `awaiting_payment→cancelled` on
  "abandoned + timeout" and no bot auto-cancel of `draft`/`pending_confirmation`. Cancellation is
  **manual only** (agent, with `cancelled_reason`). A background job may flip
  `negotiations ongoing→abandoned` on window expiry (actor `system`), but leaves the order untouched.
- **Terminal** states: `delivered` (except → `returned`), `cancelled`, `returned` — no further
  transitions (except `delivered`→`returned`).
- Any transition not listed → `409 INVALID_STATE_TRANSITION`.
- The `POST /api/v1/orders/:id/status` endpoint enforces both the table **and** role. The
  payment-driven `awaiting_payment→paid` edge is **not** exposed here — it happens only through
  `PaymentService.verify`; a direct portal attempt returns `409 INVALID_STATE_TRANSITION`.
- `bot`/`system` transitions come from services (service token), not the portal.

---

## 5. Realtime channels (Supabase Realtime)

The portal subscribes to per-merchant channels (RLS-scoped by `merchant_id`). Backend writes via
service role; Supabase broadcasts row changes.

| Channel | Payload / table | Consumed by |
|---|---|---|
| `merchant:{merchantId}:conversations` | `conversations` inserts/updates (status, `unread_count`, `last_message_at`) | Inbox list live updates |
| `merchant:{merchantId}:messages` (or `conversation:{conversationId}:messages`) | `messages` inserts + `status` updates (`queued`→`sent`→`delivered`→`read`/`failed`) | Open conversation thread |
| `merchant:{merchantId}:orders` | `orders` inserts/updates (status, `payment_status`) | Orders board |
| `merchant:{merchantId}:payments` | `payments` inserts/updates (claim → verify/reject) | Payment queue |
| `merchant:{merchantId}:notifications` | `notifications` inserts | Bell / toast |
| `merchant:{merchantId}:negotiations` | `negotiations` updates (round/outcome) | Live inbox negotiation panel |
| `merchant:{merchantId}:whatsapp-numbers` | `whatsapp_numbers` updates (`status`, `quality_rating`, `messaging_tier`, `flag_reason`) | Number health / connection banner |

**Publication (CD-29).** Realtime broadcasts only tables added to the Supabase publication. The
canonical publication list is exactly these seven tables:

```sql
ALTER PUBLICATION supabase_realtime ADD TABLE
  conversations, messages, orders, payments, notifications, negotiations, whatsapp_numbers;
```

Notes:
- Realtime is **read-only push**; all mutations go through the REST API or services.
- Supabase Realtime **honors RLS** — subscriptions are filtered by the same `merchant_id` tenant
  policy (doc 02), so a client only receives row changes for its own merchant. This prevents
  cross-tenant leakage over the socket.
- The portal also polls `GET /api/v1/notifications/unread-count` as a fallback when a socket drops.

---

## 6. OpenAPI-style endpoint summary — CANONICAL ROUTE TABLE

**This table is the single canonical API route table (CD-26).** Where docs 04/07/08 reference an
endpoint, they conform to the method, path, and roles here. Canonical names in use: `GET /session`,
`PATCH /merchant`, `/conversations/:id/release`, `/product-categories`, `/message-templates`,
`/products/import`, `/products/catalog-sync`, `/team/invite`, and payment actions are **POST**
(`POST /orders/:id/payment/verify|reject|cod-collected`).

| # | Method | Path | Resource | Auth / roles |
|---|---|---|---|---|
| 1 | GET | `/healthz` | health | public |
| 1a | GET | `/readyz` | health | public |
| 2 | GET | `/api/v1/session` | session | any authed |
| 3 | PATCH | `/api/v1/session/last-login` | session | any authed |
| 4 | GET | `/api/v1/merchant` | merchant | any authed |
| 5 | PATCH | `/api/v1/merchant` | merchant | owner |
| 5a | PATCH | `/api/v1/merchant/bot` | merchant (bot kill-switch) | owner, manager |
| 6 | GET | `/api/v1/merchant/onboarding` | onboarding | owner, manager |
| 7 | POST | `/api/v1/merchant/onboarding/complete` | onboarding | owner |
| 8 | POST | `/api/v1/admin/merchants` | admin/merchants | platform_admin |
| 9 | GET | `/api/v1/admin/merchants` | admin/merchants | platform_admin |
| 10 | PATCH | `/api/v1/admin/merchants/:id` | admin/merchants | platform_admin |
| 10a | POST | `/api/v1/admin/whatsapp-numbers` | admin/whatsapp (register) | platform_admin |
| 10b | POST | `/api/v1/admin/whatsapp-numbers/:id/token` | admin/whatsapp (attach token/secret) | platform_admin |
| 10c | POST | `/api/v1/admin/whatsapp-numbers/:id/subscribe-webhook` | admin/whatsapp (subscribe) | platform_admin |
| 11 | GET | `/api/v1/team` | team | owner, manager |
| 12 | POST | `/api/v1/team/invite` | team | owner |
| 13 | GET | `/api/v1/team/:id` | team | owner, manager |
| 14 | PATCH | `/api/v1/team/:id` | team | owner |
| 15 | DELETE | `/api/v1/team/:id` | team | owner |
| 16 | GET | `/api/v1/whatsapp-numbers` | whatsapp | any authed |
| 17 | GET | `/api/v1/whatsapp-numbers/:id` | whatsapp | any authed |
| 18 | POST | `/api/v1/whatsapp-numbers` | whatsapp | owner |
| 19 | PATCH | `/api/v1/whatsapp-numbers/:id` | whatsapp | owner |
| 20 | GET | `/api/v1/whatsapp-numbers/:id/status` | whatsapp | owner, manager |
| 20a | GET | `/api/v1/whatsapp-numbers/:id/health` | whatsapp | any authed |
| 20b | POST | `/api/v1/whatsapp-numbers/:id/reconnect` | whatsapp | owner |
| 21 | POST | `/api/v1/whatsapp-numbers/:id/webhook-test` | whatsapp | owner |
| 22 | GET | `/api/v1/product-categories` | categories | any authed |
| 23 | POST | `/api/v1/product-categories` | categories | owner, manager |
| 24 | PATCH | `/api/v1/product-categories/:id` | categories | owner, manager |
| 25 | DELETE | `/api/v1/product-categories/:id` | categories | owner, manager |
| 26 | GET | `/api/v1/products` | products | any authed |
| 27 | GET | `/api/v1/products/:id` | products | any authed |
| 28 | POST | `/api/v1/products` | products | owner, manager |
| 29 | PATCH | `/api/v1/products/:id` | products | owner, manager |
| 30 | DELETE | `/api/v1/products/:id` | products | owner, manager |
| 31 | POST | `/api/v1/products/:id/images` | products | owner, manager |
| 32 | DELETE | `/api/v1/products/:id/images` | products | owner, manager |
| 33 | POST | `/api/v1/products/import` | products/import | owner, manager |
| 34 | GET | `/api/v1/products/import/:jobId` | products/import | owner, manager |
| 35 | POST | `/api/v1/products/catalog-sync` | products/sync | owner, manager |
| 36 | GET | `/api/v1/products/catalog-sync/:jobId` | products/sync | owner, manager |
| 37 | GET | `/api/v1/customers` | customers | any authed |
| 38 | GET | `/api/v1/customers/:id` | customers | any authed |
| 39 | PATCH | `/api/v1/customers/:id` | customers | owner, manager, staff |
| 40 | POST | `/api/v1/customers/:id/block` | customers | owner, manager |
| 41 | POST | `/api/v1/customers/:id/unblock` | customers | owner, manager |
| 42 | GET | `/api/v1/conversations` | conversations | any authed |
| 43 | GET | `/api/v1/conversations/:id` | conversations | any authed |
| 44 | GET | `/api/v1/conversations/:id/messages` | conversations | any authed |
| 45 | POST | `/api/v1/conversations/:id/takeover` | conversations | any authed |
| 46 | POST | `/api/v1/conversations/:id/release` | conversations | any authed |
| 47 | POST | `/api/v1/conversations/:id/close` | conversations | owner, manager |
| 48 | POST | `/api/v1/conversations/:id/messages` | conversations | any authed |
| 49 | POST | `/api/v1/conversations/:id/read` | conversations | any authed |
| 50 | POST | `/api/v1/conversations/:id/reset-state` | conversations | owner, manager |
| 51 | GET | `/api/v1/messages/:id` | messages | any authed |
| 52 | GET | `/api/v1/messages/:id/media` | messages | any authed |
| 53 | POST | `/api/v1/messages/:id/retry` | messages | owner, manager |
| 54 | GET | `/api/v1/negotiations` | negotiations | any authed |
| 55 | GET | `/api/v1/negotiations/:id` | negotiations | any authed |
| 56 | GET | `/api/v1/conversations/:id/negotiations` | negotiations | any authed |
| 57 | GET | `/api/v1/orders` | orders | any authed |
| 58 | GET | `/api/v1/orders/:id` | orders | any authed |
| 59 | POST | `/api/v1/orders` | orders | owner, manager, staff |
| 60 | PATCH | `/api/v1/orders/:id` | orders | owner, manager, staff |
| 61 | POST | `/api/v1/orders/:id/items` | order-items | owner, manager, staff |
| 62 | PATCH | `/api/v1/orders/:id/items/:itemId` | order-items | owner, manager, staff |
| 63 | DELETE | `/api/v1/orders/:id/items/:itemId` | order-items | owner, manager, staff |
| 64 | POST | `/api/v1/orders/:id/status` | orders | role per §4 |
| 65 | POST | `/api/v1/orders/:id/cancel` | orders | owner, manager |
| 66 | POST | `/api/v1/orders/:id/slip` | orders | owner, manager, staff |
| 67 | GET | `/api/v1/orders/:id/slip` | orders | any authed |
| 67a | POST | `/api/v1/orders/:id/slip/resend` | orders | owner, manager, staff |
| 68 | GET | `/api/v1/orders/:id/payment` | payments | any authed |
| 69 | POST | `/api/v1/orders/:id/payment/send-bank-details` | payments | any authed / internal |
| 70 | POST | `/api/v1/orders/:id/payment/claim` | payments | any authed / internal |
| 71 | POST | `/api/v1/orders/:id/payment/verify` | payments | **owner, manager** |
| 72 | POST | `/api/v1/orders/:id/payment/reject` | payments | **owner, manager** |
| 73 | POST | `/api/v1/orders/:id/payment/cod-mark-pending` | payments (idempotent no-op; not required — CD-17) | owner, manager, staff / internal |
| 74 | POST | `/api/v1/orders/:id/payment/cod-collected` | payments | owner, manager, staff |
| 75 | GET | `/api/v1/bank-accounts` | bank-accounts | any authed |
| 76 | POST | `/api/v1/bank-accounts` | bank-accounts | owner, manager |
| 77 | PATCH | `/api/v1/bank-accounts/:id` | bank-accounts | owner, manager |
| 78 | DELETE | `/api/v1/bank-accounts/:id` | bank-accounts | owner, manager |
| 79 | GET | `/api/v1/delivery-zones` | delivery-zones | any authed |
| 80 | POST | `/api/v1/delivery-zones` | delivery-zones | owner, manager |
| 81 | PATCH | `/api/v1/delivery-zones/:id` | delivery-zones | owner, manager |
| 82 | DELETE | `/api/v1/delivery-zones/:id` | delivery-zones | owner, manager |
| 83 | GET | `/api/v1/delivery-zones/lookup` | delivery-zones | any authed / internal |
| 84 | GET | `/api/v1/message-templates` | templates | any authed |
| 85 | GET | `/api/v1/message-templates/:id` | templates | any authed |
| 86 | POST | `/api/v1/message-templates` | templates | owner, manager |
| 87 | PATCH | `/api/v1/message-templates/:id` | templates | owner, manager |
| 88 | DELETE | `/api/v1/message-templates/:id` | templates | owner, manager |
| 89 | POST | `/api/v1/message-templates/:id/submit` | templates | owner, manager |
| 90 | GET | `/api/v1/message-templates/:id/status` | templates | owner, manager |
| 91 | GET | `/api/v1/bot-knowledge` | bot-knowledge | any authed |
| 92 | POST | `/api/v1/bot-knowledge` | bot-knowledge | owner, manager |
| 93 | PATCH | `/api/v1/bot-knowledge/:id` | bot-knowledge | owner, manager |
| 94 | DELETE | `/api/v1/bot-knowledge/:id` | bot-knowledge | owner, manager |
| 95 | GET | `/api/v1/negotiation-settings` | negotiation-settings | any authed |
| 96 | PATCH | `/api/v1/negotiation-settings` | negotiation-settings | owner, manager |
| 97 | GET | `/api/v1/negotiation-settings/products/:productId` | negotiation-settings | any authed |
| 98 | PATCH | `/api/v1/negotiation-settings/products/:productId` | negotiation-settings | owner, manager |
| 99 | GET | `/api/v1/notifications` | notifications | any authed |
| 100 | GET | `/api/v1/notifications/unread-count` | notifications | any authed |
| 101 | POST | `/api/v1/notifications/:id/read` | notifications | any authed |
| 102 | POST | `/api/v1/notifications/read-all` | notifications | any authed |
| 103 | GET | `/api/v1/dashboard/summary` | dashboard | any authed |
| 103a | GET | `/api/v1/analytics/summary` | analytics (canonical; alias of `/analytics/dashboard`) | any authed |
| 104 | GET | `/api/v1/analytics/timeseries` | analytics (canonical; alias of `/analytics/sales`) | any authed |
| 104a | GET | `/api/v1/analytics/top-products` | analytics | any authed |
| 105 | GET | `/api/v1/analytics/negotiations` | analytics | owner, manager |
| 106 | GET | `/api/v1/webhook/whatsapp` | webhook | public (verify token) |
| 107 | POST | `/api/v1/webhook/whatsapp` | webhook | Meta signature |

> Deprecated aliases retained for one release: `GET /api/v1/analytics/dashboard` (→ `summary`),
> `GET /api/v1/analytics/sales` (→ `timeseries`). See §2.20.

---

## 7. Cross-references
- Inbound processing, signature verification, 24h window, template send: **04-whatsapp-integration.md**.
- `bot_state` transitions, intents, conversation paths the orchestrator drives: **05-bot-flows.md**.
- Floor math, concession steps, guardrails behind `NegotiationEngine`: **06-negotiation-engine.md**.
- Portal screens that consume these endpoints/channels: **07-admin-portal-screens.md**.
- Payment screenshot handling, merchant confirm UX, notification copy: **08-payments-notifications.md**.
- Auth hook (`merchant_id` claim), secrets, rate-limit infra, logging: **09-nonfunctional-devops.md**.
