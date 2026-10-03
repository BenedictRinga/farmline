// scripts/dev.cjs — `yarn dev`: start the dev server AND open the browser.
//
// LoopKeeper gets this from `ng serve --open`. farmline is not Angular, so it had
// no equivalent — `yarn dev` started a server silently and left you to find the
// URL yourself. This is that missing piece.
//
// It also refuses to fight itself. Starting a second server on a port that is
// already serving farmline is the single most confusing thing that can happen in
// dev (a stale process answers with OLD code and a correct fix looks broken). If
// something is already there, this says so and just opens the browser at it.
const { spawn, exec } = require('child_process');
const path = require('path');
const fs = require('fs');

const ROOT = path.join(__dirname, '..');

function envFromFile(name) {
  try {
    for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m && m[1] === name) return m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* no .env */ }
  return null;
}

const PORT = Number(process.env.PORT || envFromFile('PORT') || 4600);
const BASE_PATH = process.env.BASE_PATH || envFromFile('BASE_PATH') || '/farmline';
const APP_URL = `http://localhost:${PORT}${BASE_PATH}/`;
// The API lives at its OWN prefix (nginx-proxied in production), never under
// BASE_PATH — so this is hardcoded to the API prefix rather than derived.
const VERSION_URL = `http://127.0.0.1:${PORT}/api/farmline/version`;
const OPEN = process.env.NO_OPEN !== '1';

function openBrowser(url) {
  if (!OPEN) return console.log(`  (NO_OPEN=1 — not launching a browser. Open: ${url})`);
  const cmd = process.platform === 'win32' ? `start "" "${url}"`
    : process.platform === 'darwin' ? `open "${url}"`
    : `xdg-open "${url}"`;
  exec(cmd, { shell: process.platform === 'win32' ? 'cmd.exe' : '/bin/sh' }, (err) => {
    if (err) console.log(`  could not launch a browser automatically — open this: ${url}`);
  });
}

/** Is a farmline server already answering on this port? Returns its version, or false. */
async function farmlineOn() {
  try {
    const r = await fetch(VERSION_URL, { signal: AbortSignal.timeout(1500) });
    const j = await r.json();
    return j && j.build ? j : false;
  } catch { return false; }
}

(async () => {
  console.log('\nfarmline dev\n');

  // ── already running? ───────────────────────────────────────────────────────
  const existing = await farmlineOn();
  if (existing) {
    console.log(`  a farmline server is ALREADY on :${PORT} — build ${existing.build} · env=${existing.env} · db=${existing.dbName}`);
    console.log('  Not starting a second one (a stale process silently answering with old code is');
    console.log('  the worst dev failure there is). Restart it yourself if you changed src/.');
    console.log(`\n  ${APP_URL}\n`);
    openBrowser(APP_URL);
    return;
  }

  // ── start the watcher ──────────────────────────────────────────────────────
  const child = spawn(process.execPath, ['--watch', path.join(ROOT, 'src', 'index.js')], {
    cwd: ROOT, stdio: 'inherit', env: process.env,
  });

  const stop = () => { try { child.kill('SIGTERM'); } catch { /* gone */ } };
  process.on('exit', stop);
  process.on('SIGINT', () => { stop(); process.exit(130); });
  process.on('SIGTERM', () => { stop(); process.exit(143); });

  // ── wait for health, then open ─────────────────────────────────────────────
  let up = null;
  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 400));
    if (child.exitCode !== null) break;
    up = await farmlineOn();
    if (up) break;
  }

  if (!up) {
    console.error(`\n  the server did not come up on :${PORT}. Check the output above.`);
    stop();
    process.exit(1);
  }

  console.log(`\n  ${up.isProduction === true ? 'PRODUCTION' : (up.env || 'dev').toUpperCase()} · db=${up.dbName} · build ${up.build}`);
  console.log(`  app   ${APP_URL}`);
  console.log(`  edit  public/index.html and reload — no rebuild, no restart`);
  console.log(`  seed  yarn seed   (in another terminal, for a populated farm)\n`);
  openBrowser(APP_URL);

  child.on('exit', (code) => process.exit(code ?? 0));
})();
