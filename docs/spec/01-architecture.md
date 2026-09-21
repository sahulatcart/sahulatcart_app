# 01 — Architecture

## System components
```
                         ┌──────────────────────── WhatsApp (buyers) ────────────────────────┐
                         │                                                                    │
                    Meta WhatsApp Cloud API  ◀── send messages ──┐                            │
                         │  (inbound webhook)                     │                            │
                         ▼                                        │                            ▼
   ┌──────────────────────────────────────────────────────────────────────────────────────────┐
   │  BACKEND (Node.js / TypeScript on Railway)                                                  │
   │                                                                                             │
   │  1. Webhook Receiver ── verifies signature, dedupes by message id, ACKs fast (<5s)          │
   │           │  enqueues                                                                       │
   │           ▼                                                                                 │
   │  2. Message Queue / Worker (in-process queue or Redis; per-conversation ordering)           │
   │           ▼                                                                                 │
   │  3. Conversation Orchestrator (state machine per conversation)                              │
   │       ├─ Intent understanding ───────▶ Claude API (extract intent + structured offer)       │
   │       ├─ Negotiation Engine ⚖️ ──────▶ DETERMINISTIC (floor, concession) — NO LLM           │
   │       ├─ Order Service ──────────────▶ builds/updates orders, slip generation               │
   │       ├─ Payment Service ────────────▶ COD / bank-transfer claim + merchant verification     │
   │       └─ Response Composer ──────────▶ Claude API (phrase decision in Roman Urdu)            │
   │           ▼                                                                                 │
   │  4. WhatsApp Sender ── templates + free-form, media, interactive; ret/backoff                │
   │                                                                                             │
   │  5. Admin REST API (/api/v1/*) ── consumed by the Next.js portal                            │
   │  6. Background Jobs ── notifications, template follow-ups, window timers, catalog sync       │
   │  7. Realtime ── Supabase Realtime / websockets push live inbox + order updates to portal     │
   └──────────────────────────────────────────────────────────────────────────────────────────┘
        │                         │                          │                        │
        ▼                         ▼                          ▼                        ▼
  Supabase Postgres        Supabase Storage            Claude API              Meta Graph API
  (all tables + RLS)       (media, screenshots,        (Anthropic)             (catalog sync,
                            order slips)                                         templates, send)

   ┌──────────────────────────────────────────────┐
   │  ADMIN PORTAL (Next.js / React on Railway)    │  ◀── merchant logs in (Supabase Auth)
   │  talks to Admin REST API + Supabase Realtime  │
   └──────────────────────────────────────────────┘
```

## Tech stack
| Layer | Choice | Notes |
|---|---|---|
| Backend | **Node.js + TypeScript** (Express or Fastify) | Webhook + API + workers |
| Bot brain | **Claude API** (Anthropic) | Intent extraction + Roman-Urdu composition |
| DB | **Supabase Postgres** | Multi-tenant, RLS |
| Auth | **Supabase Auth** | Portal login (merchant users) |
| Storage | **Supabase Storage** | Product images, payment screenshots, order slips |
| Realtime | **Supabase Realtime** | Live inbox/order updates in portal |
| Admin UI | **Next.js + React + Tailwind** | Merchant portal |
| Hosting | **Railway** | Backend service + portal + (optional) Redis |
| Queue | In-process (BullMQ + Redis if needed) | Ordered per-conversation processing |
| WhatsApp | **Meta WhatsApp Cloud API** | Official; Graph API |

## Key request flows

### Inbound buyer message
1. Meta POSTs to `/api/v1/webhook/whatsapp`.
2. Receiver verifies `X-Hub-Signature-256`, looks up tenant by `phone_number_id`, dedupes on
   `whatsapp_message_id`, persists raw payload + message, returns `200` immediately.
3. Worker loads/creates `conversation` + `customer`, refreshes 24h window, checks status
   (`bot_active` vs `human_takeover` — if taken over, stop; just store + notify).
4. Orchestrator asks Claude to classify intent + extract entities (product, quantity, offer, address).
5. State machine routes: product Q&A / negotiation / order / delivery / payment.
6. If pricing involved → Negotiation Engine (deterministic) computes accept/counter/reject.
7. Response Composer asks Claude to phrase the decision in Roman Urdu.
8. WhatsApp Sender delivers reply; message + status persisted.

### Merchant portal action (e.g., verify payment)
1. Portal calls `POST /api/v1/orders/:id/payment/verify` with Supabase JWT.
2. API checks RLS/role, updates `payments` + `orders.payment_status`.
3. Triggers bot to send buyer a confirmation (if within window, free-form; else template).
4. Realtime pushes updated order to any open portal tab.

### Outbound to a cold buyer (>24h)
1. Job/agent picks a template (utility for transactional).
2. Sender calls Graph API with the approved template; if template `PAUSED/REJECTED`, fall back/skip + alert merchant.

## Multi-tenancy
- One backend, one webhook endpoint. Inbound routed by `phone_number_id → merchant_id`.
- Each merchant has its own WhatsApp number, catalog, rules, bank accounts, templates, bot persona.
- Data isolation via `merchant_id` + Supabase RLS on every tenant table.
- Portal users scoped to their `merchant_id`; platform admin can cross tenants.
- **Path C note:** at launch, numbers are added under the platform's own WABA manually; the routing,
  isolation, and per-tenant config are already multi-tenant so scaling later needs no rewrite.

## Environments
- **local** (dev DB or Supabase dev project, ngrok tunnel for webhook), **staging**, **production**.
- Secrets via Railway env vars (see [09](09-nonfunctional-devops.md)).

## Repo layout (monorepo)
```
sahulatcart/
├── backend/      Node.js — webhook, API, workers, services (negotiation, order, payment, whatsapp, claude)
├── admin/        Next.js — merchant portal
├── db/           Supabase migrations, RLS policies, seed
├── shared/       TS types shared by backend & admin (enums, DTOs)
└── docs/         this spec
```
