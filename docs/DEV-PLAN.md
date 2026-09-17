# Development Plan — MVP

Engineering build plan (what I code, in what order). Distinct from [ROADMAP.md](ROADMAP.md) (business/founder steps).
Source of truth for *what* to build = [docs/spec/](spec/). This doc is the *sequence*.

## Guiding principles
1. **Thin end-to-end slice early.** Get one real WhatsApp message → bot reply working ASAP to de-risk the Meta integration before building depth.
2. **Engine-first where it's pure.** The negotiation engine is deterministic and fully unit-testable with zero external deps — build and prove it early.
3. **Deploy to Railway from day one.** The webhook needs a public HTTPS URL; standard Railway URL is that URL. Everything runs on Railway continuously, not just at the end.
4. **Backend and admin portal progress in parallel** once the schema + shared types exist.
5. **Name is a config value** (`PRODUCT_NAME`, default "Sahulatcart"). Nothing hardcodes the brand. Renaming later = one env var.
6. **Every phase has a demoable exit criterion.** No phase is "done" until its slice visibly works.

## MVP scope line
**In MVP:** WhatsApp bot (Roman Urdu Q&A + negotiation + order + delivery + COD/bank-screenshot payment + slip + merchant notify + human takeover); admin portal (onboarding, catalog manual + CSV, orders, inbox/takeover, payment verify, settings, basic analytics); single merchant on official Cloud API (Path C), one Railway deployment.
**Deferred (post-MVP):** Meta catalog sync (manual + CSV cover MVP), abandoned-cart/broadcast/re-engagement, courier integration, AI photo-import, STT/voice, multi-tenant self-serve (Embedded Signup), billing, partial payments/refund automation.

---

## Phase overview
| # | Phase | Goal | Depends on |
|---|---|---|---|
| 0 | Foundations | Repo, DB, deploy skeleton live on Railway | — |
| 1 | Negotiation engine | Deterministic pricing, fully tested | 0 |
| 2 | WhatsApp pipe | Real message in → reply out (echo) | 0 |
| 3 | Bot brain | Roman-Urdu Q&A + live negotiation | 1, 2 |
| 4 | Order & payment | Full chat→order→slip→payment→verify | 3 |
| 5 | Admin portal | Merchant configures & operates everything | 0 (parallel from P2) |
| 6 | Hardening | Security, isolation, observability, pilot-ready | 3,4,5 |
| 7 | Pilot | 1 real merchant, live tuning | 6 |

---

## Phase 0 — Foundations & scaffolding
**Goal:** empty but deployed system on Railway; DB migrated; types shared.
**Build:**
- Monorepo: `backend/` (Node+TS, Fastify), `admin/` (Next.js), `db/` (Supabase migrations), `shared/` (enums + DTO types from doc 02/03).
- Supabase project; migrations for the **core** tables (merchants, merchant_users, whatsapp_numbers + whatsapp_secrets, products, product_categories, customers, conversations, messages) + enums; hardened RLS pattern; the **Custom Access Token Auth Hook** (doc 09 §2.2.1) injecting `merchant_id`/`role`.
- `shared/` package: enums + core DTOs, imported by both apps.
- Railway: two services (backend, admin) on **standard Railway URLs**; `GET /healthz` + `/readyz`; env/secrets wired (`META_*`, `ANTHROPIC_*`, Supabase, `PRODUCT_NAME`); fail-fast secret assertion.
- Config: `PRODUCT_NAME` env (brand-as-config, decision above).
**Exit:** backend + admin both reachable on their Railway URLs; `/healthz` green; a migration + a trivial RLS test pass; a JWT with no `merchant_id` returns zero rows (default-deny proven).

