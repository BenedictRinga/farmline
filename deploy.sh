#!/usr/bin/env bash
# deploy.sh — the ONE deploy sequence for farmline-server. Mirrors /opt/rolodex-server/deploy.sh.
#
# fetch → reset --hard → pull → yarn → env → pm2 restart --update-env → pm2 save
#
# NEVER type a bare `git pull && pm2 restart farmline-server` on the droplet: it
# skips the yarn install, the .env checks, `--update-env` and `pm2 save`, and it
# regresses the droplet.
set -euo pipefail

# THE RE-EXEC GUARD (2026-10-09, the twin of the app's fix): step 2's
# `git reset --hard` rewrites THIS SCRIPT while bash is executing it — bash
# reads lazily from the file's byte offset, so after the reset it can continue
# into older script text. A deploy script that the reset will replace must not
# run from that file: it copies itself to /tmp and execs the copy.
if [ "${FL_DEPLOY_REEXEC:-}" != "1" ]; then
  TMP_SELF="/tmp/farmline-deploy-server.$$.sh"
  cp "$0" "$TMP_SELF"
  chmod +x "$TMP_SELF"
  FL_DEPLOY_REEXEC=1 exec bash "$TMP_SELF" "$@"
fi
rm -f "$0" 2>/dev/null || true

DEPLOY_DIR="${FARMLINE_DEPLOY_DIR:-/opt/farmline-server}"
PM2_NAME="farmline-server"
# THE DAEMON LAW (the trusted session's finding, 2026-10-07): farmline-server
# lives in the APPUSER's pm2 daemon. A deploy run as root reaches ROOT's daemon
# instead — it does not restart farmline-server at all, and its pm2 actions
# DISTURB the appuser process list (farmline-server died twice on 2026-10-07,
# in deploy windows; the watch's resurrect fallback absorbed both). The pm2
# actions in this deploy therefore ALWAYS run as appuser, whoever runs it.
APP_USER="${FARMLINE_APP_USER:-appuser}"
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


# THE COUNTER LAW (JSON-AWARE, v3 — 2026-10-09): the build number climbs on
# EVERY deploy — max(package.json, commit count)+1. The sed form was a JSON
# bomb (it matched the scripts' "build" key too and broke package.json for
# yarn). Node parses the JSON properly; the node binary is discovered from
# yarn's own shebang path if PATH lacks it; if node is truly unreachable the
# counter honestly skips (the same-number deploy; never a broken file).
NODE_BIN="$(command -v node || true)"
if [ -z "$NODE_BIN" ] && [ -x /usr/bin/node ]; then NODE_BIN=/usr/bin/node; fi
if [ -z "$NODE_BIN" ] && [ -x "$(dirname "$(readlink -f "$(command -v yarn)")")/node" ]; then NODE_BIN="$(dirname "$(readlink -f "$(command -v yarn)")")/node"; fi
COMMITS=$(git rev-list --count HEAD 2>/dev/null || echo 0)
if [ -n "$NODE_BIN" ]; then
  "$NODE_BIN" -e "const fs=require('fs');const p=JSON.parse(fs.readFileSync('package.json','utf8'));p.build=Math.max(Number(p.build)||0,Number(process.argv[1])||0)+1;fs.writeFileSync('package.json',JSON.stringify(p,null,2)+String.fromCharCode(10));console.log('  build counter -> '+p.build)" "$COMMITS"
else
  echo "  ⚠ node not found — the build counter SKIPPED this deploy (the same-number deploy; never a broken package.json)"
fi
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
# THE DAEMON LAW (the trusted session's finding, 2026-10-07): farmline-server
# lives in the APPUSER's pm2 daemon. A deploy run as root reaches ROOT's
# daemon instead — it does not restart farmline-server at all, and its pm2
# actions DISTURB the appuser process list (the process died twice today in
# deploy windows; the watch's resurrect fallback absorbed both). So the pm2
# actions here ALWAYS run as appuser, whoever runs the deploy.
pm2_as() { if [ "$(id -un)" = "$APP_USER" ]; then pm2 "$@"; else sudo -u "$APP_USER" pm2 "$@"; fi; }
# THE RESTART GUARANTEE (2026-10-09, the collapse law): the restart's failure
# is VISIBLE, the start-if-missing follows, and the resurrect is the net — and
# the health gate must pass before this deploy may succeed. A failed deploy
# resurrects; it can never leave the app down silently (the 06:15:50 lesson).
if ! pm2_as restart "$PM2_NAME" --update-env; then
  echo "  restart failed — starting from scratch…"
  pm2_as start "$DEPLOY_DIR/src/index.js" --name "$PM2_NAME" || true
fi
pm2_as resurrect >/dev/null 2>&1 || true
pm2_as save
PORT_GATE="${PORT:-4600}"
sleep 2
if ! curl -fsS "http://localhost:${PORT_GATE}/health" >/dev/null 2>&1; then
  sleep 3
  pm2_as resurrect >/dev/null 2>&1 || true
  sleep 3
fi
if ! curl -fsS "http://localhost:${PORT_GATE}/health" >/dev/null 2>&1; then
  echo "  ✗ THE APP DID NOT COME UP — resurrected twice; the deploy FAILED."
  echo "    The process is up (the watch pattern); the reason is in: pm2 logs $PM2_NAME"
  exit 1
fi
echo "  ✓ the app is up and answering the health gate"

# 6.5  THE NGINX REQUEST (THE NGINX LAW, 2026-10-07 — HARD: no script writes
# nginx; agents/scripts make REQUESTS, the founder executes by hand). The
# generator diagnoses the live conf, builds the proposed conf into /tmp, and
# prints the diff + the exact apply commands. It NEVER touches /etc/nginx.
# The old auto-ensure (backup → surgery → reload) is retired; the /opt/
# farmline-nginx-guarantee/ package is obsolete.
bash scripts/farmline-nginx-ensure.sh || echo "  ⚠ the request generator failed — the deploy continues"

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

