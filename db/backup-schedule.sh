#!/bin/bash
# Run db/backup.sh automatically on this Mac: once a day, whenever the Mac is on.
#
#   db/backup-schedule.sh install    set up (or refresh after changing backup.sh or the DB password)
#   db/backup-schedule.sh status     is it loaded, and the latest backups
#   db/backup-schedule.sh uninstall  stop it (existing backups are kept)
#
# A macOS LaunchAgent checks every hour and backs up if today has no backup yet, so a Mac that was
# asleep or off at a fixed time still gets its daily backup. macOS doesn't let background jobs read
# ~/Desktop, where this repo lives, so install copies the script and the connection string
# (owner-only file) to ~/Library/Application Support/Sahulatcart/.
set -euo pipefail

LABEL="com.sahulatcart.db-backup"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
APP="$HOME/Library/Application Support/Sahulatcart"
DEST="${BACKUP_DIR:-$HOME/Sahulatcart-Backups}"
repo="$(cd "$(dirname "$0")/.." && pwd)"

case "${1:-}" in
  install)
    url="$(grep -E '^SUPABASE_DB_URL=' "$repo/.env" 2>/dev/null | head -1 | cut -d= -f2-)"
    [ -n "$url" ] || { echo "SUPABASE_DB_URL is missing from $repo/.env" >&2; exit 1; }
    mkdir -p "$APP" "$DEST" "$(dirname "$PLIST")"
    chmod 700 "$APP" "$DEST"
    cp "$repo/db/backup.sh" "$APP/backup.sh"
    (umask 077; printf 'SUPABASE_DB_URL=%s\n' "$url" > "$APP/backup.env")
    cat > "$PLIST" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array><string>/bin/bash</string><string>$APP/backup.sh</string><string>--if-none-today</string></array>
  <key>EnvironmentVariables</key><dict><key>BACKUP_DIR</key><string>$DEST</string></dict>
  <key>StartInterval</key><integer>3600</integer>
  <key>RunAtLoad</key><true/>
  <key>StandardOutPath</key><string>$DEST/launchd.log</string>
  <key>StandardErrorPath</key><string>$DEST/launchd.log</string>
</dict>
</plist>
EOF
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "Installed. Daily backups go to $DEST"
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    rm -rf "$APP"
    echo "Removed the schedule. Existing backups in $DEST were kept."
    ;;
  status)
    if launchctl print "gui/$(id -u)/$LABEL" >/dev/null 2>&1; then
      echo "Schedule: loaded"
      launchctl print "gui/$(id -u)/$LABEL" | grep -E 'last exit code' | sed 's/^[[:space:]]*/  /'
    else
      echo "Schedule: not installed"
    fi
    echo "Latest backups:"
    ls -1d "$DEST"/20*_* 2>/dev/null | tail -5 | sed 's/^/  /' || echo "  none yet"
    [ -f "$DEST/backup.log" ] && { echo "Log:"; tail -3 "$DEST/backup.log" | sed 's/^/  /'; }
    ;;
  *)
    echo "usage: $0 install | status | uninstall" >&2
    exit 1
    ;;
esac
