// scripts/restart-b2.cjs — restart the API WITH the announce secret + a
// mandatory floor, then run the B2 push probe. Cleans up after.
const { execSync, spawn } = require('child_process');
const netstat = execSync('netstat -ano', { encoding: 'utf8' });
const pids = new Set();
for (const line of netstat.split('\n')) {
  if (line.includes(':4600') && line.includes('LISTENING')) {
    const pid = Number(line.trim().split(/\s+/).pop());
    if (pid > 0) pids.add(pid);
  }
}
for (const pid of pids) { try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' }); console.log('killed', pid); } catch { } }
const srv = spawn('node', ['src/index.js'], {
  cwd: __dirname + '/..', detached: true, stdio: 'ignore',
  env: { ...process.env, FARMLINE_ANNOUNCE_SECRET: 'fl-test-announce', FARMLINE_MANDATORY_BUILD: '2' },
});
srv.unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let up = false;
  for (let i = 0; i < 30; i++) { await sleep(500); try { const h = await fetch('http://localhost:4600/api/farmline/health').then((r) => r.json()); if (h.ok) { up = true; break; } } catch { } }
  console.log('server up:', up);
  if (!up) process.exit(1);
  const p = spawn('node', ['scripts/fl-b2-push.cjs'], { cwd: __dirname + '/..', stdio: 'inherit' });
  p.on('exit', (c) => {
    // cleanup: restart clean (no test env) — the standard server comes back.
    try { execSync('taskkill /PID ' + srv.pid + ' /T /F', { stdio: 'ignore' }); } catch { }
    const clean = spawn('node', ['src/index.js'], { cwd: __dirname + '/..', detached: true, stdio: 'ignore' });
    clean.unref();
    process.exit(c || 0);
  });
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });