# Database (Supabase / Postgres)

Migrations are plain SQL, applied in filename order. Source of truth for schema =
[docs/spec/02-data-model.md](../docs/spec/02-data-model.md).

## Migrations
- `0001_core.sql` — enums + core tables (Phase 0 slice: merchants, users, whatsapp numbers/secrets,
  products/categories, customers, conversations, messages, webhook_events, audit_log) + child-guard trigger.
- `0002_rls_and_auth_hook.sql` — the Custom Access Token Hook (injects `merchant_id`/`role`/`platform_admin`
  claims) + hardened RLS on every tenant table + service-role-only lockdown for `whatsapp_secrets`/`webhook_events`.
- _Phase 4 will add:_ orders, order_items, payments, payment_claims, negotiations, bank_accounts,
  delivery_zones, message_templates, bot_knowledge, notifications, background_jobs, order_status_history.

## Applying (local or Supabase)
```bash
# with psql against your Supabase connection string:
psql "$SUPABASE_DB_URL" -f db/migrations/0001_core.sql
psql "$SUPABASE_DB_URL" -f db/migrations/0002_rls_and_auth_hook.sql
```
(We can switch to the Supabase CLI migration workflow once the project is created.)

## After applying 0002 — enable the auth hook (one-time, required)
Supabase Dashboard → **Authentication → Hooks → Custom Access Token** →
select `public.custom_access_token_hook`. Without this, JWTs carry no `merchant_id`
claim and — by design — every tenant query returns **zero rows** (fail-closed).

## Storage buckets to create (Phase 0/4)
`product-images` (public-read, non-guessable keys), `payment-screenshots` (private),
`inbound-media` (private), `order-slips` (private), `catalog-imports` (private).