## Phase 1 — Negotiation engine (pure, deterministic)
**Goal:** the core differentiator, built and proven in isolation (no WhatsApp/LLM needed).
**Build:**
- `NegotiationEngine.decide()` per [doc 06](spec/06-negotiation-engine.md): floor precedence (min_price > pct > margin guard), concession curve (cumulative fractions), opening stance, auto-accept, round cap, stalemate → handoff, agreed-lock, clamp-to-[floor,list], rounding.
- Products + categories CRUD API + migrations (if not in P0).
**Exit:** the doc 06 **test-scenario table** passes as automated unit tests (every `(list, floor, offers)` → expected action), including prompt-injection cases (engine ignores any suggested price). This is the highest-confidence phase — lock it down first.

## Phase 2 — WhatsApp pipe (thin end-to-end slice)
**Goal:** prove the real Meta Cloud API round-trip on a test number. **This is the biggest integration risk — do it early.**
**Build:**
- Webhook receiver: GET verify (hub.challenge), POST handler, `X-Hub-Signature-256` verify (hardened compare), route by `phone_number_id → whatsapp_numbers → merchant_id`, per-inner-item `webhook_events` idempotency, fast-ACK <5s + enqueue.
- Persistence: create/update `customers`, `conversations`, `messages`; 24h window tracking.
- WhatsApp sender: send text (+ media download for later); capture `wa_message_id`; status callbacks → `messages.status`.
- Stub orchestrator: echo/canned reply to prove the loop.
- Register the **test number** under the platform WABA (Path C, no verification); point the Meta webhook at the Railway backend URL.
**Exit:** send a WhatsApp to the test number from a phone → receive a bot reply; inbound + outbound rows persisted; signature + dedupe verified.

## Phase 3 — Bot brain (conversation + negotiation live)
**Goal:** the bot talks Roman Urdu, answers product questions, and haggles within the floor over real WhatsApp.
**Build:**
- `ConversationOrchestrator` + FSM (`bot_state`) per [doc 05](spec/05-bot-flows.md); per-conversation serialization + advisory lock.
- Claude client (`@anthropic-ai/sdk`): classify intent + extract entities (JSON), compose Roman-Urdu replies; per-message token budget; fallback when Claude is down.
- Wire **negotiation**: engine decides, composer phrases; **mandatory outbound price-match guard** (assert quoted number == engine decision).
- Greeting, browsing, product Q&A, negotiation loop; interactive buttons/lists where useful.
- Human-takeover gate (inbound during takeover stored, not auto-processed).
**Exit:** over WhatsApp, a buyer can ask "kitnay ka hai", haggle over multiple rounds, and the bot never sells below floor; conversations survive restarts; taking over from a stub admin action pauses the bot.

## Phase 4 — Order, delivery & payment
**Goal:** a complete purchase from chat to confirmed, paid-claim, merchant-verified.
**Build:**
- Order building: cart in `context` → materialize `orders(draft)` + `order_items` at `collecting_delivery` (doc 05/10 CD-15).
- Delivery capture + `delivery_zones` + charge; out-of-area handling.
- Payment: **COD** (cod_pending at selection) and **bank transfer** (show `bank_accounts` → buyer sends screenshot → Storage `payment-screenshots` → `payment_claims` + `payments.claimed` → notify merchant → merchant verify/reject → bot confirms). Confirm-then-pay ordering.
- Order slip: HTML → Puppeteer PDF (Urdu-capable font) → `order-slips` → sent over WhatsApp.
- Notifications (`new_order`, `payment_claim`) + Supabase Realtime.
**Exit:** end-to-end: chat → negotiate → order → delivery → choose COD or bank → (bank) screenshot → merchant clicks Verify → buyer gets confirmation + slip. Money never touches the system.

