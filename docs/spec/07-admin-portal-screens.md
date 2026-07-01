# 07 — Admin Portal Screens

The merchant-facing web app. **Next.js (App Router) + React + Tailwind**, **Supabase Auth**, talking to
the Admin REST API (`/api/v1/*`, see [03-backend-api.md](03-backend-api.md)) and **Supabase Realtime**
(see [01-architecture.md](01-architecture.md)). UI language: **English**. All money is stored as integer
**paisa** and displayed as `Rs. 1,250` (paisa/100, thousands-separated). All timestamps stored UTC,
displayed in the merchant's `timezone` (default `Asia/Karachi`).

> **Cross-refs:** table/column/enum names come from [02-data-model.md](02-data-model.md). API endpoints
> referenced as `METHOD /api/v1/...` are the **canonical routes from [03-backend-api.md](03-backend-api.md) §6**
> (do not diverge). Bot states (`bot_state`) and conversation logic in [05-bot-flows.md](05-bot-flows.md).
> Negotiation math in [06-negotiation-engine.md](06-negotiation-engine.md). Payments/notifications flow in
> [08-payments-notifications.md](08-payments-notifications.md). Canonical audit decisions (CD-1…CD-45) in
> [10-audit-report.md](10-audit-report.md) are normative and win over any earlier wording here.

---

## 0. Conventions used in this document

For **every** screen we specify: **Route**, **Purpose**, **Access** (role), **Layout & components**,
**Data** (tables/fields), **Actions → API**, **States** (loading/empty/error/success), **Validation**,
**Edge cases**.

Roles are the `user_role` enum: **owner**, **manager**, **staff** (from `merchant_users`).
"Platform admin" (us) is out of scope for this portal — separate super-admin app.

Money display helper: `formatPKR(paisa) => "Rs. " + (paisa/100).toLocaleString('en-PK')`.

---

## 1. Global navigation & information architecture

### 1.1 App shell
```
┌───────────────────────────────────────────────────────────────────────────┐
│  ☰  Sahulatkaar   [Business name]        🔔(3)  ● Bot: Active   [Avatar ▾] │  top bar
├──────────┬────────────────────────────────────────────────────────────────┤
│ Dashboard│                                                                  │
│ Inbox  ● │                                                                  │
│ Orders   │                    < page content >                              │
│ Catalog  │                                                                  │
│ Customers│                                                                  │
│ Analytics│                                                                  │
│ ─────────│                                                                  │
│ Settings ▾                                                                  │
│  Negotiation                                                                │
│  Bot Training                                                               │
│  Payments                                                                   │
│  Delivery                                                                   │
│  Templates                                                                  │
│  Team                                                                       │
│  Business/Account                                                           │
└──────────┴────────────────────────────────────────────────────────────────┘
```

- **Left sidebar** (collapsible): primary nav. Badges: **Inbox** shows unread conversation count
  (sum of `conversations.unread_count` for `bot_active`+`human_takeover`), **Orders** optionally shows
  count of orders in `pending_confirmation`/`awaiting_payment` needing attention.
- **Top bar**: hamburger (mobile), business name (`merchants.business_name`), **notifications bell**
  (unread `notifications.read_at IS NULL` count), **bot status pill** (derived from
  `whatsapp_numbers.status` + the global kill-switch `merchants.settings.botEnabled` — CD-33; the pill is
  the primary toggle, see §4), **user avatar menu** (profile, switch merchant [future multi-tenant], sign out).
- **Settings** is a grouped section (collapsible) containing the config screens (9–16). On mobile it's a
  single "Settings" entry that opens a sub-menu list.

### 1.2 Route map
| Area | Route | Screen |
|---|---|---|
| Auth | `/login` | Login (§2.1) |
|  | `/signup` | Signup (§2.2) |
|  | `/forgot-password` | Forgot password (§2.3) |
|  | `/reset-password` | Reset password (§2.3) |
|  | `/accept-invite` | Accept invite (§2.4) |
| Onboarding | `/onboarding` | Wizard (§3) |
| Home | `/` or `/dashboard` | Dashboard (§4) |
| Catalog | `/catalog` | Product list (§5.1) |
|  | `/catalog/new`, `/catalog/:id` | Add/Edit product (§5.2) |
|  | `/catalog/import` | CSV/Excel import (§5.3) |
|  | `/catalog/sync` | Meta catalog sync (§5.4) |
|  | `/catalog/categories` | Categories (§5.5) |
| Orders | `/orders` | Order list (§6.1) |
|  | `/orders/:id` | Order detail (§6.2) |
| Inbox | `/inbox` | Conversation list + chat (§7) |
|  | `/inbox/:conversationId` | Focused chat |
| Customers | `/customers` | List (§8.1) |
|  | `/customers/:id` | Detail (§8.2) |
| Analytics | `/analytics` | Analytics (§13) |
| Settings | `/settings/negotiation` | Negotiation (§9) |
|  | `/settings/bot` | Bot training (§10) |
|  | `/settings/payments` | Payment settings (§11) |
|  | `/settings/delivery` | Delivery zones (§12) |
|  | `/settings/templates` | Templates (§13→§14 list; see note) |
|  | `/settings/team` | Team (§15) |
|  | `/settings/notifications` | Notifications center (§16) |
|  | `/settings/business` | Business/WhatsApp/account (§17) |

> Numbering note: the request listed Templates as #12 and Analytics as #13; below, **Analytics = §13**,
> **Team = §15**, **Notifications = §16**, **Settings/Business = §17**, **Templates = §14**. Route table above is authoritative.

### 1.3 Layout primitives (shared components)
- `<PageHeader title actions/>`, `<DataTable/>` (sortable, paginated, row-select for bulk),
  `<FilterBar/>`, `<StatCard/>`, `<Drawer/>` (side panel for detail/edit), `<Modal/>`,
  `<Toast/>` (success/error), `<EmptyState illustration title cta/>`, `<StatusBadge kind value/>`,
  `<MoneyInput/>` (paisa-aware), `<ImageUploader bucket/>`, `<ConfirmDialog/>`, `<RealtimeIndicator/>`.
- **StatusBadge** color map (used everywhere):
  order_status: draft=gray, pending_confirmation=amber, confirmed=blue, awaiting_payment=orange,
  paid=green, preparing=indigo, dispatched=purple, delivered=green-solid, cancelled=red, returned=red-outline.
  payment_status: unpaid=gray, claimed=amber, verified=green, failed=red, cod_pending=blue, cod_collected=green.
  conversation_status: bot_active=green, human_takeover=amber, closed=gray.

### 1.4 Responsive / mobile behavior
Merchants are frequently on phones. Design **mobile-first**:
- **≥1024px (desktop):** sidebar visible, tables full, Inbox uses 3-pane (list | chat | customer sidebar).
- **768–1023px (tablet):** sidebar collapses to icons; Inbox = 2-pane (list | chat), customer info in a drawer.
- **<768px (phone):**
  - Sidebar becomes a slide-over from the hamburger; bottom tab bar for the 4 most-used areas
    (Dashboard, Inbox, Orders, Catalog) ⚠️ PROPOSED.
  - Tables collapse to **card lists** (each row → stacked card with the 3–4 key fields + a "⋯" action menu).
  - Inbox is **single-pane, stack-navigated**: list → tap → chat (full screen) → back; customer info is a
    top sheet / expandable header.
  - Order detail, product edit, and settings forms are full-screen scrollable; primary action pinned to a
    sticky bottom bar (e.g., "Save", "Verify Payment").
  - Payment-screenshot viewing supports pinch-zoom.

### 1.5 Realtime updates (Supabase Realtime)
Subscribed channels per merchant (`merchant_id`-scoped):
- **conversations / messages** → Inbox list reorders on `last_message_at`, unread badges update, new
  messages append live in open chat, `status` change (bot→takeover) flips the toggle.
