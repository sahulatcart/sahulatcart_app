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

## Backups

The Supabase project is on the **free plan, which has no automatic backups**. These scripts make
them on the owner's Mac:

```bash
db/backup.sh                    # back up now
db/backup-schedule.sh install   # once a day, automatically, whenever the Mac is on
db/backup-schedule.sh status    # is it running, latest backups
```

Each backup is a folder in `~/Sahulatcart-Backups/` named by date and time:
- `public.dump`: every table in `public`, schema and data (merchants, products, orders, customers,
  conversations, etc.).
- `auth.dump`: portal logins (`auth.users` + `auth.identities`, including password hashes).

Backups older than 30 days are deleted, but only after a new one succeeds. The backend already
purges logs after 30 days, so a copy lives at most about 60 days, inside the privacy policy's 90-day
limit. The folder is owner-only because it holds customer data. Never copy it into this repo.

**Not included:** files in Supabase Storage (product images, payment screenshots, order slips). Only
their database rows are backed up.

`pg_dump` comes from `brew install libpq`. Its version must be at least the server's
(Postgres 17.6 on 2026-10-12). Install copies the script and the connection string to
`~/Library/Application Support/Sahulatcart/`, because macOS won't let background jobs read
`~/Desktop`. **Re-run `install` after changing `backup.sh` or the database password.** A failed
scheduled backup shows a macOS notification and writes the reason to `backup.log`.

### Restoring

Restore into a **new, empty** Supabase project, never on top of the live one. `pg_restore` is in
`$(brew --prefix libpq)/bin`.

```bash
pg_restore --no-owner --no-privileges --dbname="$NEW_DB_URL" public.dump   # tables + data
pg_restore --data-only --dbname="$NEW_DB_URL" auth.dump                     # portal logins
```
`pg_restore` reports errors for objects the new project already has, such as `schema "public"
already exists`. Those can be ignored. Then do what a fresh project needs: enable the auth hook
(above), create the storage buckets, and point `SUPABASE_*` in `.env` and on Railway at the new
project.
