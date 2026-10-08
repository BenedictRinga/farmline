// scripts/plan-watch.cjs — the 404 incident + the watch, into the plan.
const fs = require('fs');
let s = fs.readFileSync('PLAN.md', 'utf8');
if (s.includes('THE 404 INCIDENT')) { console.log('  ok (already)'); process.exit(0); }
const lines = s.split('\n');
const idx = lines.findIndex((l) => l.includes('./gradlew assembleDebug'));
if (idx === -1) { console.log('  ✗ marker line miss'); process.exit(1); }
const add = [
  '**THE 404 INCIDENT + THE WATCH (the founder, 2026-10-07: "Farm is currently',
  '404. I need to hear this faster, not from users. But first revive it."):',
  'DIAGNOSED from outside: the static shell serves (200), but /api/farmline/*',
  'answers NGINX\'s own 404 — the API proxy block is GONE from the site conf',
  'while the static regexes survived; the pattern matches a site-conf',
  'regeneration (a Zyppar deploy) eating the INSERTED farmline block. THE',
  'REVIVAL (one paste on the droplet): cd /opt/farmline-server && sudo git',
  'fetch origin && sudo git reset --hard origin/main && sudo bash',
  'scripts/farmline-nginx-ensure.sh && sudo nginx -t && sudo systemctl reload',
  'nginx && curl -s -H "Host: zyppar.com" http://127.0.0.1/api/farmline/health',
  '(expect {"ok":true). THE WATCH (farmline-watch.sh + install-watch.sh,',
  'committed): every minute — the API through nginx as a phone reaches it; on',
  'failure the ensure re-inserts the block + reload, then the pm2 restart;',
  'every state change logged to /var/log/farmline-watch.log and, when',
  'FARMLINE_ALERT_WEBHOOK is armed in /opt/zyppar-server/.env, POSTed to',
  'wherever she reads it. THE AGENT COULD NOT SSH (the droplet rejects both',
  'keys from this machine) — hence the one paste for the founder.**',
];
lines.splice(idx + 1, 0, add.join('\n'));
fs.writeFileSync('PLAN.md', lines.join('\n'));
console.log('  incident + watch recorded');
