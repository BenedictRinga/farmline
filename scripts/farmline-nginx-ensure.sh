#!/usr/bin/env bash
# farmline-nginx-ensure.sh — THE NGINX GUARANTEE (2026-10-06).
#
# THE OUTAGE THIS ENDS: farmline's API/socket blocks were hand-shipped into
# the shared zyppar.com conf once (2026-10-05) and owned by NO deploy script.
# When the shared conf changed underneath us, farmline's API locations
# vanished and every request died as nginx's own 404 — the app shell loads
# (static blocks survived) but the app is dead: no data, no auth, no chat.
#
# THE CURE, idempotent — safe to run on EVERY deploy:
#   1. diagnose: print the farmline lines the conf currently carries
#   2. remove every existing farmline location block (brace-balanced surgery)
#   3. insert the canonical set (deploy/farmline-nginx-block.conf)
#   4. nginx -t — on failure the backup is RESTORED automatically
#   5. reload + the verify ladder
#
# Usage: sudo bash scripts/farmline-nginx-ensure.sh [--diagnose-only]
set -euo pipefail

NG="${FARMLINE_NGINX_CONF:-/etc/nginx/sites-available/zyppar.com}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
BLOCK="$DIR/deploy/farmline-nginx-block.conf"
[ -f "$BLOCK" ] || { echo "  ✗ canonical block missing: $BLOCK"; exit 1; }

echo "── farmline nginx ensure ───────────────────────────────────────"

# ── 1. DIAGNOSE (visible in every run's output) ──────────────────────────────
echo "  farmline lines in the live conf:"
grep -n "farmline" "$NG" | head -12 || echo "    (none — the blocks are gone)"
echo

[ "${1:-}" = "--diagnose-only" ] && { echo "  (diagnose-only — nothing changed)"; exit 0; }

# ── 2-3. THE SURGERY (backup → remove stale → insert canonical) ─────────────
BAK="$NG.bak-$(date +%Y%m%d-%H%M%S)-fl-ensure"
cp "$NG" "$BAK"
echo "  backup: $BAK"

restore() {
  echo "  ✗ FAILED — restoring the backup"
  cp "$BAK" "$NG"
  nginx -t && systemctl reload nginx && echo "  ✓ backup restored, nginx reloaded (the outage state is unchanged, nothing worse)"
}
trap restore ERR

python3 "$DIR/scripts/farmline-nginx-surgery.py" "$NG" "$BLOCK"

echo "4a  nginx -t…"
nginx -t
echo "4b  reloading…"
systemctl reload nginx
trap - ERR

# ── 5. THE VERIFY LADDER ─────────────────────────────────────────────────────
sleep 1
echo "  verify:"
curl -s -o /dev/null -w "    /farmline/                     %{http_code}\n" https://zyppar.com/farmline/
curl -s -o /dev/null -w "    /api/farmline/version          %{http_code}\n" https://zyppar.com/api/farmline/version
curl -s -o /dev/null -w "    /api/farmline/updates/check    %{http_code}\n" "https://zyppar.com/api/farmline/updates/check?clientBuild=1"
curl -s -o /dev/null -w "    /farmline/s/test-farm (deep)   %{http_code}\n" https://zyppar.com/farmline/s/test-farm
curl -s -o /dev/null -w "    /api/loopkeeper/health (nb)    %{http_code}\n" https://zyppar.com/api/loopkeeper/health
echo "    version says: $(curl -s https://zyppar.com/api/farmline/version | head -c 120)"
echo "── done ────────────────────────────────────────────────────────"
