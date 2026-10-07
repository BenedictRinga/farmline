// scripts/plan-trusted-report.cjs — the trusted session's executed report
// into the plan (both repos read it).
const fs = require('fs');
let s = fs.readFileSync('PLAN.md', 'utf8');
if (s.includes('THE TRUSTED SESSION EXECUTED')) { console.log('  ok (already)'); process.exit(0); }
const lines = s.split('\n');
const idx = lines.findIndex((l) => l.includes('one paste for the founder.**'));
if (idx === -1) { console.log('  ✗ marker miss'); process.exit(1); }
const add = [
  '**THE TRUSTED SESSION EXECUTED THE DROPLET WORK (Farmline.txt, 2026-10-07',
  '18:05 EAT — read and ported by this thread): (1) THE WATCH IS INSTALLED',
  'AND FIXED — /etc/cron.d/farmline-watch, every minute, with TWO bugs of the',
  'brief\u2019s scripts caught droplet-side and now PORTED BACK to the repo:',
  'THE DAEMON BUG (the cron runs as root; bare pm2 reaches ROOT\u2019s daemon',
  'while farmline-server lives in APPUSER\u2019s — the heal now runs',
  'sudo -u appuser pm2 restart with a pm2 resurrect fallback covering the',
  'process GONE from the list, which happened TWICE today) and THE 301 BUG',
  '(http://127.0.0.1 probes 301 to https; curl -sL now follows). (2) THE',
  'REVIVAL PATTERN IS KNOWN: the deaths land in DEPLOY WINDOWS run with the',
  'wrong pm2 daemon — so the server deploy.sh\u2019s pm2 actions now ALWAYS run',
  'as appuser (the DAEMON LAW, pm2_as). (3) THE GENERATOR\u2019S PROPOSAL',
  'FAILED nginx -t (the stale unquoted ~:440 line survives the surgery span);',
  'the apply was caught + restored; the lesson is now IN THE GENERATOR: a',
  'MANDATORY REVIEW BEFORE APPLY section prints every remaining farmline',
  'line + hunts unquoted-brace regexes. THE LIVE CONFIG IS THE GOOD ONE —',
  'the 404s were the DEAD PROCESS, not nginx; the consolidation stays',
  'OPTIONAL (the proposal sits at /tmp/farmline-proposed-20261007-153841.conf',
  'for when the founder wants it). REMAINING on the droplet: only the',
  'optional FARMLINE_ALERT_WEBHOOK. The known-good baseline:',
  'zyppar.com.bak-20261007-knowngood.**',
];
lines.splice(idx + 1, 0, add.join('\n'));
fs.writeFileSync('PLAN.md', lines.join('\n'));
console.log('  the trusted session\u2019s report recorded');
