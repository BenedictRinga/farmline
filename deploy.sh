#!/usr/bin/env bash
# deploy.sh — the ONE deploy sequence for farmline-server. Mirrors /opt/rolodex-server/deploy.sh.
#
# fetch → reset --hard → pull → yarn → env → pm2 restart --update-env → pm2 save
#
# NEVER type a bare `git pull && pm2 restart farmline-server` on the droplet: it
# skips the yarn install, the .env checks, `--update-env` and `pm2 save`, and it
# regresses the droplet.
set -euo pipefail

DEPLOY_DIR="${FARMLINE_DEPLOY_DIR:-/opt/farmline-server}"
PM2_NAME="farmline-server"
BRANCH="${FARMLINE_BRANCH:-main}"

echo "── farmline deploy ─────────────────────────────────────────────"
cd "$DEPLOY_DIR" || { echo "FATAL: $DEPLOY_DIR not found. Clone the repo there first."; exit 1; }

# ── THE .ENV NEVER-OVERWRITE GUARANTEE ────────────────────────────────────────
# The founder hand-edits .env on the droplet (AUTH_SECRET, FARMLINE_ADMIN_KEY,
# MPESA_*). `git reset --hard` below must never be able to destroy an edit.
# Same three guards as LoopKeeper's deploy.sh.
echo "0/7  .env guards…"
if git ls-files --error-unmatch .env >/dev/null 2>&1; then
  echo "FATAL: .env is TRACKED in git — a reset --hard would overwrite the droplet's real secrets."
  echo "       Untrack it first:  git rm --cached .env  &&  echo .env >> .gitignore"
  exit 1
fi
if [ -f .env ]; then
  cp .env ".env.backup.$(date +%Y%m%d-%H%M%S)"
  echo "      .env backed up (deploy.sh never overwrites it)."
  ls -1t .env.backup.* 2>/dev/null | tail -n +11 | xargs -r rm -- 2>/dev/null || true
fi

echo "1/7  fetching…"
git fetch --all --prune

echo "2/7  resetting to origin/$BRANCH…"
git reset --hard
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

echo "3/7  installing (yarn only)…"
if [ -f yarn.lock ]; then
  yarn install --frozen-lockfile
else
  yarn install
fi

echo "4/7  syntax check…"
node --check src/index.js
node --check src/schedule.js
node --check src/projection.js
node --check src/money.js
node --check src/ladder.js

echo "5/7  .env checks…"
if [ ! -f .env ]; then
  echo "  ⚠  no .env — copying .env.example. The app will run but is NOT configured."
  cp .env.example .env
fi

# AUTH_SECRET is the one that matters most: unset, the write gate FAILS OPEN.
if ! grep -q "^AUTH_SECRET=.\+" .env 2>/dev/null; then
  echo "  ⚠  AUTH_SECRET is NOT set — THE WRITE GATE IS OPEN."
  echo "     Every farm write is unauthenticated until you set it:"
  echo "       node -e \"console.log(require('crypto').randomBytes(32).toString('hex'))\""
  echo "       then add AUTH_SECRET=<value> to .env and re-run this script."
fi
if ! grep -q "^FARMLINE_ADMIN_KEY=.\+" .env 2>/dev/null; then
  echo "  ⚠  FARMLINE_ADMIN_KEY not set — /api/farmline/admin/* answers 403 (door sealed, never open)."
fi
if ! grep -q "^MONEY_MODE=" .env 2>/dev/null; then
  echo "  ⚠  MONEY_MODE not set — defaulting to virtual (ZU). Safe: no real money moves."
fi
if ! grep -q "^MPESA_CONSUMER_KEY=.\+" .env 2>/dev/null; then
  echo "  NOTE: M-Pesa is not armed. That is FINE for the first farmer — the farm runs in"
  echo "        ZU (virtual) mode, so they and their customers can order and get paid in"
  echo "        practice before any real shilling moves. The rail reports itself unarmed"
  echo "        rather than faking a success. Add MPESA_* when the farmer is ready for real money."
fi

# The Mongo target: farmline owns its OWN database, on the same paid cluster.
if ! grep -qE "^(MONGO_DB_URI_FARMLINE|MONGO_LOCAL_URI|FARMLINE_USE_LOCAL_MONGO)=" .env 2>/dev/null; then
  if [ -f /opt/zyppar-server/.env ] && grep -q "MONGO_DB_URI_PAID=" /opt/zyppar-server/.env; then
    echo "      deriving farmline's URI from /opt/zyppar-server/.env …"
    grep "MONGO_DB_URI_PAID=" /opt/zyppar-server/.env >> .env
  else
    echo "  ⚠  No Mongo URI configured and /opt/zyppar-server/.env is unavailable."
    echo "     Set MONGO_DB_URI_FARMLINE in $DEPLOY_DIR/.env"
  fi
fi
if ! grep -q "^FARMLINE_USE_LOCAL_MONGO=false" .env 2>/dev/null; then
  echo "  NOTE: FARMLINE_USE_LOCAL_MONGO is not 'false'. On a droplet that means the server"
  echo "        will look for a LOCAL mongod, which is not running there. Set:"
  echo "          FARMLINE_USE_LOCAL_MONGO=false"
fi

echo "6/7  restarting via pm2…"
pm2 restart "$PM2_NAME" --update-env 2>/dev/null || pm2 start src/index.js --name "$PM2_NAME"
pm2 save

echo "7/7  health…"
sleep 2
PORT_NOW="$(grep -E '^PORT=' .env | cut -d= -f2 | tr -d '[:space:]' || true)"
PORT_NOW="${PORT_NOW:-4600}"
if curl -fsS "http://localhost:${PORT_NOW}/health" | head -c 300; then
  echo
  echo "  ✓ server is up on :${PORT_NOW}"
else
  echo "  ✗ health check FAILED — check: pm2 logs $PM2_NAME"
  exit 1
fi

cat <<'EOF'

── nginx reminder ────────────────────────────────────────────────
The inserts live in deploy/nginx-farmline-path.conf. If they are not applied,
the app is reachable on :4600 but NOT at https://zyppar.com/farmline/ — and the
API path will answer HTTP 200 with the frontend shell instead of JSON, which
looks like success and is not. Verify from the droplet:

  curl -s https://zyppar.com/api/farmline/version      # must be JSON
  curl -sI https://zyppar.com/farmline/ | head -1      # must be HTTP/2 200
  curl -s https://zyppar.com/api/loopkeeper/health     # neighbours untouched
EOF
