#!/usr/bin/env bash
# farmline-nginx-ensure.sh — THE NGINX REQUEST GENERATOR (2026-10-07).
#
# ══ THE NGINX LAW (the founder, 2026-10-07 — HARD) ══════════════════════════
#   NO SCRIPT WRITES NGINX. This script NO LONGER touches /etc/nginx — not a
#   byte, not a backup, not a reload. nginx serves THREE apps on this droplet;
#   one bad line fails them all at once. THE SHAPE: this script BUILDS THE
#   PROPOSED CONF as a file, shows the diff, and hands the founder the exact
#   commands. SHE applies it by hand:
#       sudo cp <proposed> /etc/nginx/sites-available/zyppar.com
#       sudo nginx -t && sudo systemctl reload nginx
# ════════════════════════════════════════════════════════════════════════════
#
# What it does:
#   1. diagnose: print the farmline lines the live conf currently carries
#   2. build: run the brace-balanced surgery against a COPY of the live conf,
#      producing /tmp/farmline-proposed-<ts>.conf — /etc/nginx is never read
#      for writing and never written
#   3. show: the diff (live → proposed) and the exact apply commands
#   4. verify the PROPOSAL with `nginx -t -c` against a sandboxed include? —
#      NO: nginx -t tests the LIVE conf only; the proposal is validated by
#      the founder's own `nginx -t` before her reload (the safe gate).
set -euo pipefail

NG="${FARMLINE_NGINX_CONF:-/etc/nginx/sites-available/zyppar.com}"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
# THE BLOCK ALWAYS COMES FROM THE REPO CHECKOUT, NEVER FROM AN INSTALLED COPY.
BLOCK=""
for CAND in /opt/farmline-server/deploy/farmline-nginx-block.conf \
            "$(cd "$(dirname "$0")" && pwd)/farmline-nginx-block.conf" \
            "$DIR/deploy/farmline-nginx-block.conf"; do
  if [ -f "$CAND" ]; then BLOCK="$CAND"; break; fi
done
[ -n "$BLOCK" ] || { echo "  ✗ canonical block missing (no candidate found)"; exit 1; }
echo "  block: $BLOCK"

echo "── farmline nginx REQUEST GENERATOR (writes nothing to nginx) ──"

# ── 1. DIAGNOSE ──────────────────────────────────────────────────────────────
echo "  farmline lines in the live conf:"
grep -n "farmline" "$NG" | head -20 || echo "    (none — the blocks are gone)"
echo

# ── 2. BUILD THE PROPOSAL (on a copy; /etc is read-only to this script) ─────
TS="$(date +%Y%m%d-%H%M%S)"
PROP="/tmp/farmline-proposed-$TS.conf"
cp "$NG" "$PROP"
python3 "$DIR/scripts/farmline-nginx-surgery.py" "$PROP" "$BLOCK"
echo "  ✓ proposal built: $PROP"

# ── 3. SHOW THE DIFF + THE APPLY COMMANDS ────────────────────────────────────
echo
echo "  ── the diff (live → proposed) ──"
diff -u "$NG" "$PROP" | head -80 || true
echo

echo "  ── REVIEW BEFORE APPLY (MANDATORY - the trusted session's lesson) ──"
echo "  every farmline line REMAINING in the proposal; each must belong to the"
echo "  ONE canonical set - and there must be NO unquoted {n,} regex anywhere:"
grep -n "farmline" "$PROP" || echo "    (none)"
echo "  unquoted-brace regexes left in the proposal (MUST be none):"
grep -nE 'location[^#]*[{][0-9]+,}' "$PROP" || echo "    (none - clean)"
echo

cat <<EOF
  ── TO APPLY (the founder's hand, in order) ──
  sudo cp $PROP /etc/nginx/sites-available/zyppar.com
  sudo nginx -t
  sudo systemctl reload nginx
  curl -s https://zyppar.com/api/farmline/version   # expect JSON, build 22

  If nginx -t fails: the proposal has a line the lexer rejects — paste the
  error back to the agent (the stale unquoted line at ~:440 is the known one).
  NOTHING HAS BEEN CHANGED — /etc/nginx is exactly as it was.
EOF