## Phase 5 — Admin portal (parallelizable from Phase 2)
**Goal:** merchant configures and runs the shop without touching code. Built in parallel with P3/P4 once P0 types exist.
**Build (per [doc 07](spec/07-admin-portal-screens.md), canonical routes from [doc 03](spec/03-backend-api.md)):**
- Auth (Supabase) + onboarding wizard (business profile → WhatsApp status → bank account → negotiation defaults → add products → persona → go-live).
- Catalog: product list + add/edit; **CSV import** via `background_jobs` (upload → map → preview → commit → error report). *(Meta catalog sync deferred.)*
- Orders: list + detail + status actions + **payment verify panel** (on-demand signed screenshot URL) + slip view/resend + `payment_locked` edit guard.
- Inbox: conversation list + chat view + **take over / hand back** + send message.
- Settings: bank accounts, negotiation defaults (preset control), bot persona/training + FAQs, delivery zones, payment (COD toggle), team/roles.
- Dashboard + basic analytics (metric definitions per doc 07); **bot kill-switch** pill.
- Permission matrix enforced (staff cannot verify payments / see cost-margin).
**Exit:** a merchant can onboard, load a catalog, set haggle limits + bank details, watch live chats, take over, and verify a payment — all from the portal on its Railway URL.

## Phase 6 — Hardening & pilot-readiness
**Goal:** the security & reliability checklist from [doc 10](spec/10-audit-report.md) is green.
**Build:**
- RLS isolation tests (provable cross-tenant deny); permission-matrix + field-stripping tests; worker-role guards + parent/child `merchant_id` CHECK triggers.
- Retention/purge jobs (screenshots 90d, webhook_events 30d); secrets rotation path.
- Observability: structured logs (conversation ids), metrics (msgs, LLM latency/cost, orders, negotiation outcomes), error tracking, dashboards/alerts; runbooks.
- Abuse limits: webhook burst limiter, per-conversation LLM budget + kill-switch, `is_blocked` short-circuit.
- Buyer-conversation simulator (signed-webhook) for repeatable QA; release-gated price-match + injection tests.
**Exit:** security checklist green; simulator runs the full happy-path + edge cases; single Railway deployment stable.

## Phase 7 — Pilot (1 real merchant)
**Goal:** real orders from a real shop.
**Build/operate:**
- Operator-assisted number connection (Path C) for the pilot merchant; load their real catalog; set their rules.
- Live monitoring; tune the bot on real Roman-Urdu conversations; fix what real usage breaks.
**Exit:** the pilot merchant is taking real orders through the bot; feedback captured for post-MVP.

---

## Parallelization
```
P0 ──┬─► P1 (engine)        ─┐
     ├─► P2 (whatsapp pipe) ─┼─► P3 (bot) ─► P4 (order/payment) ─► P6 ─► P7
     └─► P5 (admin portal) ──┘        (P5 continues alongside P3/P4)
```
- After **P0**, the negotiation engine (P1), the WhatsApp pipe (P2), and the admin portal shell (P5) can all start in parallel.
- **P3** needs P1 + P2. **P4** needs P3. **P5** integrates against P3/P4 APIs as they land.

## Deployment (MVP)
- **Railway, standard URLs, one environment.** Backend service = the WhatsApp webhook endpoint + API; admin service = the portal. Supabase hosts DB/Auth/Storage/Realtime. Redis only if/when we scale past one backend instance (guarded: backend refuses replicas>1 without `REDIS_URL`).
- Meta webhook points at the backend's Railway URL. Custom domain and multi-env (staging/prod separation) are post-MVP.

## Testing gates (per phase)
- **P1:** engine unit tests (the doc 06 table) — must be 100%.
- **P2:** signature/dedupe/round-trip integration test on the test number.
- **P3:** scripted Roman-Urdu conversations (via simulator) never breach the floor; price-match guard blocks mismatches.
- **P4:** full order/payment happy-path + reject-retry + COD.
- **P6:** RLS default-deny + permission matrix + injection suite.

## What I need to start
- **Phase 0 can begin now** on a local/dev DB. To deploy the P0 skeleton to Railway and wire P2, I'll need: **Supabase project keys**, a **Railway** project, the **Claude API key** (P3), and a **test WhatsApp number + Meta app** (P2). Business verification / NTN are NOT needed for the MVP pilot (Path C).
