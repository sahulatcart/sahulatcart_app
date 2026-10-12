#!/bin/bash
# Back up the Supabase database to this Mac: every table in `public` (schema + data) and the portal
# logins (auth.users + auth.identities). Storage files (images, screenshots, slips) are NOT included.
#
#   db/backup.sh                  back up now
#   db/backup.sh --if-none-today  skip if today's backup already exists (what the schedule runs)
#
# Backups go to ~/Sahulatcart-Backups/<date_time>/ (override with BACKUP_DIR) and are kept 30 days,
# which stays inside the privacy policy's retention limits. Restore steps: db/README.md.
# The connection string is $SUPABASE_DB_URL, else backup.env next to this script (written by
# db/backup-schedule.sh), else the repo's .env. It is never printed.
set -euo pipefail
umask 077 # backups hold customer data and password hashes: owner-only

DEST="${BACKUP_DIR:-$HOME/Sahulatcart-Backups}"
KEEP_DAYS=30
here="$(cd "$(dirname "$0")" && pwd)"
mkdir -p "$DEST"
LOG="$DEST/backup.log"
log() { echo "$(date '+%Y-%m-%d %H:%M:%S') $*" | tee -a "$LOG"; }

fail() {
  log "FAILED: $*"
  # Shown on screen when run by the schedule, so a broken backup isn't silent.
  osascript -e 'display notification "See ~/Sahulatcart-Backups/backup.log" with title "Sahulatcart backup failed"' >/dev/null 2>&1 || true
  exit 1
}

if [ "${1:-}" = "--if-none-today" ] && compgen -G "$DEST/$(date +%Y-%m-%d)_*" >/dev/null; then
  exit 0
fi

url="${SUPABASE_DB_URL:-}"
for f in "$here/backup.env" "$here/../.env"; do
  [ -n "$url" ] && break
  [ -f "$f" ] && url="$(grep -E '^SUPABASE_DB_URL=' "$f" | head -1 | cut -d= -f2- | sed -E "s/^['\"]//; s/['\"]$//")"
done
[ -n "$url" ] || fail "SUPABASE_DB_URL not found"

bin=""
for d in /opt/homebrew/opt/libpq/bin /usr/local/opt/libpq/bin; do
  [ -x "$d/pg_dump" ] && bin="$d" && break
done
[ -z "$bin" ] && command -v pg_dump >/dev/null && bin="$(dirname "$(command -v pg_dump)")"
[ -n "$bin" ] || fail "pg_dump not found — install it with: brew install libpq"

name="$(date +%Y-%m-%d_%H%M)"
tmp="$DEST/.partial-$name"
rm -rf "$tmp" && mkdir -p "$tmp"

# Written to a hidden folder first and renamed at the end, so a half-finished backup never looks complete.
"$bin/pg_dump" --format=custom --no-owner --no-privileges --schema=public --file="$tmp/public.dump" --dbname="$url" 2>>"$LOG" \
  || { rm -rf "$tmp"; fail "pg_dump of public schema"; }
"$bin/pg_dump" --format=custom --data-only --table=auth.users --table=auth.identities --file="$tmp/auth.dump" --dbname="$url" 2>>"$LOG" \
  || { rm -rf "$tmp"; fail "pg_dump of auth users"; }

# A dump that pg_restore can't read, or with no table data, is not a backup.
tables="$("$bin/pg_restore" --list "$tmp/public.dump" | grep -c 'TABLE DATA' || true)"
[ "$tables" -gt 0 ] || { rm -rf "$tmp"; fail "public.dump has no table data"; }
"$bin/pg_restore" --list "$tmp/auth.dump" >/dev/null || { rm -rf "$tmp"; fail "auth.dump unreadable"; }

mv "$tmp" "$DEST/$name"
log "ok $name: $tables tables, $(du -sh "$DEST/$name" | cut -f1)"

# Only after a good new backup: drop the ones past the retention period.
find "$DEST" -maxdepth 1 -type d -name '20*_*' -mtime +"$KEEP_DAYS" -exec rm -rf {} + 2>/dev/null || true
