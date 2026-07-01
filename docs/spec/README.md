# Sahulatkaar — Technical Specification

Complete design documentation: product, architecture, data, APIs, bot flows, screens, and ops.
This is the source of truth for building. Read in order.

## Documents
| # | Doc | Covers |
|---|---|---|
| 00 | [Overview & Glossary](00-overview.md) | What we're building, personas, scope, terminology |
| 01 | [Architecture](01-architecture.md) | System components, request flows, tech stack, hosting, multi-tenancy |
| 02 | [Data Model](02-data-model.md) | Every table, column, relationship, RLS, storage, enums |
| 03 | [Backend API](03-backend-api.md) | Every endpoint, request/response, auth, errors |
| 04 | [WhatsApp Integration](04-whatsapp-integration.md) | Webhook, sending, templates, media, 24h window, number setup |
| 05 | [Bot Conversation Flows](05-bot-flows.md) | State machine, every conversation path, intents, edge cases |
| 06 | [Negotiation Engine](06-negotiation-engine.md) | Deterministic pricing, floors, concession logic, guardrails |
| 07 | [Admin Portal Screens](07-admin-portal-screens.md) | Every screen, component, state, interaction |
| 08 | [Payments & Notifications](08-payments-notifications.md) | Payment flow, screenshot handling, merchant confirm, notifications |
| 09 | [Non-Functional & DevOps](09-nonfunctional-devops.md) | Security, config, secrets, logging, errors, deploy, testing |
| — | [Audit Report](10-audit-report.md) | Extensive audit findings + fixes applied |

## Conventions (apply everywhere)
- **IDs:** UUID v4 primary keys.
- **Tenancy:** every tenant-owned row has `merchant_id`; enforced by Supabase Row-Level Security.
- **Naming:** DB tables/columns `snake_case`; API routes REST under `/api/v1/`; JSON fields `camelCase`.
- **Timestamps:** `created_at`, `updated_at` (UTC, `timestamptz`). Display in merchant timezone (default `Asia/Karachi`).
- **Money:** integer **paisa** (1 PKR = 100 paisa) to avoid float errors; currency default `PKR`.
- **Money principle:** Sahulatkaar NEVER holds funds. Payments happen merchant↔customer directly.
- **Price-floor principle:** all pricing/discount/floor decisions are DETERMINISTIC CODE; the LLM only phrases messages.
- **Language:** buyer-facing bot = Roman Urdu first (English fallback); admin portal = English.
- **Launch = Path C:** single merchant, official Cloud API, no Meta verification/App Review/Embedded Signup yet. Schema/code are multi-tenant-ready.
