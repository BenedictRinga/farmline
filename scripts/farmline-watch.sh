#!/usr/bin/env bash
# farmline-watch.sh — THE EARLY WARNING + THE SELF-HEAL (the founder,
# 2026-10-07: "Farm is currently 404. I need to hear this faster, not from
# users. But first revive it.").
#
# Runs every minute (cron). The layers:
#   1. CHECK  — the API through nginx, exactly as a phone reaches it.
#               curl -sL: nginx 301s http://127.0.0.1 to https, and an
#               unfollowed probe called a HEALTHY api DOWN (the trusted
#               session's fix, 2026-10-07 — port it or lose it).
#   2. HEAL   — farmline's OWN process only, in the APPUSER's pm2 daemon:
#               the cron runs as root, and bare `pm2` reaches ROOT's daemon
#               while farmline-server lives in appuser's (the trusted
#               session's fix). If the process is GONE from the list
#               (it happened twice on 2026-10-07, in deploy windows),
#               `pm2 resurrect` brings the whole saved list back.
#   3. TELL   — every state change (OK -> DOWN, DOWN -> OK, healed or not)
#               is logged, and if FARMLINE_ALERT_WEBHOOK is set in the .env,
#               a POST carries the message to wherever she reads it.
#
# THE NGINX LAW: this script NEVER touches nginx. When the API is down
# after the pm2 heal, it reports that the founder's nginx hand is needed.
# Idempotent and quiet when healthy: only state changes speak.
set -u

BASE_URL="${FARMLINE_CHECK_URL:-http://127.0.0.1/api/farmline/health}"
HOST_HDR="${FARMLINE_CHECK_HOST:-zyppar.com}"
STATE_FILE="/var/lib/farmline/watch.state"
APP_USER="${FARMLINE_APP_USER:-appuser}"
SERVER_DIR="/opt/farmline-server"
ENV_FILE="/opt/zyppar-server/.env"   # FARMLINE_ALERT_WEBHOOK lives beside the other env
LOG_PREFIX="[farmline-watch $(date '+%F %T')]"

mkdir -p "$(dirname "$STATE_FILE")" 2>/dev/null

probe() { # writes the body to $1, echoes the http code
  curl -sL -o "$1" -w '%{http_code}' -H "Host: ${HOST_HDR}" --max-time 8 "$BASE_URL" 2>/dev/null
}
healthy_at() { # $1 = body file; 0 = healthy
  [ "$(cat "$1" 2>/dev/null | head -c 200 | grep -c '"ok":true')" -ge 1 ]
}

code="$(probe /tmp/fl-watch-body)"
healthy=0
[ "$code" = "200" ] && healthy_at /tmp/fl-watch-body && healthy=1

prev="down"
[ -f "$STATE_FILE" ] && prev="$(cat "$STATE_FILE" 2>/dev/null || echo down)"

notify() {
  # $1 = the message. Logs always; the webhook only when armed.
  echo "$LOG_PREFIX $1"
  local hook=""
  if [ -f "$ENV_FILE" ]; then
    hook="$(grep -E '^FARMLINE_ALERT_WEBHOOK=' "$ENV_FILE" | tail -1 | cut -d= -f2- | tr -d '\"' | tr -d "'")"
  fi
  if [ -n "$hook" ]; then
    curl -s --max-time 8 -X POST -H 'Content-Type: application/json' \
      -d "{\"text\":\"farmline: $1\"}" "$hook" >/dev/null 2>&1 || true
  fi
}

if [ "$healthy" = "1" ]; then
  if [ "$prev" != "ok" ]; then
    notify "API is back UP (code $code).${prev:+ was $prev}"
  fi
  echo ok > "$STATE_FILE"
  exit 0
fi

# ── DOWN: farmline's OWN process, in ITS daemon; nginx belongs to the founder ─
heal() { # restart in the appuser daemon; resurrect if the process is gone
  sudo -u "$APP_USER" pm2 restart farmline-server >/dev/null 2>&1 || true
  sudo -u "$APP_USER" pm2 resurrect >/dev/null 2>&1 || true
  sudo -u "$APP_USER" pm2 restart farmline-server >/dev/null 2>&1 || true
}
if [ -d "$SERVER_DIR" ]; then
  cd "$SERVER_DIR" || true
  heal
  sleep 4
  code2="$(probe /tmp/fl-watch-body2)"
  if [ "$code2" = "200" ] && healthy_at /tmp/fl-watch-body2; then
    notify "API was DOWN (code $code) — the appuser pm2 heal (restart/resurrect) brought farmline-server back. Now up."
    echo ok > "$STATE_FILE"
    exit 0
  fi
fi

notify "API IS DOWN (code $code, after the appuser pm2 heal $code2) — the process class is absorbed; if this is nginx, THE FOUNDER'S NGINX HAND IS NEEDED: the proposal lives at /tmp/farmline-proposed-*.conf (run 'sudo -u appuser bash /opt/farmline-server/scripts/farmline-nginx-ensure.sh' to rebuild it), apply = cp the proposal to /etc/nginx/sites-available/zyppar.com && sudo nginx -t && sudo systemctl reload nginx. Also check 'sudo -u appuser pm2 logs farmline-server'."
echo down > "$STATE_FILE"
