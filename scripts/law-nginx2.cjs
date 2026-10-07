// scripts/law-nginx2.cjs — v2: the law's anchor matches the founder-edited
// plan tail ('...one paste for the founder.**'); then the watch correction.
const fs = require('fs');

// 1. THE LAW in the plan.
{
  let s = fs.readFileSync('PLAN.md', 'utf8');
  if (!s.includes('THE NGINX LAW')) {
    const lines = s.split('\n');
    const idx = lines.findIndex((l) => l.includes('one paste for the founder.**'));
    if (idx === -1) { console.log('  ✗ law insert line miss'); process.exit(1); }
    const law = [
      '**THE NGINX LAW (the founder, 2026-10-07 — HARD, supersedes every nginx',
      'automation): NO SCRIPT WRITES NGINX. Not the watch, not the ensure on a',
      'cron, not an agent over SSH. nginx serves THREE apps on this droplet —',
      'one bad line fails them all at once. THE SHAPE FROM NOW ON: agents make',
      'REQUESTS (the exact lines, the exact file) and the FOUNDER EXECUTES the',
      'nginx change by hand. The ensure/ship/surgery scripts remain in the repo',
      'as FOUNDER-EXECUTION-ONLY artifacts — never run by an agent, never by a',
      'cron, never inside a watch. The farmline-watch CHECKS and TELLS only;',
      "its only self-service is pm2 restart of farmline's OWN Node process.**",
    ];
    lines.splice(idx + 1, 0, law.join('\n'));
    fs.writeFileSync('PLAN.md', lines.join('\n'));
    console.log('  THE NGINX LAW recorded in the plan');
  } else console.log('  ok (already)');
}

// 2. THE WATCH corrected.
{
  const f = 'scripts/farmline-watch.sh';
  let s = fs.readFileSync(f, 'utf8');
  if (!s.includes('THE NGINX LAW')) {
    s = s.replace(/# farmline-watch\.sh[\s\S]*?# Idempotent and quiet when healthy: only state changes speak\.\n/, [
      '# farmline-watch.sh — THE EARLY WARNING (the founder, 2026-10-07).',
      '#',
      '# THE NGINX LAW (HARD): THIS SCRIPT NEVER WRITES NGINX. nginx serves THREE',
      '# apps on this droplet — one bad line fails them all at once. On failure the',
      '# watch TELLS the founder (log + webhook when armed) with the exact command',
      '# SHE can run; agents make requests, the founder executes nginx changes.',
      '#',
      '# Runs every minute (cron). The layers:',
      '#   1. CHECK  — the API through nginx, exactly as a phone reaches it.',
      "#   2. OWN-PROCESS HEAL — pm2 restart farmline-server (farmline's OWN Node",
      '#      process; never nginx, never a neighbour).',
      '#   3. TELL   — every state change logged; when FARMLINE_ALERT_WEBHOOK is',
      '#      armed in the .env, a POST carries the message + the handover command.',
      '#',
      '# Idempotent and quiet when healthy: only state changes speak.',
      '',
    ].join('\n'));

    const start = s.indexOf('# ── DOWN: heal before telling');
    const endMark = 'notify "API IS DOWN (code $code, after ensure $code2, after pm2 restart $code3)';
    const end = s.indexOf(endMark);
    if (start === -1 || end === -1) { console.log('  ✗ heal block anchors miss'); process.exit(1); }
    s = s.slice(0, start) + [
      "# ── DOWN: farmline's OWN process first; nginx belongs to the founder ─────────",
      'if [ -d "$SERVER_DIR" ]; then',
      '  cd "$SERVER_DIR" || true',
      '  pm2 restart farmline-server >/dev/null 2>&1 || true',
      '  sleep 4',
      '  code2="$(curl -s -o /tmp/fl-watch-body2 -w \'%{http_code}\' -H "Host: ${HOST_HDR}" --max-time 8 "$BASE_URL" 2>/dev/null)"',
      '  if [ "$code2" = "200" ] && grep -q \'"ok":true\' /tmp/fl-watch-body2 2>/dev/null; then',
      '    notify "API was DOWN (code $code) — the pm2 restart of farmline-server healed it. Now up."',
      '    echo ok > "$STATE_FILE"',
      '    exit 0',
      '  fi',
      'fi',
      '',
      '',
    ].join('\n') + s.slice(end);

    s = s.replace(
      "notify \"API IS DOWN (code $code, after ensure $code2, after pm2 restart $code3) — needs a human: run 'cd $SERVER_DIR && sudo bash scripts/farmline-nginx-ensure.sh && sudo nginx -t && sudo systemctl reload nginx' and check 'pm2 logs farmline-server'.",
      'notify "API IS DOWN (code $code, after pm2 restart $code2) — THE FOUNDER\'S NGINX HAND IS NEEDED. On the droplet: cd /opt/farmline-server && sudo git fetch origin && sudo git reset --hard origin/main && sudo bash scripts/farmline-nginx-ensure.sh && sudo nginx -t && sudo systemctl reload nginx. Then check pm2 logs farmline-server."'
    );
    fs.writeFileSync(f, s);
    console.log('  the watch corrected: check + tell, never nginx');
  } else console.log('  watch already under the law');
}
