// scripts/daemon-law.cjs — apply the daemon law to the deploy's pm2 block
// (the trusted session's finding: the pm2 actions must run as appuser,
// whoever runs the deploy).
const fs = require('fs');
const f = 'deploy.sh';
let s = fs.readFileSync(f, 'utf8');
if (s.includes('pm2_as')) { console.log('  ok (already)'); process.exit(0); }

const OLD = [
  'echo "6/7  restarting via pm2…"',
  'pm2 restart "$PM2_NAME" --update-env 2>/dev/null || pm2 start src/index.js --name "$PM2_NAME"',
  'pm2 save',
].join('\n');
if (!s.includes(OLD)) { console.log('  ✗ pm2 block anchor miss'); process.exit(1); }

const NEW = [
  'echo "6/7  restarting via pm2…"',
  '# THE DAEMON LAW (the trusted session\'s finding, 2026-10-07): farmline-server',
  '# lives in the APPUSER\'s pm2 daemon. A deploy run as root reaches ROOT\'s',
  '# daemon instead — it does not restart farmline-server at all, and its pm2',
  '# actions DISTURB the appuser process list (the process died twice today in',
  '# deploy windows; the watch\'s resurrect fallback absorbed both). So the pm2',
  '# actions here ALWAYS run as appuser, whoever runs the deploy.',
  'pm2_as() { if [ "$(id -un)" = "$APP_USER" ]; then pm2 "$@"; else sudo -u "$APP_USER" pm2 "$@"; fi; }',
  'pm2_as restart "$PM2_NAME" --update-env 2>/dev/null || pm2_as start "$DEPLOY_DIR/src/index.js" --name "$PM2_NAME"',
  'pm2_as resurrect >/dev/null 2>&1 || true',
  'pm2_as restart "$PM2_NAME" --update-env 2>/dev/null || true',
  'pm2_as save',
].join('\n');
s = s.replace(OLD, NEW);
fs.writeFileSync(f, s);
console.log('  the daemon law applied to deploy.sh');