- **orders / payments** → Orders list + open order detail update on status/payment changes (e.g., a
  buyer's payment claim flips payment panel to "claimed" without refresh).
- **notifications** → bell count + Notifications center update live; toast for high-priority
  (`new_order`, `payment_claim`, `takeover_request`, `bot_needs_help`).
- **whatsapp_numbers** → bot-status pill and Settings health card update on `status`/`quality_rating`/
  `messaging_tier`/`flag_reason` change (typed enums, CD-9). Channel `merchant:{merchantId}:whatsapp_numbers`.
- `<RealtimeIndicator/>` shows connection health; on disconnect, fall back to polling every 15s and show a
  subtle "reconnecting" state. Canonical publication list (doc 03 §5, CD-29): `conversations`, `messages`,
  `orders`, `payments`, `notifications`, `negotiations`, `whatsapp_numbers` — all RLS-scoped by `merchant_id`.

### 1.6 Permissions matrix (by `user_role`)
`R` = read/view, `W` = create/edit, `—` = hidden/blocked. Enforced **server-side via RLS + role checks**
(see [02-data-model.md](02-data-model.md) §RLS); the UI also hides/disables to match.

| Screen / capability | owner | manager | staff |
|---|:---:|:---:|:---:|
| Dashboard | R | R | R |
| Inbox — view chats | R | R | R |
| Inbox — send/takeover | W | W | W |
| Inbox — block customer | W | W | — |
| Orders — view | R | R | R |
| Orders — status change / confirm / dispatch | W | W | W |
| Orders — verify/reject payment | W | W | **—** |
| Orders — mark COD collected | W | W | W |
| Orders — cancel / edit totals | W | W | — |
| Catalog — view | R | R | R |
| Catalog — add/edit/delete, import, sync | W | W | — |
| Catalog — view `cost` / margin | R | R | **—** (stripped) |
| Customers — view | R | R | R |
| Customers — block | W | W | — |
| Customers — edit notes/tags | W | W | W |
| Analytics — view | R | R | R |
| Analytics — cost/margin figures | R | R | **—** (stripped) |
| Inbox — message `raw` payload | R | R | **—** (stripped) |
| Negotiation settings | W | R | — |
| Bot training | W | W | — |
| Payment settings — bank accounts (CRUD) | W | W | **—** |
| Delivery settings | W | W | — |
| Templates | W | W | — |
| Team (invite/roles/deactivate) | W | — | — |
| Notifications center | R/W own | R/W own | R/W own |
| Business/WhatsApp/Account settings | W | R | — |
| WhatsApp number connect | W | — | — |
| Billing (placeholder) | R | — | — |

> **Canonical (CD-37 — doc 09's strictest matrix wins).** These are **definitive**, not proposed.
> **Staff CANNOT:** verify or reject payments, CRUD bank accounts, or view `products.cost` / any derived
> margin / analytics-with-margin / `messages.raw`. Staff **can** mark COD cash as collected and edit
> customer notes/tags. Enforcement is **two-layered** (per doc 03 §1.2): (1) API route guards return
> `403 FORBIDDEN` to `staff` on payment verify/reject and bank-account writes; and (2) **server-side
> field-stripping** removes `cost`, derived margin, and `messages.raw` from responses when `role='staff'`
> (belt-and-braces over the doc 02 RLS/column policy). The UI additionally hides/disables these controls,
> but the server is the source of truth.

---

## 2. Authentication screens

Auth is **Supabase Auth**. Portal users map 1:1 to `merchant_users` (via `auth_user_id`). These screens
are **unauthenticated** (public), rendered outside the app shell with a centered card layout + branding.

### 2.1 Login — `/login`
- **Purpose:** authenticate an existing merchant user.
- **Access:** public.
- **Layout:** centered card. Logo, "Sign in to Sahulatkaar", email field, password field, "Forgot
  password?" link, **Sign in** button, small "Don't have an account? Sign up" (Path C: may be hidden/invite-only).
- **Data:** none read pre-auth. On success, session established; app fetches `GET /api/v1/session`
  (returns the `merchant_users` row + `merchants` row + role + `permissions`).
- **Actions → API:** Supabase `signInWithPassword`, then `PATCH /api/v1/session/last-login`. On success →
  if onboarding is incomplete (`merchants.settings.onboardingCompletedAt` is null — CD-13), redirect
  `/onboarding`; else `/dashboard`.
- **States:** loading (button spinner, fields disabled); error (invalid credentials → inline banner
  "Email or password is incorrect"; unconfirmed email → "Please confirm your email"); success → redirect.
- **Validation:** email format; password non-empty. Rate-limit feedback ("Too many attempts, try again
  in a minute").
- **Edge cases:** deactivated user (`merchant_users.is_active=false`) → block with "Your account is
  disabled, contact the owner." Suspended merchant (`merchants.status='suspended'`) → "This account is
  suspended." Already-signed-in visiting `/login` → redirect to `/dashboard`.

### 2.2 Signup — `/signup`
- **Purpose:** create a brand-new merchant + owner user (self-serve). **Path C:** likely disabled or
  gated by an invite/allow-list; kept in spec for scale.
- **Access:** public (or feature-flagged off).
- **Layout:** card with: owner name, business name, email, password, confirm password, accept-terms
  checkbox, **Create account** button.
- **Data written:** creates Supabase auth user + `merchants` row (`business_name`, `owner_name`, `email`,
  `status='pending'→'active'`, defaults: `timezone=Asia/Karachi`, `currency=PKR`, `default_language=roman_urdu`,
  seed `negotiation_defaults`/`bot_persona`) + `merchant_users` row (`role='owner'`, `is_active=true`).
- **Actions → API:** Supabase `signUp` then merchant creation. **Path C reality (CD-42):** tenant
  creation is a **platform-admin** operation (`POST /api/v1/admin/merchants`, doc 03 §2.2) gated behind a
  vetting/merchant-agreement step — self-serve `signUp` is feature-flagged off at launch. Where enabled, the
  server creates merchant+owner transactionally and mints the JWT `merchant_id` claim. Redirect to `/onboarding`.
- **States:** loading; success (may show "check your email to confirm" if email confirmation on); error
  (email already registered, weak password).
- **Validation:** name required; business name required; email valid + unique; password ≥ 8 chars +
  strength meter; confirm matches; terms checked.
- **Edge cases:** email exists → link to login. Confirmation-required flow → "resend email". Signup
  disabled → show "Signups are invite-only right now" with contact link.

### 2.3 Forgot / Reset password — `/forgot-password`, `/reset-password`
- **Purpose:** recover access.
- **Access:** public.
- **Forgot layout:** email field + **Send reset link**. Always show generic success ("If that email
  exists, we've sent a reset link") to avoid user enumeration.
- **Reset layout:** reached via emailed link (Supabase recovery token in URL). New password + confirm +
  **Update password**.
- **Actions → API:** Supabase `resetPasswordForEmail`; then `updateUser({password})`.
- **States:** loading; success (reset sent / password updated → redirect to login with success toast);
  error (invalid/expired token → "This link has expired, request a new one").
- **Validation:** email format; password ≥ 8 + confirm match.
- **Edge cases:** expired/used token; user clicks stale link; logged-in user opening reset link.

### 2.4 Accept invite — `/accept-invite`
- **Purpose:** an invited teammate sets a password and joins an existing merchant.
- **Access:** public, token-gated (invite token in URL). Ties to Team screen (§15).
- **Layout:** shows inviting business name + assigned role (read-only), name field (prefilled), password +
  confirm, **Join team** button.
- **Data:** validates invite token → resolves pending `merchant_users` row (email, `role`, `merchant_id`).
  On accept: link `auth_user_id`, set `is_active=true`, `name`.
- **Actions → API:** invites are created by `POST /api/v1/team/invite` (owner, doc 03 §2.3) which triggers
  a **Supabase Auth invite**; the teammate follows the emailed link and sets a password via the Supabase
  client SDK (verify/set-password is handled by Supabase, not this API), which links `auth_user_id` and
  activates the `merchant_users` row. Then `GET /api/v1/session` hydrates context. Redirect to `/dashboard`
  (no onboarding wizard — merchant already set up).
- **States:** loading (validating token); error (invalid/expired/already-used token → "This invite is no
  longer valid"); success → dashboard.
- **Validation:** password ≥ 8 + confirm; name required.
- **Edge cases:** invited email already has an account (link instead of create); merchant suspended;
  invite revoked after send; role changed since invite (use current value).

---

## 3. Onboarding wizard (first-run) — `/onboarding`

- **Purpose:** get a new merchant live — configure the minimum needed for the bot to sell. Runs once,
  resumable. Access **owner** (managers see read-only / "ask owner to finish setup").
- **Access:** owner (primary). Redirect target after first login until
  `merchants.settings.onboardingCompletedAt` is set (CD-13).
- **Layout:** full-screen stepper with a left progress rail; each step = a focused form; **Back / Save &
  Continue / Skip for now** (where allowed). Persist each step immediately so it's resumable.

```
Progress rail                 Step content
● 1 Business profile   ┌───────────────────────────────────────────┐
○ 2 Connect WhatsApp   │  Step 3 — Bank accounts                    │
○ 3 Bank accounts      │  [ + Add bank account ]                    │
○ 4 Negotiation        │  ┌───────────────────────────────┐        │
○ 5 First products     │  │ Meezan • Ali Traders • ****1234│ ⭐    │
○ 6 Bot persona        │  └───────────────────────────────┘        │
○ 7 Go-live checklist  │             [ Skip ]   [ Save & Continue ] │
                       └───────────────────────────────────────────┘
```

### Step 1 — Business profile
- **Data:** `merchants.business_name`, `owner_name`, `phone`, `timezone`, `currency` (default PKR, locked
  for launch), `default_language` (`roman_urdu`/`english`/`urdu`), `business_hours` (jsonb: weekly
  open/close for "we'll reply during hours").
- **API:** `PATCH /api/v1/merchant`.
- **Validation:** business_name required; phone E.164-ish PK format; at least language chosen.

### Step 2 — Connect WhatsApp number
- **Purpose:** attach the merchant's WhatsApp number for routing (`whatsapp_numbers`).
- **Data shown:** connection **status** (`connecting`→`connected`/`flagged`/`disconnected`),
  `display_name`, `phone_e164`, `waba_id`, `phone_number_id`, `quality_rating`, `messaging_tier`,
  `verified_name_status`.
- **Path C reality (CD-42, operator-assisted):** the number is registered under the platform's own WABA
  via the **Cloud API** by our operator (see [01-architecture.md](01-architecture.md) multi-tenancy);
  registration is a **platform-admin** action and the raw token is never exposed to the portal (only an
  `access_token_ref` → `whatsapp_secrets`, CD-2). So this step is **status + instructions**, not self-serve
  embedded signup. Show:
  - If not yet connected: instructions ("We'll connect your number — enter it below and our team links it")
    + phone input → creates a pending `whatsapp_numbers` row with `status='connecting'`.
  - A **status card** that realtime-updates over `whatsapp_numbers`: connecting (spinner) → connected
    (green; shows number + `messaging_tier` + `quality_rating`) → `flagged`/`disconnected` (amber/red +
    `flag_reason` guidance). Enums are typed (CD-9): `quality_rating[green|yellow|red|unknown]`,
    `messaging_tier[unverified|tier_1..tier_4]`, `flag_reason[quality|token|policy|manual|null]`.
  - **NO QR scan (Cloud API):** a "scan QR" flow is **not applicable** — QR is a WhatsApp Web / unofficial-
    library concept. Path C is Cloud API only; we show operator-assisted connection status + instructions.
    A QR path is explicitly out of scope (would imply unofficial transport, per [00-overview.md](00-overview.md)).
- **Vetting/attestation (CD-42):** before the number goes live the merchant must have passed the vetting
  gate and completed **product-category attestation** (declaring they sell within allowed categories); this
  is a prerequisite surfaced here and enforced server-side.
- **API:** `POST /api/v1/whatsapp-numbers` (register), `GET /api/v1/whatsapp-numbers` /
  `GET /api/v1/whatsapp-numbers/:id` (status), `GET /api/v1/whatsapp-numbers/:id/status` (live probe).
  See [04-whatsapp-integration.md](04-whatsapp-integration.md).
- **States:** connecting (poll), connected (success), error (invalid number, already in use), can **Skip**
  (go live later) but go-live checklist will block "receive orders" until connected.
- **Edge cases:** `phone_number_id` uniqueness collision (already routed to another tenant) → block;
  flagged number → warning banner persists into Dashboard.

### Step 3 — Bank account(s)
- **Data:** `bank_accounts` (`bank_name`, `account_title`, `account_number`, `iban?`, `branch?`,
  `is_default`, `is_active`). First one auto-`is_default=true`.
- **API:** `POST /api/v1/bank-accounts`.
- **Validation:** bank_name + account_title + account_number required; IBAN format check if provided
  (PK IBAN = `PK` + 22 chars). At least one recommended (needed for bank_transfer method); can skip if
  COD-only.
- **Edge case:** if merchant skips and later enables bank transfer, go-live checklist flags it.

### Step 4 — Negotiation defaults
- **Data:** `merchants.negotiation_defaults` jsonb:
  `{ maxDiscountPct, minMarginPct?, concessionSteps, roundsMax, autoAcceptAtFloor }` (see §9 for detail).
- **API:** `PATCH /api/v1/merchant` (or `PATCH /api/v1/negotiation-settings`).
- **Validation:** maxDiscountPct 0–100; roundsMax ≥ 1; concessionSteps array/step > 0. Explainer text +
  worked example ("List Rs.1000, max 10% → floor Rs.900").

### Step 5 — Import / add first products
- **Purpose:** get catalog seeded. Offer three entry points: **Add manually** (mini product form),
  **Import CSV/Excel** (jumps into §5.3 flow inline), **Sync from Meta catalog** (§5.4).
- **Data:** `products` (minimal: name, price, stock?, negotiable?). At least 1 product to go live.
- **API:** `POST /api/v1/products`, import + sync endpoints (see §5).
- **Edge case:** zero products → go-live blocked; show "Add at least one product".

### Step 6 — Bot persona / greeting
- **Data:** `merchants.bot_persona` jsonb: bot **name**, **tone** (friendly/formal/playful), **greeting**
  message, **language** (mirrors default_language), signature/style knobs.
- **API:** `PATCH /api/v1/merchant`.
- **UI:** live **preview bubble** rendering the greeting as it'll appear on WhatsApp (Roman Urdu sample).
- **Validation:** greeting non-empty, ≤ length limit; name ≤ 25 chars.

### Step 7 — Go-live checklist
- **Purpose:** gate "turn the bot on" behind readiness. Read-only checklist derived from prior steps:
  - ✅/⬜ WhatsApp number **connected** (`whatsapp_numbers.status='connected'`)
  - ✅/⬜ At least **one active product** (`products.is_active=true`)
  - ✅/⬜ **Payment method** ready (≥1 active bank account **or** COD enabled)
  - ✅/⬜ **Negotiation defaults** set
  - ✅/⬜ **Bot persona/greeting** set
  - ⬜ (optional) at least one approved **utility template** for out-of-window replies
- **Action:** **Go live** button (enabled when required items ✅) → sets `merchants.settings.botEnabled=true`
  (kill-switch on, CD-33) and stamps `merchants.settings.onboardingCompletedAt` (CD-13), then redirect to
  Dashboard with a celebratory toast.
- **API:** `POST /api/v1/merchant/onboarding/complete` (sets `onboardingCompletedAt`); the go-live toggle
  itself is `PATCH /api/v1/merchant { settings: { botEnabled: true } }`.
- **Edge case:** any required item unchecked → button disabled with inline "why". Merchant can exit and
  finish later; Dashboard shows a persistent "Finish setup" banner until complete.

---

## 4. Dashboard / home — `/dashboard`

- **Purpose:** at-a-glance operational health; jumping-off point. First thing after login.
- **Access:** all roles (R).
- **Layout:**
```
┌ Alerts/setup banner (if any) ───────────────────────────────────────────┐
├──────────────┬──────────────┬──────────────┬──────────────┬─────────────┤
│ Today Orders │ Today Revenue│ Pending Pay. │ Active Chats │ Win-rate    │  KPI cards
│    12        │  Rs. 84,300  │   3 (Rs.9k)  │     5        │   62%       │
├──────────────┴──────────────┴──────────────┴──────────────┴─────────────┤
│ Avg discount given: 6.4%                             ● Bot: Active       │
├───────────────────────────────┬─────────────────────────────────────────┤
│  Recent orders (last 10)      │  Alerts / Notifications                  │
│  #SK-1042  Ali  Rs.3,200  ●   │  • Payment claim on #SK-1041 (verify)    │
│  #SK-1041  Sara Rs.1,800  ●   │  • Bot needs help on chat w/ 03xx…       │
│  …                            │  • Low stock: "Kurta M" (2 left)         │
└───────────────────────────────┴─────────────────────────────────────────┘
```
- **KPI cards & data:**
  | Card | Source | Definition (canonical, CO-18) |
  |---|---|---|
  | Today's orders | `orders` | count of **confirmed+** orders (`status ∉ {draft, pending_confirmation, cancelled}`) with `placed_at` in [today, merchant tz] |
  | Today's revenue | `payments`/`orders` | **collected** revenue = sum(`orders.total`) for orders whose payment reached `verified` **or** `cod_collected` today (unambiguous "today" = merchant-tz calendar day) |
  | Pending payments | `payments`/`orders` | count+sum where `payment_status IN (claimed, cod_pending)` |
  | Active chats | `conversations` | count where `status IN (bot_active, human_takeover)` and window open |
  | Negotiation win-rate | `negotiations` | agreed / (agreed+rejected+abandoned) over period |
  | Avg discount | `order_items` | mean per-order discount fraction = sum(`order_items.negotiated_discount`+`discount`) / `subtotal` (see §13 for the canonical formula) |

> **Metric definitions (normative, CO-18):**
> - **Orders count** = orders that reached **confirmed or later** (excludes `draft`, `pending_confirmation`,
>   `cancelled`), bucketed by `placed_at` in the merchant's timezone.
> - **Collected revenue** = total of orders whose payment is **`verified`** (bank) or **`cod_collected`**
>   (COD). This is the basis for "today's revenue" and the Dashboard/Analytics revenue figures — NOT
>   merely-placed or merely-`claimed` orders. (Gross/placed is reported separately in Analytics.)
> - **AOV** = collected revenue ÷ collected-orders count over the range.
> - **Discount** = per line, `order_items.negotiated_discount + order_items.discount`; per order, that sum
>   ÷ `subtotal`; the reported "avg discount %" is the mean across orders in range.
> - **RTO / cancel rate** = (`returned` + `cancelled`) ÷ orders **placed** in range.
> - **"Today"** is always the merchant-tz calendar day, not UTC.

- **Bot status pill (kill-switch, CD-33):** reflects `whatsapp_numbers.status` + `merchants.settings.botEnabled`.
  Clicking the pill **toggles `botEnabled`** via `PATCH /api/v1/merchant { settings: { botEnabled } }`
  (owner/manager; the orchestrator gate suppresses autonomous replies when false). A confirm dialog guards
  turning the bot off; deep-links to Settings for the number's connection state.
- **Recent orders:** last 10 `orders` (order_number, customer name, total, status badge) → row click to
  detail. **Alerts:** latest unread `notifications` (types: `new_order`, `payment_claim`,
  `takeover_request`, `bot_needs_help`, `low_stock`, `template_status`), each deep-links.
- **Actions → API:** `GET /api/v1/dashboard/summary?from=&to=` (single aggregate KPI call, doc 03 §6),
  plus `GET /api/v1/orders?limit=10&sort=placedAt&order=desc`, `GET /api/v1/notifications?unread=true`.
- **States:** loading (skeleton cards); empty-first-run (no orders yet → friendly "Your first order will
  appear here" + link to test the bot / share number); error (per-card retry, don't blank the page).
- **Realtime:** KPIs + recent orders + alerts update live.
- **Edge cases:** onboarding incomplete → top banner "Finish setup (3 steps left)". Bot disabled/flagged →
  prominent warning. Timezone correctness for "today".

---

## 5. Catalog

### 5.1 Product list — `/catalog`
- **Purpose:** manage products.
- **Access:** all view; owner/manager edit.
- **Layout:** `<PageHeader title="Catalog" actions=[Add product, Import, Sync catalog, Categories]/>` +
  `<FilterBar/>` + `<DataTable/>` with row-select for bulk.
```
[Search…]  Category ▾  Status: Active/Inactive ▾  Negotiable ▾  Stock: Low/Out ▾   [Add product]
□ Img  Name            SKU     Price     Stock  Negotiable  MaxDisc  Status   ⋯
□ 🖼  Kurta (M)        K-001   Rs.1,500  8      Yes         10%      Active   ⋯
□ 🖼  Shawl            SH-02   Rs.2,200  0      No          —        Active   ⋯   ← "Out of stock" chip
```
- **Data:** `products` (`images[0]`, `name`, `sku`, `price`, `stock`/`track_stock`, `negotiable`,
  `max_discount_pct`, `is_active`, `category_id`→category name). Search over `name`/`sku`.
- **Actions → API:** `GET /api/v1/products?search=&category=&status=&page=`. Row ⋯: Edit, Duplicate,
  Activate/Deactivate (`PATCH /api/v1/products/:id`), Delete (`DELETE …`, soft if referenced by orders).
  Bulk (with selection): Activate, Deactivate, Set category, Delete, Export.
- **States:** loading (table skeleton); empty-first-run (illustration + "Add your first product" / Import
  / Sync); filtered-empty ("No products match"); error (retry).
- **Validation:** bulk delete confirm; deleting product referenced in `order_items` → soft-deactivate not
  hard-delete (name preserved via `order_items.name_snapshot`).
- **Edge cases:** stock=null (untracked) shows "—", not "0". Out-of-stock badge when `track_stock` &&
  `stock<=0`. Large catalogs → server pagination + debounced search.

### 5.2 Add / Edit product — `/catalog/new`, `/catalog/:id`
- **Purpose:** create/update a product with all pricing/negotiation controls.
- **Access:** owner/manager.
- **Layout:** two-column form (or full-screen on mobile) + sticky Save bar.
```
┌ Basics ───────────────────────┐  ┌ Images ─────────────┐
│ Name*      [__________]        │  │ [ + upload ] 🖼🖼🖼  │  (drag reorder; first = primary)
│ SKU        [_____]             │  └─────────────────────┘
│ Category   [ select ▾ ]        │  ┌ Pricing ────────────┐
│ Description[____________]      │  │ Price*   Rs.[____]   │
│ Attributes (size/color) [+kv]  │  │ Cost     Rs.[____]   │  (optional, for margin floor)
├ Inventory ────────────────────┤  │ Currency PKR (locked)│
│ ☑ Track stock   Stock [__]     │  └─────────────────────┘
│ ☑ Active                       │  ┌ Negotiation (override)┐
└────────────────────────────────┘  │ ☑ Negotiable          │
                                     │ Max discount % [__]   │  ← overrides merchant default
                                     │ Min price  Rs.[____]  │  ← absolute floor (wins over %)
                                     │ ↳ Effective floor: Rs.1,350 (10% of 1,500) [preview] │
                                     └───────────────────────┘   [ Cancel ]  [ Save ]
```
- **Data (all `products` fields):** `name`, `sku`, `category_id`, `description`, `attributes` (jsonb kv
  editor), `images[]` (upload to `product-images/{merchant_id}/{product_id}/…`), `price`, `cost`,
  `currency`, `stock`, `track_stock`, `is_active`, `negotiable`, `max_discount_pct`, `min_price`,
  `external_ref` (read-only if synced from Meta).
- **Negotiation override panel** computes a **live effective floor preview** using merchant
  `negotiation_defaults.maxDiscountPct` unless `max_discount_pct` set, and `min_price` if set (wins). See
  §9 and [06-negotiation-engine.md](06-negotiation-engine.md) for precedence.
- **Actions → API:** `POST /api/v1/products` (new) / `PATCH /api/v1/products/:id` (edit); image upload via
  Supabase Storage signed upload + attach URLs.
- **States:** loading (edit fetch); saving (button spinner); success (toast + return to list or stay);
  error (field-level).
- **Validation:** name required; price required, > 0, integer paisa (input in rupees, convert); cost ≥ 0;
  stock ≥ 0 integer when track_stock; max_discount_pct 0–100; min_price ≥ 0 and, if set, must be ≤ price
  (warn if min_price > price or > pct-floor — explain which wins); SKU unique per merchant if provided.
- **Edge cases:** negotiable=false hides/greys discount fields; min_price makes max_discount_pct moot
  (show note); untrack stock disables stock input; image upload failure (retry per-file); Meta-synced
  product editing conflict (see §5.4).

### 5.3 CSV / Excel import — `/catalog/import`
- **Purpose:** bulk-create/update products from a spreadsheet.
- **Access:** owner/manager.
- **Flow (4 steps):** **Upload → Column mapping → Preview → Commit → Error report.**
```
Step 1 Upload:   [ Drop .csv/.xlsx or browse ]   (max ~5MB) → stored in catalog-imports/
Step 2 Mapping:  Detected columns → map to product fields
   Sheet col "Title"  →  [ name ▾ ]
   "Rate"             →  [ price (Rs) ▾ ]
   "Qty"              →  [ stock ▾ ]
   "Discount%"        →  [ max_discount_pct ▾ ]     (ignore ▾ for unmapped)
   ☑ First row is header    Match existing by: [ sku ▾ ]  (for upsert)
Step 3 Preview:  table of parsed rows with per-row validation ✓/✗
   45 rows: 40 new, 3 update, 2 errors  →  [ Back ]  [ Commit 43 valid rows ]
Step 4 Result:   "40 created, 3 updated, 2 skipped"  [ Download error report .csv ]
```
- **Data:** file → `catalog-imports/` bucket; parsed rows → `products` insert/update (upsert keyed by
  `sku` or `external_ref`).
- **Actions → API (canonical, doc 03 §2.6):** `POST /api/v1/products/import` (multipart `file`, optional
  `mapping` JSON + `dryRun=true` for the preview step) → returns `202 { jobId, status:'queued' }`;
  `GET /api/v1/products/import/:jobId` polls status + counts + per-row `errors` (error report). Jobs are
  durable in the **`background_jobs`** table (`type='product_import'`, CD-3) — the previously-flagged
  missing table is now canonical.
- **States:** uploading (progress); parsing; mapping (interactive); previewing (per-row validation);
  committing (progress bar for large files); done (summary + downloadable error report); error (bad file
  format, encoding, empty).
- **Validation:** required mappings present (at least name + price); price parse (strip "Rs", commas →
  paisa); numeric coercion for stock/discount; duplicate SKUs within file flagged; row-level errors don't
  block valid rows (partial commit).
- **Edge cases:** Excel multiple sheets (pick sheet); huge file (chunked/async job + progress); re-import
  (upsert vs duplicate); encoding (UTF-8/Urdu names); currency assumed PKR; images not supported via CSV
  (note) unless URL column mapped to `images`.

### 5.4 Meta / WhatsApp catalog sync — `/catalog/sync`
- **Purpose:** connect and pull products from the merchant's existing Meta/WhatsApp Commerce catalog;
  keep in sync via `external_ref` (`products.external_ref` = Meta `retailer_id`).
- **Access:** owner/manager.
- **Layout:**
```
Connection:  [ Connect Meta catalog ]  → once connected: Catalog "Ali Store" (id …)  [Disconnect]
Sync:        Last synced 2h ago.  [ Pull now ]   ☐ Auto-sync daily
Conflicts (12):
   Meta "Kurta"  Rs.1,600  ⇄  Local "Kurta" Rs.1,500   [Keep local][Take Meta][Merge…]
   New in Meta (8): [Import all]     Missing in Meta (2): [keep / deactivate]
```
- **Data:** reads Meta catalog via Graph API (see [04-whatsapp-integration.md](04-whatsapp-integration.md));
  writes `products` (matched by `external_ref`). Fields synced: name, description, price, images,
  availability→`is_active`/`stock`.
- **Actions → API (canonical, doc 03 §2.6):** `POST /api/v1/products/catalog-sync` (body optional
  `{ wabaId, direction:'pull' }`) → returns `202 { jobId }`; `GET /api/v1/products/catalog-sync/:jobId`
  polls status (shape mirrors import). The sync runs as a `background_jobs` row (`type='catalog_sync'`,
  CD-3). Conflict resolution (keep local / take Meta / merge) is applied by the client against the job's
  result then re-committed via `PATCH /api/v1/products/:id`. Connection state lives in
  **`merchants.settings.metaCatalog`** (`{ catalogId, connected, tokenRef, lastSyncedAt }`, CD-13).
- **Conflict handling:** for each differing item show side-by-side and let merchant choose **Keep local /
  Take Meta / Merge (field-level)**. Bulk actions for "new in Meta" (import) and "missing in Meta"
  (deactivate or keep local-only).
- **States:** not-connected (CTA); connecting (OAuth/Graph); syncing (progress); conflicts pending (list);
  synced (success, timestamp); error (token expired → reconnect, permission missing).
- **Edge cases:** price in Meta is decimal currency → convert to paisa; product exists locally without
  `external_ref` (fuzzy-match by name to offer linking); Meta rate limits; deletions in Meta
  (soft-deactivate locally, never hard-delete referenced products).

### 5.5 Categories — `/catalog/categories`
- **Purpose:** manage `product_categories`.
- **Access:** owner/manager.
- **Layout:** simple list with inline add/edit + drag-to-reorder (`sort_order`); each row shows name +
  product count.
- **Data:** `product_categories` (`name`, `sort_order`), count of `products.category_id`.
- **Actions → API:** `GET/POST/PATCH/DELETE /api/v1/product-categories`; reorder → `PATCH …/:id` with new
  `sortOrder`.
- **States:** loading; empty ("No categories — add one to organize your catalog"); error.
- **Validation:** name required, unique per merchant; deleting a category with products → prompt
  "Move products to Uncategorized?" (set `category_id=null`), never orphan.
- **Edge cases:** reorder persistence; long names truncate.

---

## 6. Orders

### 6.1 Order list — `/orders`
- **Purpose:** find and manage orders.
- **Access:** all view; owner/manager/staff act on status; payment verify per matrix.
- **Layout:** `<FilterBar/>` + `<DataTable/>` (or card list on mobile). Optional saved tabs:
  All / Needs action / Awaiting payment / Preparing / Dispatched.
```
[Search #/name/phone]  Status ▾  Payment ▾  Date range ▾  Method(COD/Bank) ▾   [Export]
Order     Customer   Total     Status              Payment        Placed        ⋯
#SK-1042  Ali        Rs.3,200  ● confirmed         claimed        2:14 PM       ⋯
#SK-1041  Sara       Rs.1,800  ● awaiting_payment  cod_pending    1:02 PM       ⋯
```
- **Data:** `orders` (`order_number`, `customer_id`→name, `total`, `status`, `payment_status`,
  `payment_method`, `placed_at`/`created_at`). Search over order_number, `delivery_name`,
  `delivery_phone`, customer name/wa_id.
- **Actions → API:** `GET /api/v1/orders?status=&payment_status=&method=&from=&to=&search=&page=`. Row
  click → detail. Quick row action ⋯: confirm, mark dispatched, cancel (guarded), view slip. Confirm/
  dispatch use `POST /api/v1/orders/:id/status`; cancel uses `POST /api/v1/orders/:id/cancel`. (No
  dedicated CSV export endpoint exists in doc 03 §6; client-side export of the fetched page only.)
- **States:** loading (skeleton); empty-first-run ("No orders yet — orders from WhatsApp appear here");
  filtered-empty; error.
- **Realtime:** new orders appear on top; status/payment changes update rows live; "Needs action" count
  updates.
- **Edge cases:** `draft` orders (bot still building) — hidden by default or shown greyed; timezone in
  date filter; big lists paginate.

### 6.2 Order detail — `/orders/:id`
- **Purpose:** full order view + fulfillment actions + payment handling.
- **Access:** view all; status actions owner/manager/staff; payment verify/reject + edit totals per matrix
  (owner/manager).
- **Layout:**
```
┌ Header: #SK-1042  ● confirmed   payment: claimed        [Confirm][Preparing][Dispatched][Delivered]  [Cancel ⋯] │
├───────────────────────────────┬───────────────────────────────────────────────┐
│ Items                         │  Customer & Delivery                          │
│  Kurta (M)  x2  Rs.1,500  -150│   Ali  03xx-xxxxxxx                            │
│  Shawl      x1  Rs.2,200      │   House 5, Gulberg, Lahore                     │
│  ─────────────────────────    │   Zone: Gulberg  ETA 2 days  charge Rs.200    │
│  Subtotal    Rs.5,200         │   [Open chat →] (conversation_id)             │
│  Discount   -Rs.150           ├───────────────────────────────────────────────┤
│  Delivery   +Rs.200           │  Payment panel                                │
│  Total       Rs.5,250         │   Method: bank_transfer  Status: claimed      │
│  [Edit order]                 │   [🖼 view screenshot]  Ref: TX123            │
├───────────────────────────────┤   [ ✓ Verify ]  [ ✗ Reject ]                 │
│ Timeline (order_status_history)│  (COD): [ Mark COD collected ]               │
│  • confirmed by bot  2:14 PM  │                                               │
│  • pending_confirmation 2:12  ├───────────────────────────────────────────────┤
│                               │  Order slip:  [ View ] [ Download ] [ Resend ]│
└───────────────────────────────┴───────────────────────────────────────────────┘
```
- **Data:** `orders` (all fields incl. `payment_locked`, CD-5), `order_items` (`name_snapshot`,
  `unit_price`, `quantity`, `discount`, `negotiated_discount` (CD-7), `line_total`), `customers`
  (name/phone) + delivery_* fields, `payments` (current-state row: method, amount, status, `reference`,
  `claimed_at`/`verified_at`/`verified_by_user_id`, `cod_collected_at`, `rejection_reason`),
  **`payment_claims`** (full claim history — one row per submitted screenshot: `screenshot_url`,
  `reference`, `amount`, `status[claimed|verified|rejected]`, `rejection_reason`, `claimed_at`,
  `decided_at`, `decided_by_user_id`, CD-4), `order_status_history` (from/to/changed_by/user/note/time),
  `slip_url`, `conversation_id` (link to Inbox), `delivery_zones` (matched zone for charge/ETA).
- **Screenshot URLs are minted on demand (CD-40):** the payment panel does **not** hold a stored signed
  URL. When the viewer opens a screenshot (after the role/RLS check), the client requests a **short-lived,
  single-use signed URL** for that `payment_claims` row and opens it; the URL is never persisted in
  `notifications` (which carry only `orderId`/`paymentId`). Staff never see this control (per §1.6).
- **Order lifecycle (CD-15):** the header reflects the canonical `order_status` machine (doc 03 §4):
  `draft → pending_confirmation → confirmed → awaiting_payment → paid → preparing → dispatched →
  delivered` (+ `cancelled`/`returned`). Materialization: cart lives in `conversations.context` until the
  bot writes an `orders(status='draft')` on entering delivery collection; `draft→pending_confirmation` on
  payment-method selection; `pending_confirmation→confirmed` on the buyer's explicit final confirm (assigns
  `order_number`, `placed_at`, slip, stock decrement, `new_order`). The detail page shows `draft`/
  `pending_confirmation` orders as still-forming.
- **Actions → API & status transitions** (POST, canonical routes):
  - **Confirm** (`pending_confirmation`→`confirmed`): `POST /api/v1/orders/:id/status { to: 'confirmed' }`.
  - **Mark preparing/dispatched/delivered:** same endpoint with target status; the server enforces the
    legal-transition table (doc 03 §4) and role (returns `409 INVALID_STATE_TRANSITION` otherwise).
  - **Cancel** (`→cancelled`): `POST /api/v1/orders/:id/cancel { cancelledReason }` → writes
    `cancelled_reason`, history row; may trigger buyer notification.
  - **Edit order** (`/orders/:id/edit` or drawer): change quantities, add/remove items, adjust discount,
    delivery zone/charge; recompute `subtotal`/`total` via `PATCH /api/v1/orders/:id` and the item
    sub-routes (`POST/PATCH/DELETE /api/v1/orders/:id/items[/:itemId]`). **Edit guard (CD-15):** edits are
    only allowed while `draft`/`pending_confirmation`; once payment is claimed/verified or COD collected the
    order is **`payment_locked`** — editing is blocked and requires an explicit **re-request** (reject the
    claim / re-open) before totals can change. The server returns `409 INVALID_STATE_TRANSITION` on a locked edit.
  - **Payment panel (all POST, CD-26):** **Verify** → `POST /api/v1/orders/:id/payment/verify` (sets
    `payments.status=verified`, `verified_at`, `verified_by_user_id`, `orders.payment_status=verified`,
    order→`paid`; triggers buyer confirmation — see [08-payments-notifications.md](08-payments-notifications.md)).
    **Reject** → `POST /api/v1/orders/:id/payment/reject { rejectionReason }` (sets `failed` — a resting
    state; a new buyer screenshot moves `failed→claimed`). **Mark COD collected** →
    `POST /api/v1/orders/:id/payment/cod-collected` (`cod_pending`→`cod_collected`, stamps
    `cod_collected_at`). **Verify/Reject are owner/manager only** (staff `403`, §1.6); **Mark COD
    collected is allowed for staff.** Each decision writes a `payment_claims` history row.
  - **Slip:** View/Download signed `slip_url` via `GET /api/v1/orders/:id/slip`; **(Re)generate** →
    `POST /api/v1/orders/:id/slip`. (There is no separate slip-resend route in doc 03 §6; re-sending to the
    buyer over WhatsApp is a side-effect of regeneration / the confirmation flow.)
- **States:** loading; action-in-progress (button spinner, optimistic + realtime confirm); success (toast +
  timeline row appears); error (transition not allowed, payment already verified). Empty payment (unset) →
  show "No payment recorded yet".
- **Validation:** can't verify when no screenshot for bank_transfer (warn but allow if reference given?);
  can't set delivered before dispatched (⚠️ decide strictness); cancel requires reason; edit totals must
  stay ≥ 0; editing after `dispatched` warns.
- **Edge cases:** buyer sends a new payment screenshot after rejection → `failed→claimed`; the payment
  panel shows the **claim history from `payment_claims`** (CD-4) with the latest as the actionable one
  (`payments` remains the current-state pointer). Concurrent edit (two staff) → realtime + optimistic-lock
  warning; verify/reject/claim are serialized server-side (`SELECT … FOR UPDATE` + state guard, CD-20).
  Out-of-window buyer confirmation falls back to template (see §14). Slip missing (`slip_url` null) →
  "Generate slip" action.

---

## 7. Inbox / Conversations (live chat) — `/inbox`, `/inbox/:conversationId`

- **Purpose:** monitor bot conversations, take over, chat as human, act on the buyer.
- **Access:** all roles send/takeover; block customer owner/manager (per matrix).
- **Layout (desktop 3-pane):**
```
┌ Conversations ─────────┬ Chat: Ali (03xx…)  ● bot_active ─────────────┬ Customer ───────────┐
│ [Search]  All▾ Unread▾ │  ┌ order draft: Kurta x2 • Rs.3,050 (draft) ┐ │  Ali                │
│ ● Ali    2m  "kitne ka"│  │ negotiation: round 2/4, last offer 2,900│ │  03xx-xxxxxxx       │
│   Sara  10m  ✓ human   │  └──────────────────────────────────────────┘ │  Lahore • Gulberg   │
│   Bilal  1h  bot       │  ────────────────────────────────────────────  │  Orders: 4          │
│                        │  Ali:  "assalam o alaikum, kurta available?"   │  Spent: Rs.22,300   │
│                        │  Bot:  "wa alaikum salam! ji available…"       │  Tags: [VIP]        │
│                        │  Ali:  "2900 me dedo"                           │  Notes: …           │
│                        │  [🖼 screenshot]                                │  [Create order]     │
│                        │  ───────────────────────────────────────────   │  [Block customer]   │
│                        │  [ TAKE OVER ]  or  when human: [Release ▾]     │                     │
│                        │  [type…] [📎] [template ▾]              [Send]  │                     │
└────────────────────────┴────────────────────────────────────────────────┴─────────────────────┘
```
- **Conversation list:** `conversations` ordered by `last_message_at` desc; each item: customer name/wa_id,
  last message snippet, relative time, **unread badge** (`unread_count`), **status chip**
  (`bot_active`/`human_takeover`/`closed`), 24h-window indicator (green=open, grey=expired/needs template).
  Filters: All / Unread / Human takeover / Bot / Closed; search by name/wa_id.
- **Chat view:** `messages` for the conversation (paginated/infinite scroll up), each with
  `direction`/`sender` (customer left; bot/agent/system right, distinct styling — bot vs agent labeled),
  `type` rendering (text, image/media via `media_url`, template, document, interactive, location, audio),
  `status` ticks for outbound (`queued`/`sent`/`delivered`/`read`/`failed`), timestamps.
- **Context panel (top of chat):** current **order draft** (from `conversations.context` / linked draft
  `orders`) and **negotiation context** (active `negotiations`: product, round/`roundsMax`,
  `last_bot_offer`, `last_customer_offer`, `floor_price`, `status`). Read-only, helps the human decide.
- **Customer sidebar:** `customers` (name, wa_id, area/city, `total_orders`, `total_spent`, `tags`,
  `notes`, `is_blocked`). Quick actions: **Create order** (opens order draft prefilled with customer +
  current negotiation), **Block customer**.
- **Take over / release (CD-19):**
  - **TAKE OVER** → `POST /api/v1/conversations/:id/takeover` sets `status='human_takeover'`,
    `assigned_user_id`, and **mirrors state server-side**: saves `context.resume_state = current_state`
    then sets `current_state='handoff'`, pausing the bot (also triggered implicitly the moment an agent
    sends a message into a `bot_active` chat — see [05-bot-flows.md](05-bot-flows.md) §handoff).
  - **Release to bot** → `POST /api/v1/conversations/:id/release` sets `status='bot_active'`, clears the
    assignee, and **restores `current_state = context.resume_state`**, resuming the bot.
  - While in `human_takeover`, inbound short-circuits **before** state routing: a buyer's screenshot is
    stored but **NOT auto-claimed** as payment (CD-19) — an agent must record the claim explicitly.
- **Send message:** text / image (upload → `media_url`) / **template picker** (approved `message_templates`
  only; required if window expired). `POST /api/v1/conversations/:id/messages {type, body|media|template}`.
  Outbound persisted as `messages` with `sender='agent'`.
- **Actions → API summary:** `GET /api/v1/conversations?...`, `GET /api/v1/conversations/:id/messages`,
  send/takeover/release (above), `POST /api/v1/customers/:id/block`, `POST /api/v1/orders` (create from
  chat). **Block customer is owner/manager only** (staff `403`, §1.6).
- **States:** loading (list + chat skeletons); empty (no conversations → "When buyers message your
  WhatsApp, chats show here"); no-selection (empty right pane "Select a conversation"); sending (optimistic
  bubble → confirmed/failed with retry); error (send failure, window expired → prompt to use template).
- **Realtime:** new inbound messages append live + reorder list + bump unread; opening a conversation marks
  read (`unread_count=0`, `POST /api/v1/conversations/:id/read`); `status` flips reflect instantly (e.g.,
  another agent took over).
- **Validation:** can't send free-form when window expired (`window_expires_at < now`) → force template
  picker; empty message blocked; media size/type limits; can't send on a `closed`/blocked conversation
  without reopening.
- **Edge cases:** buyer is blocked (`is_blocked`) → banner + sending disabled; two agents open same chat
  (realtime presence / "X is viewing" ⚠️ PROPOSED); very long history (virtualized); failed template
  (`PAUSED`/`REJECTED`) → fallback + alert; bot needs help (`bot_needs_help` notification) surfaces a
  "Bot asked for help" banner with one-tap takeover.

---

## 8. Customers (CRM)

### 8.1 Customer list — `/customers`
- **Purpose:** see all buyers.
- **Access:** all view; edit/block per matrix.
- **Layout:** search + filters (blocked, tag, city) + table/cards.
```
[Search name/phone]  Tag ▾  City ▾  ☐ Blocked only
Name   Phone(wa_id)   City     Orders  Spent      Last seen   Tags        ⋯
Ali    03xx…          Lahore   4       Rs.22,300  2m ago      [VIP]       ⋯
```
- **Data:** `customers` (`name`, `wa_id`, `city`/`area`, `total_orders`, `total_spent`, `last_seen_at`,
  `tags`, `is_blocked`).
- **Actions → API:** `GET /api/v1/customers?search=&tag=&city=&blocked=`. Row ⋯: open detail, open chat,
  block/unblock.
- **States:** loading; empty ("No customers yet"); filtered-empty; error.
- **Edge cases:** dedupe by `(merchant_id, wa_id)` unique; masked/formatted phone display.

### 8.2 Customer detail — `/customers/:id`
- **Purpose:** single-customer profile + history.
- **Access:** view all; edit notes/tags + block per matrix.
- **Layout:** header (name, wa_id, city, blocked chip) + stats (orders, spend, first/last seen) +
  tabs/sections: **Orders** (list of their `orders`), **Conversations** (link to chat), **Notes**
  (editable `notes`), **Tags** (chip editor).
- **Data:** `customers` + related `orders` (order_number/total/status) + `conversations`.
- **Actions → API:** `GET /api/v1/customers/:id`, `PATCH /api/v1/customers/:id` (name/notes/tags),
  `POST /api/v1/customers/:id/block` / `/unblock`, "Open chat" → Inbox.
- **States:** loading; error; success toasts on save.
- **Validation:** tags trimmed/deduped; notes length limit.
- **Edge cases:** blocking a customer with an open conversation (also pauses/handles bot?); totals are
  denormalized (`total_orders`/`total_spent`) — show "recalculating" if a job updates them.

---

## 9. Negotiation settings — `/settings/negotiation`

- **Purpose:** set the global deterministic negotiation policy (the LLM never sets prices — see
  [00-overview.md](00-overview.md) principle 1 and [06-negotiation-engine.md](06-negotiation-engine.md)).
- **Access:** owner edit; manager read; staff hidden.
- **Layout:** form editing `merchants.negotiation_defaults` jsonb + an explainer + a **worked example
  simulator**.
```
Global negotiation defaults
  Max discount %        [ 10 ]   ← lowest = list price − this %
  Min margin %          [  5 ]   (optional; uses product.cost if set)
  Concession steps      [ .4,.7,1 ] cumulative fractions 0→1 of the list→floor gap (CD-13)
  Max rounds            [  4 ]   after this, bot holds firm / offers best price
  Auto-accept at floor  [ ☑ ]    accept immediately if buyer offers ≥ floor
Explainer: "The bot will start at list price and can go as low as the floor. It never goes below."
Simulator: List Rs.[1000] Max 10% → Floor Rs.900. Buyer offers 850 → bot counters 920 → …
```
- **Data:** `merchants.negotiation_defaults` = `{ maxDiscountPct, minMarginPct?, concessionSteps,
  roundsMax, autoAcceptAtFloor }` (exact keys from [02-data-model.md](02-data-model.md)).
- **Per-product overrides:** explained here, but **edited on the product page** (§5.2): `products.negotiable`,
  `products.max_discount_pct` (overrides `maxDiscountPct`), `products.min_price` (absolute floor, **wins
  over pct**). Precedence: `min_price` > product `max_discount_pct` > merchant `maxDiscountPct`;
  `minMarginPct` uses `product.cost`. Show this precedence order explicitly with the effective-floor preview.
- **Actions → API:** `PATCH /api/v1/negotiation-settings` (or `PATCH /api/v1/merchant`); per-product
  overrides via `PATCH /api/v1/negotiation-settings/products/:productId`.
- **States:** loading; saving; success; error.
- **Validation:** maxDiscountPct 0–100; roundsMax ≥ 1 integer; concessionSteps positive; if minMarginPct
  set without product cost, warn it won't apply to costless products.
- **Edge cases:** changing defaults doesn't retro-change in-flight `negotiations` (they snapshot
  `floor_price` at creation — see [06-negotiation-engine.md](06-negotiation-engine.md)); `concessionSteps`
  are **cumulative fractions 0→1 of the list→floor gap** (canonical, CD-13), not Rs or %.

---

## 10. Bot training — `/settings/bot`

- **Purpose:** shape the bot's persona and knowledge (phrasing/knowledge only — never pricing).
- **Access:** owner/manager edit (persona owner-only? ⚠️ decide); staff hidden.
- **Layout:** two areas — **Persona** (edits `merchants.bot_persona`) and **Knowledge**
  (CRUD `bot_knowledge`).
```
Persona
  Bot name     [ Ali Bot ]        Tone [ friendly ▾ ]   Language [ roman_urdu ▾ ]
  Greeting     [ Assalam o alaikum! … ]        (live WhatsApp preview →)
  Business info[ We sell … open 10-8 … ]       Signature [ – Team ChandBagh ]

Knowledge (FAQs & policies)                                   [ + Add ]
  Type      Question / Title            Answer               Active   ⋯
  faq       "Delivery kitne din?"       "2-3 din Lahore…"    ☑        ⋯
  policy    Return policy               "7 din return…"      ☑        ⋯
  shipping  Shipping info               "…"                  ☑        ⋯
```
- **Data:** `merchants.bot_persona` (name, tone, greeting, business_info, language, signature/style);
  `bot_knowledge` (`type` ∈ faq/business_info/policy/shipping/custom, `question?`, `answer`, `is_active`).
- **Actions → API:** `PATCH /api/v1/merchant` (persona); `GET/POST/PATCH/DELETE /api/v1/bot-knowledge`.
- **States:** loading; saving; empty knowledge ("Add FAQs so the bot can answer common questions"); error.
- **Validation:** greeting non-empty + length; FAQ needs question+answer; policy/shipping need answer;
  language ∈ `lang` enum.
- **Edge cases:** very long knowledge base (retrieval/embedding — `bot_knowledge.embedding` reserved for
  later); duplicate FAQs; toggling `is_active` excludes from bot context; special chars/Urdu script.

---

## 11. Payment settings — `/settings/payments`

- **Purpose:** manage the merchant's own bank accounts shown to buyers, COD toggle, and instructions text.
- **Access:** owner edit; manager read; staff hidden.
- **Layout:**
```
Accept payments
  ☑ Cash on Delivery (COD)
  ☑ Bank transfer (screenshot verification)

Bank accounts (shown to buyers for transfers)                      [ + Add account ]
  ⭐ Meezan • Ali Traders • PK..1234 • Main Branch     Active   [Set default][Edit][Deactivate]
     HBL   • Ali Traders • ..5678                       Active   [Set default][Edit][Deactivate]

Payment instructions (sent with bank details)
  [ "Transfer to the account below and send a screenshot. We'll confirm within minutes." ]
```
- **Data:** `bank_accounts` (`bank_name`, `account_title`, `account_number`, `iban?`, `branch?`,
  `is_default`, `is_active`); COD flag + instructions text in `merchants.settings.codEnabled` /
  `merchants.settings.paymentInstructions` (canonical keys, CD-13).
- **Access (CD-37):** owner/manager may CRUD bank accounts; **staff cannot** — bank-account writes return
  `403` for `staff`. This whole screen is hidden from staff.
- **Actions → API:** `GET/POST/PATCH/DELETE /api/v1/bank-accounts` (owner/manager); set-default →
  `PATCH /api/v1/bank-accounts/:id { isDefault: true }` (server unsets others);
  `PATCH /api/v1/merchant { settings: { codEnabled, paymentInstructions } }` for COD + instructions.
- **States:** loading; empty ("Add a bank account so buyers can pay by transfer"); success; error.
- **Validation:** at least one active account required if bank transfer enabled; account_number/IBAN format;
  can't deactivate the only account while bank transfer on; exactly one default among active.
- **Edge cases:** deactivating the default → auto-promote another or force pick; both COD and bank off →
  warn (bot can't collect payment); IBAN optional but validated when present.

---

## 12. Delivery settings — `/settings/delivery`

- **Purpose:** manage delivery zones and charges the bot quotes.
- **Access:** owner/manager edit; staff hidden.
- **Layout:** table of `delivery_zones` + global defaults.
```
Default delivery charge  Rs.[200]    Free delivery over Rs.[5000]  (0 = off)   [ + Add zone ]
Area           City     Charge    Serviceable  ETA          ⋯
Gulberg        Lahore   Rs.150    ☑            "1-2 days"   ⋯
DHA            Karachi  Rs.250    ☑            "2-3 days"   ⋯
Interior Sindh —        —         ☐ (not serviceable)       ⋯
```
- **Data:** `delivery_zones` (`area_name`, `city`, `charge`, `is_serviceable`, `eta_text`); default charge
  + free-delivery threshold in `merchants.settings.defaultDeliveryCharge` /
  `merchants.settings.freeDeliveryThreshold` (canonical keys, CD-13).
- **Actions → API:** `GET/POST/PATCH/DELETE /api/v1/delivery-zones`;
  `PATCH /api/v1/merchant { settings: { defaultDeliveryCharge, freeDeliveryThreshold } }` for defaults.
- **States:** loading; empty ("Add delivery zones; the bot uses these to quote charges & ETA"); success;
  error.
- **Validation:** area_name + city required; charge ≥ 0; unique (area,city) per merchant; ETA free text.
- **Edge cases:** address not matching any zone → bot uses default charge (document that behavior);
  not-serviceable zones → bot declines delivery there; free-delivery threshold overrides zone charge.

---

## 14. Templates — `/settings/templates`

- **Purpose:** manage WhatsApp message templates (needed to message buyers outside the 24h window — see
  [00-overview.md](00-overview.md) glossary, [04-whatsapp-integration.md](04-whatsapp-integration.md)).
- **Access:** owner/manager; staff hidden.
- **Layout:** list + create/edit drawer.
```
Templates                                                            [ + Create template ]
Name                 Category      Language   Status      ⋯
order_confirmation   utility       ur/en      ● approved  ⋯
payment_received     utility       ur         ● approved  ⋯
promo_eid            marketing     ur         ✗ rejected  ⋯  ← "reason: promotional wording"
delivery_update      utility       ur         ○ pending   ⋯
```
- **Data:** `message_templates` (`name`, `category` ∈ utility/marketing/authentication, `language`,
  `body_json` (components), `status` ∈ draft/pending/approved/rejected/paused/disabled, `wa_template_id`,
  `rejection_reason`).
- **Create/Edit form:** name (snake_case, WA rules), category, language, body components (header/body/
  footer/buttons) with **variable placeholders** ({{1}} etc.) + live preview; **Submit for approval**.
- **Actions → API:** `GET /api/v1/message-templates`; `POST /api/v1/message-templates` (draft);
  `PATCH /api/v1/message-templates/:id`; `POST /api/v1/message-templates/:id/submit` (→ Meta, status
  `pending`); `GET /api/v1/message-templates/:id/status` (refresh from Meta);
  `DELETE /api/v1/message-templates/:id`. Status updates also arrive via webhook → `template_status`
  notification.
- **States:** loading; empty ("Create templates to reach buyers after 24h"); statuses rendered as badges;
  rejected shows `rejection_reason` inline + "Edit & resubmit"; error.
- **Validation:** name lowercase+underscores unique; category chosen; body non-empty; variable count/format
  valid; can't edit an `approved` template's locked fields (must clone/resubmit).
- **Edge cases:** Meta approval latency (pending state); `paused` (quality drop) → warning + fallback;
  `disabled`; deleting an approved template used by the bot → warn it breaks out-of-window flows; language
  variants of same name.

---

## 13. Analytics — `/analytics`

- **Purpose:** business + bot performance insight.
- **Access (CD-37):** owner/manager (R) see everything. **Staff** may view non-margin analytics but the
  server **strips cost/margin figures** for `role='staff'` (any per-product profit, margin %, or
  cost-derived metric is removed before the payload leaves the server); the negotiation analytics endpoint
  is owner/manager only (doc 03 §2.20).
- **Layout:** date-range picker (Today/7d/30d/custom) + chart grid + tables.
```
[ Last 30 days ▾ ]
┌ Sales over time (line) ─────────┐ ┌ Orders by status (bar/donut) ┐
└─────────────────────────────────┘ └──────────────────────────────┘
┌ Top products (table) ───────────┐ ┌ Negotiation ─────────────────┐
│ Kurta  42 sold  Rs.63k          │ │ Win-rate 62%  Avg disc 6.4%  │
└─────────────────────────────────┘ └──────────────────────────────┘
┌ COD vs Bank (donut) ────────────┐ ┌ Response & RTO ──────────────┐
│ COD 55% • Bank 45%              │ │ Avg first-response 40s        │
└─────────────────────────────────┘ │ RTO/cancel rate 8%           │
                                     └──────────────────────────────┘
```
- **Metrics & sources (canonical definitions, CO-18 — same as Dashboard §4):**
  | Metric | Source / definition |
  |---|---|
  | Revenue — collected | sum(`orders.total`) for orders whose payment is `verified` or `cod_collected`, bucketed by day (merchant tz) |
  | Revenue — gross/placed | sum(`orders.total`) for confirmed+ orders (reported separately from collected) |
  | Orders count | orders that reached **confirmed or later** (excludes `draft`/`pending_confirmation`/`cancelled`) |
  | AOV | collected revenue ÷ collected-orders count over range |
  | Top products | `order_items` units/revenue by `product_id` |
  | Orders by status | count of `orders` per `order_status` |
  | Negotiation win-rate | `negotiations` agreed/(agreed+rejected+abandoned) |
  | Avg discount given | per order, sum(`order_items.negotiated_discount`+`discount`) ÷ `subtotal`; reported as the mean across orders |
  | COD vs bank | `orders.payment_method` split |
  | Response metrics | first bot/agent reply latency from `messages` timestamps |
  | RTO / cancel rate | (`returned` + `cancelled`) ÷ orders **placed** in range |
- **Actions → API (canonical, doc 03 §6):** `GET /api/v1/analytics/summary?from=&to=` (headline KPIs),
  `GET /api/v1/analytics/timeseries?from=&to=&granularity=day|week|month` (time series + `byCity`/
  `byPaymentMethod`/`byStatus`), `GET /api/v1/analytics/top-products?from=&to=`,
  `GET /api/v1/analytics/negotiations?from=&to=` (owner/manager only).
- **States:** loading (chart skeletons); empty ("Not enough data yet"); error (per-widget); export CSV per
  chart ⚠️ PROPOSED.
- **Edge cases:** timezone bucketing; small-sample win-rate noise; margin metrics need `products.cost`
  (hide if absent); currency formatting; hide cost from staff.

---

## 15. Team — `/settings/team`

- **Purpose:** manage `merchant_users` — invite teammates, set roles, deactivate.
- **Access:** **owner only** (W); others hidden.
- **Layout:** table + invite modal.
```
Team                                                              [ + Invite member ]
Name     Email             Role      Status     Last login    ⋯
Ali (you)ali@…             owner     active     now           —
Sara     sara@…            manager   active     2h ago        [Change role][Deactivate]
Bilal    bilal@…           staff     invited    —             [Resend invite][Revoke]
```
- **Data:** `merchant_users` (`name`, `email`, `role`, `is_active`, `last_login_at`) + invite state.
- **Actions → API (canonical, doc 03 §2.3):** `GET /api/v1/team`; **Invite** →
  `POST /api/v1/team/invite { name, email, role }` (creates the Supabase Auth invite + pending
  `merchant_users` row → §2.4); **Change role / rename** → `PATCH /api/v1/team/:id { role }`;
  **Deactivate/Reactivate** → `PATCH /api/v1/team/:id { isActive }`; **Revoke a pending invite** →
  `DELETE /api/v1/team/:id` (soft, never hard-deletes auth). Re-inviting re-issues via
  `POST /api/v1/team/invite`. (No separate `/team/invites/*` sub-resource exists in doc 03 §6.)
- **States:** loading; success; error (duplicate email); "invited" vs "active" status chips.
- **Validation:** email valid + not already a member; role ∈ `user_role`; can't remove/deactivate the last
  owner; can't demote yourself if you're the sole owner.
- **Edge cases:** re-inviting a deactivated user (reactivate instead); invite to an email that later signs
  up separately; owner transfer (⚠️ PROPOSED flow); seat limits (billing later).

---

## 16. Notifications center — `/settings/notifications` (+ bell dropdown)

- **Purpose:** central list of `notifications`; quick triage from the bell.
- **Access:** all roles (their own + merchant-wide portal notifications).
- **Layout:** bell dropdown (recent 10 + "See all") and a full page (filter by type, unread toggle,
  mark-all-read).
```
Notifications                        [ Unread only ☐ ]  [ Mark all read ]
● new_order      "Order #SK-1042 placed"        2m   → /orders/…
● payment_claim  "Ali sent payment proof"       5m   → /orders/…
  bot_needs_help "Bot stuck on chat w/ Sara"    1h   → /inbox/…
  low_stock      "Kurta (M) 2 left"             3h   → /catalog/…
  template_status"promo_eid rejected"           1d   → /settings/templates
```
- **Data:** `notifications` (`type` ∈ new_order/payment_claim/takeover_request/bot_needs_help/low_stock/
  template_status/system, `title`, `body`, `data` (deep-link payload — **ids only**, e.g.
  `{ orderId, paymentId }`; **never** a stored signed screenshot URL, CD-40), `channel`, `read_at`).
  Portal shows `channel='portal'` primarily.
- **Actions → API:** `GET /api/v1/notifications?unread=true&type=`;
  `GET /api/v1/notifications/unread-count` (bell badge); `POST /api/v1/notifications/:id/read`;
  `POST /api/v1/notifications/read-all`. Click → deep-link via `data`; a screenshot is fetched via a
  freshly-minted signed URL at view time (CD-40), not from the notification.
- **States:** loading; empty ("You're all caught up"); error; unread emphasized (bold + dot).
- **Realtime:** new notifications appear live; bell count decrements on read.
- **Edge cases:** stale deep-link (entity deleted → graceful message); high volume (paginate + group by
  day); per-user vs merchant-wide (`user_id` null = broadcast).

---

## 17. Settings — Business profile / WhatsApp / Account — `/settings/business`

- **Purpose:** edit business profile, view WhatsApp connection health, account, billing placeholder.
- **Access:** owner edit business/WhatsApp; manager read; billing owner-only.
- **Layout (tabs or sections):**

**Business profile** — `merchants` (`business_name`, `owner_name`, `phone`, `email`, `timezone`,
`currency`, `default_language`, `business_hours`). API: `PATCH /api/v1/merchant`.

**WhatsApp connection & health** — `whatsapp_numbers`:
```
Number: Ali Store  +92 3xx …   Status ● connected
Quality rating: GREEN     Messaging tier: tier_1     Verified name: approved
[ Refresh status ]   [ Disconnect ]                   Last checked 1m ago
```
Fields (typed enums, CD-9): `display_name`, `phone_e164`, `phone_number_id`, `waba_id`,
`quality_rating[green|yellow|red|unknown]`, `messaging_tier[unverified|tier_1..tier_4]`,
`verified_name_status`, `status`, `flag_reason[quality|token|policy|manual|null]`. API:
`GET /api/v1/whatsapp-numbers/:id` (detail), `GET /api/v1/whatsapp-numbers/:id/status` (live Graph probe),
`PATCH /api/v1/whatsapp-numbers/:id` (rename / set `disconnected`). Realtime updates on
`quality_rating`/`messaging_tier`/`flag_reason`/`status` over the `whatsapp_numbers` channel (CD-2/9/29);
warning banner if `flagged`/quality drops (a `red` rating auto-pauses proactive sends, CD-42). See
[04-whatsapp-integration.md](04-whatsapp-integration.md).

**Account** — change email (Supabase), change password (link), sign out of all sessions,
delete account (owner, guarded, ⚠️ PROPOSED soft-delete).

**Billing (placeholder)** — `merchants.plan` (`pilot`/`basic`/`pro`) read-only badge + "Billing coming
soon" (deferred per [00-overview.md](00-overview.md) out-of-scope). No payment UI at launch.

- **States:** loading; saving; success; error. **Validation:** business_name required; email valid+unique;
  timezone valid; phone format. **Edge cases:** changing timezone shifts "today" everywhere (warn);
  currency locked to PKR at launch; disconnecting WhatsApp stops the bot (confirm dialog); email change
  requires re-verification.

---

## 18. Cross-cutting states & patterns

- **Empty-first-run** (brand-new merchant, pre/just-post onboarding): every list screen has a tailored
  empty state with the primary CTA (Add product, share your number, etc.) and a persistent "Finish setup"
  banner until `merchants.settings.onboardingCompletedAt` is set (CD-13).
- **Loading:** skeletons (not spinners) for tables/cards; optimistic UI for chat sends and status changes,
  reconciled by realtime/response.
- **Error:** inline field errors on forms; page-level retry banners for failed fetches; toast for action
  failures with a "Retry"; never blank a whole screen on a partial failure.
- **Success:** toasts + immediate optimistic reflection; timeline/history rows where relevant.
- **Permission-blocked:** hidden nav items + 403 fallback page ("You don't have access — ask the owner")
  for direct-URL access below your role.
- **Offline / realtime disconnect:** subtle banner + polling fallback; queued chat sends retry on
  reconnect.
- **Money & locale:** all amounts via `formatPKR`; dates in merchant timezone; numbers en-PK grouping.

---

## 19. Assumptions & audit resolutions

**Assumptions (still current)**
- KPIs come from `GET /api/v1/dashboard/summary` + `GET /api/v1/analytics/summary`; time series/breakdowns from `GET /api/v1/analytics/*`
  (doc 03 §2.20) to avoid client N+1.
- Path C connects the WhatsApp number **operator-assisted via Cloud API** → the onboarding "connect number"
  step is status + instructions, **not** a QR scan (QR implies unofficial transport, out of scope — CD-42).
- Portal auth = Supabase; every user row = one `merchant_users` with a `merchant_id` JWT claim.
- Bot on/off is `merchants.settings.botEnabled` (kill-switch, CD-33); onboarding completion is
  `merchants.settings.onboardingCompletedAt` (CD-13).

**Audit resolutions (previously flagged gaps — now canonical in docs 02/03/10)**
1. **Permission matrix (CD-37):** ratified — doc 09's strictest matrix. Staff **cannot** verify/reject
   payments, CRUD bank accounts, or see `cost`/margin/`raw`; enforced at the route guard **and** by
   server-side field-stripping. Encoded in §1.6.
2. **`merchants.settings` keys (CD-13):** canonical camelCase keys — `botEnabled`, `codEnabled`,
   `paymentInstructions`, `defaultDeliveryCharge`, `freeDeliveryThreshold`, `lowStockThreshold`,
   `onboardingCompletedAt`, `metaCatalog{catalogId,connected,tokenRef,lastSyncedAt}`, `notificationPrefs`.
3. **Import/sync jobs (CD-3):** durable in `background_jobs` (`type ∈ product_import|catalog_sync`); polled
   via `GET /api/v1/products/import/:jobId` and `.../catalog-sync/:jobId`.
4. **Meta catalog storage (CD-13/CD-28):** `merchants.settings.metaCatalog`.
5. **Payment claims (CD-4):** `payment_claims` child table preserves full history; `payments` is the
   current-state pointer. `failed→claimed` on a re-sent screenshot (CD-18).
6. **Order status transition table (CD-15):** canonical in doc 03 §4; `delivered` requires prior
   `dispatched`; edit blocked when `payment_locked`.
7. **`concessionSteps` unit (CD-13):** cumulative fractions 0→1 of the list→floor gap.
8. **API alignment (CD-26):** doc 03 §6 is the canonical route table; all references here match it.
9. **Realtime publication list (CD-29):** `conversations, messages, orders, payments, notifications,
   negotiations, whatsapp_numbers` — all in §1.5 / doc 03 §5.
10. **Slip:** `POST /api/v1/orders/:id/slip` (re)generates; buyer re-send is a side-effect of the
    confirmation flow (doc 08). No separate resend route.
11. **Screenshot hygiene (CD-40):** signed screenshot URLs are minted on demand at view time after a role
    check, never stored in `notifications`.

**Numbering note**
- This doc uses §13 Analytics / §14 Templates with the authoritative route table (§1.2).
