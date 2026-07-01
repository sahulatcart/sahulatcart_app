# 00 — Overview & Glossary

## What Sahulatkaar is
A multi-tenant SaaS that gives a Pakistani merchant an autonomous **WhatsApp sales agent**. When a
buyer messages the merchant's WhatsApp number, the bot (powered by Claude) chats in **Roman Urdu**,
answers product questions, **negotiates the price within merchant-set limits**, builds and confirms
the order, collects delivery details, handles the payment method (**COD or bank transfer via
screenshot**), generates an order slip, and notifies the merchant. The merchant configures and
oversees everything from a **web admin portal**, and can take over any chat manually.

## Core principles
1. **Deterministic pricing.** The negotiation floor and all discount logic live in code. The LLM never
   decides prices — it only understands the buyer and phrases replies. (Prevents "sell it for Rs.1"
   attacks and keeps costs/auditability sane.)
2. **Never touch money.** No payment gateway, no fund custody. The bot shows the merchant's own bank
   account or takes COD; the merchant verifies payment manually. Keeps us clear of SBP/EMI licensing.
3. **Merchant is always in control.** Human takeover on any chat; every bot decision is visible and
   overridable; nothing ships without the flow the merchant configured.
4. **Roman-Urdu native.** The bot must handle real Pakistani WhatsApp language (Roman Urdu + English
   code-switching), not just formal English.
5. **Multi-tenant from the schema up**, even though we launch with one merchant (Path C).

## Personas
| Persona | Who | Uses |
|---|---|---|
| **Merchant (Owner)** | Small/medium Pakistani shop owner selling physical goods | Admin portal: catalog, rules, orders, payments, takeover |
| **Merchant Staff** | Owner's employee/helper | Admin portal with limited role (orders, inbox) |
| **Buyer / Customer** | End consumer on WhatsApp | Chats with the bot on WhatsApp only |
| **Platform Admin** | Us (Sahulatkaar operator) | Super-admin: onboard merchants, monitor, billing (later) |

## In scope (launch / Path C)
- One merchant, official WhatsApp Cloud API, number added manually.
- Catalog: manual add, CSV/Excel import, sync from existing Meta/WhatsApp catalog.
- Bot: product Q&A, negotiation, order build, delivery capture, payment (COD + bank/screenshot),
  order slip, merchant notification, human takeover.
- Admin portal: onboarding, dashboard, catalog, orders, inbox/takeover, customers, negotiation
  settings, bot training, payment settings, templates, analytics, team, settings.

## Out of scope (deferred to scale stage)
- Meta Business Verification, App Review, Embedded Signup self-serve onboarding.
- Payment gateway / online collection.
- Courier/logistics API integration (Phase 2).
- Abandoned-cart re-engagement, broadcasts, loyalty (Phase 2+).
- AI catalog import from photos (offered, not selected).
- Billing/subscriptions for merchants (Phase 2).
- Post-delivery review/feedback collection and upsell/cross-sell (Phase 2 — explicit decision, per audit CO-9).
- Voice-note transcription (STT); at launch voice notes route to human handoff rather than being processed (CO-21).
- Proactive fulfilment/dispatch notifications; at launch order status is pull-only (buyer asks). Cold re-engagement (needs templates) is Phase 2.

## Glossary
- **WABA** — WhatsApp Business Account (Meta object that owns phone numbers).
- **Phone Number ID** — Meta's ID for a registered WhatsApp number; used to route inbound messages to a tenant.
- **24h window / customer service window** — period after a buyer's last message during which the bot can send free-form messages; outside it, only approved templates.
- **Template** — pre-approved message format required to message a user outside the 24h window.
- **Session window** — synonym for 24h window (per conversation).
- **Floor price** — the lowest price the bot may agree to for a product. Computed by precedence (see 06-negotiation-engine.md §3): absolute `min_price` wins; else `list price × (1 − max_discount_pct)`; a cost-based margin guard may raise it. Never a plain "list minus discount" assumption.
- **Concession step** — how much the bot lowers its offer per negotiation round.
- **Takeover** — merchant pauses the bot on a conversation and replies as a human.
- **Order slip** — generated summary (image/PDF/text) of a confirmed order sent to the buyer.
- **Payment claim** — buyer's assertion (message + screenshot) that they paid via bank transfer, pending merchant verification.
- **Tenant / Merchant** — one shop/business account in the system.
- **Path C** — the chosen launch model: official Cloud API, single merchant, no verification yet.
