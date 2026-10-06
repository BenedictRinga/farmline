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

# FIRST-RUN GUARD. The droplet copy was shipped as a tarball and has no `origin`
# remote yet, so a bare `git fetch --all` would die here with a cryptic error and
# `set -e` would abort the deploy. Say exactly what is missing and what to type.
if ! git remote get-url origin >/dev/null 2>&1; then
  echo
  echo "  ✗ This checkout has NO 'origin' remote, so there is nothing to fetch."
  echo "    That is expected on a first run (the droplet copy arrived as a tarball)."
  echo "    Point it at the repository once, then re-run ./deploy.sh:"
  echo
  echo "        cd $DEPLOY_DIR"
  echo "        git remote add origin <your-repo-url>"
  echo "        git fetch origin"
  echo "        git reset --hard origin/$BRANCH"
  echo
  echo "    After that, ./deploy.sh works normally forever."
  exit 1
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

# The environment reasoning lives in ONE place now: scripts/preflight.cjs. It
# succeeds or fails the deploy on the things that would otherwise fail silently
# (the write gate open, a local-mongo URI on a droplet, a db name that is not
# `farmline`). FARMLINE_PROD=1 makes the missing-secret cases FATAL, which they
# should be here and are not on a laptop.
echo "      running preflight (FARMLINE_PROD=1) …"
FARMLINE_PROD=1 yarn preflight || {
  echo
  echo "  ✗ PREFLIGHT FAILED — not restarting. Fix the FATAL lines above, then re-run ./deploy.sh"
  exit 1
}

echo "6/7  restarting via pm2…"
pm2 restart "$PM2_NAME" --update-env 2>/dev/null || pm2 start src/index.js --name "$PM2_NAME"
pm2 save

# 6.5  THE NGINX GUARANTEE (2026-10-06): the API/socket blocks used to be a
# one-time hand-ship owned by NO script — the shared conf changing underneath
# us 404'd the whole API while the shell kept serving (the 2026-10-06 outage).
# The ensure is idempotent: diagnose → remove stale farmline blocks → insert
# the canonical set → nginx -t (auto-restore on failure) → reload → verify.
ENSURE=/opt/farmline-nginx-guarantee/farmline-nginx-ensure.sh
# 2026-10-06: the ROOT-OWNED package + the sudoers line (appuser NOPASSWD on
# exactly that path) — a script nobody can invoke is a guarantee on paper only.
# The repo copy (scripts/farmline-nginx-ensure.sh) stays the SOURCE; refresh the
# package with: sudo cp scripts/farmline-nginx-ensure.sh /opt/farmline-nginx-guarantee/
if [ -x "$ENSURE" ]; then
  sudo -n "$ENSURE" || echo "  ⚠ nginx ensure failed — the deploy continues, but run it manually"
elif [ "$(id -u)" = "0" ]; then
  bash scripts/farmline-nginx-ensure.sh || echo "  ⚠ nginx ensure failed — the deploy continues"
else
  echo "6.5  nginx ensure skipped (no package) — install: sudo cp scripts/farmline-nginx-ensure.sh /opt/farmline-nginx-guarantee/"
fi

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

echo "── verification ──"
# The live check, as a script. It answers the only question that matters after a
# deploy — "did it actually take?" — by comparing the live build number to this
# repo's, and by proving the API prefix is proxied rather than silently answered
# by the frontend shell at HTTP 200.
PUBLIC_BASE="${FARMLINE_PUBLIC_BASE:-https://zyppar.com}"
if yarn verify "$PUBLIC_BASE"; then
  echo
  echo "  ✓ deployed and verified: $PUBLIC_BASE/farmline/"
else
  echo
  echo "  ⚠ THE DEPLOY IS UP BUT VERIFICATION FAILED — read the FAIL lines above."
  echo "    A common cause is deploy drift: the droplet is serving an older build than"
  echo "    the one just released. Check: pm2 logs $PM2_NAME"
fi

cat <<'EOF'

── if the nginx inserts are not yet applied ──────────────────────
They live in deploy/nginx-farmline-path.conf. Without them the app is reachable
on :4600 but NOT at /farmline/, and the API prefix answers HTTP 200 with the
frontend shell instead of JSON — a success status for a failed call.
EOF

