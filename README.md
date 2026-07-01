# Sahulatkaar (internal codename — brand name not final)

A multi-tenant SaaS that gives a Pakistani merchant an autonomous **WhatsApp sales agent**: it chats
with buyers in Roman Urdu, **negotiates within merchant-set price floors**, builds and confirms orders,
handles COD or bank-transfer-by-screenshot payments, generates an order slip, and notifies the merchant.
The merchant configures and oversees everything from a web admin portal.

> **Name is configuration.** The product/brand name lives in one env var (`PRODUCT_NAME`). Renaming later
> = change that variable. Buyer-facing text uses the merchant's own business name.

## Documentation
- **Spec (source of truth):** [docs/spec/](docs/spec/) — 10 docs (architecture, data model, API, bot flows,
  negotiation engine, screens, payments, devops) + [audit report](docs/spec/10-audit-report.md).
- **Development plan:** [docs/DEV-PLAN.md](docs/DEV-PLAN.md) — phased build sequence.
- **Business/founder steps:** [docs/ROADMAP.md](docs/ROADMAP.md), [docs/FOUNDER-REQUIREMENTS.md](docs/FOUNDER-REQUIREMENTS.md).

## Monorepo layout
```
backend/   Node + TypeScript (Fastify) — webhook, API, bot orchestration
admin/     Next.js — merchant admin portal
shared/    TypeScript enums + shared types (single source for both apps)
db/        Supabase SQL migrations (schema, RLS, auth hook)
docs/      spec + plans
```

## Local setup
```bash
cp .env.example .env          # fill Supabase keys (Meta/Anthropic optional until their phase)
npm install                   # installs all workspaces
npm run build:shared          # compile @app/shared (consumed by backend & admin)
npm run dev:backend           # backend on :8080  → GET /healthz
npm run dev:admin             # admin on :3000
```
Apply DB migrations per [db/README.md](db/README.md), then enable the Supabase auth hook.

## Deployment — MVP (Railway, standard URLs, one environment)
Two Railway services from this repo:
| Service | Root / build | Start | URL is… |
|---|---|---|---|
| **backend** | repo root, `backend/Dockerfile` | `node backend/dist/index.js` | the **WhatsApp webhook** endpoint + API |
| **admin** | `admin/` (Nixpacks) | `next start` | the merchant portal |
Set env vars per `.env.example` in each Railway service. The Meta webhook points at the backend's
Railway URL (`/api/v1/webhook/whatsapp`, added in Phase 2). Custom domain + staging/prod split are post-MVP.

## Status
**Phase 0 (foundations) — in progress.** See [docs/DEV-PLAN.md](docs/DEV-PLAN.md) for phases.
