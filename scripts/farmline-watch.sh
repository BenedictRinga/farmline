#!/usr/bin/env bash
# farmline-watch.sh — THE EARLY WARNING + THE SELF-HEAL (the founder,
# 2026-10-07: "Farm is currently 404. I need to hear this faster, not from
# users. But first revive it.").
#
# Runs every minute (cron). Three layers, in order:
#   1. CHECK  — the API through nginx, exactly as a phone reaches it:
#               http://127.0.0.1/api/farmline/health with the site's Host.
#   2. HEAL   — on failure: re-run the nginx ensure (the block re-inserts,
#               nginx -t gates it with auto-restore) + reload, and restart
#               the farmline-server pm2 process if the API still fails.
#   3. TELL   — every state change (OK -> DOWN, DOWN -> OK, healed or not)
#               is logged, and if FARMLINE_ALERT_WEBHOOK is set in the .env,
#               a POST carries the message to wherever she reads it.
#
# Idempotent and quiet when healthy: only state changes speak.
set -u

BASE_URL="${FARMLINE_CHECK_URL:-http://127.0.0.1/api/farmline/health}"
HOST_HDR="${FARMLINE_CHECK_HOST:-zyppar.com}"
STATE_FILE="/var/lib/farmline/watch.state"
ENSURE="/opt/farmline-server/scripts/farmline-nginx-ensure.sh"
SERVER_DIR="/opt/farmline-server"
ENV_FILE="/opt/zyppar-server/.env"   # FARMLINE_ALERT_WEBHOOK lives beside the other env
LOG_PREFIX="[farmline-watch $(date '+%F %T')]"

mkdir -p "$(dirname "$STATE_FILE")" 2>/dev/null

code="$(curl -s -o /tmp/fl-watch-body -w '%{http_code}' -H "Host: ${HOST_HDR}" --max-time 8 "$BASE_URL" 2>/dev/null)"
healthy=0
if [ "$code" = "200" ] && grep -q '"ok":true' /tmp/fl-watch-body 2>/dev/null; then
  healthy=1
fi

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

# ── DOWN: heal before telling ──────────────────────────────────────────────────
echo "$LOG_PREFIX API DOWN (code $code, body: $(head -c 120 /tmp/fl-watch-body 2>/dev/null)) — healing"
if [ -x "$ENSURE" ]; then
  bash "$ENSURE" >/tmp/fl-watch-ensure.log 2>&1 || true
  if grep -qi "FAIL" /tmp/fl-watch-ensure.log; then
    echo "$LOG_PREFIX ensure reported failure — see /tmp/fl-watch-ensure.log"
  fi
fi
systemctl reload nginx 2>/dev/null || true
sleep 2
code2="$(curl -s -o /tmp/fl-watch-body2 -w '%{http_code}' -H "Host: ${HOST_HDR}" --max-time 8 "$BASE_URL" 2>/dev/null)"
if [ "$code2" = "200" ] && grep -q '"ok":true' /tmp/fl-watch-body2 2>/dev/null; then
  notify "API was DOWN (code $code) — SELF-HEALED by the nginx ensure + reload. Now up."
  echo ok > "$STATE_FILE"
  exit 0
fi

# Still down: the Node process itself — restart it, then judge once more.
if [ -d "$SERVER_DIR" ]; then
  cd "$SERVER_DIR" || true
  pm2 restart farmline-server >/dev/null 2>&1 || true
  sleep 4
  code3="$(curl -s -o /tmp/fl-watch-body3 -w '%{http_code}' -H "Host: ${HOST_HDR}" --max-time 8 "$BASE_URL" 2>/dev/null)"
  if [ "$code3" = "200" ] && grep -q '"ok":true' /tmp/fl-watch-body3 2>/dev/null; then
    notify "API was DOWN (code $code) — the nginx ensure did not serve it; the pm2 restart did. Now up."
    echo ok > "$STATE_FILE"
    exit 0
  fi
fi

notify "API IS DOWN (code $code, after ensure $code2, after pm2 restart $code3) — needs a human: run 'cd $SERVER_DIR && sudo bash scripts/farmline-nginx-ensure.sh && sudo nginx -t && sudo systemctl reload nginx' and check 'pm2 logs farmline-server'."
echo down > "$STATE_FILE"
