// scripts/restart-and-probe.cjs — kill the holder of :4600, start the fresh
// server, run the truth-chain probe, stop the server. One command, no shell
// quoting games (the intermittent BASHRC reset keeps eating inline pipes).
const { execSync, spawn } = require('child_process');
const netstat = execSync('netstat -ano', { encoding: 'utf8' });
const pids = new Set();
for (const line of netstat.split('\n')) {
  if (line.includes(':4600') && line.includes('LISTENING')) {
    const pid = Number(line.trim().split(/\s+/).pop());
    if (pid > 0) pids.add(pid);
  }
}
for (const pid of pids) {
  try { execSync(`taskkill /PID ${pid} /T /F`, { stdio: 'ignore' }); console.log('killed', pid); } catch { }
}
const srv = spawn('node', ['src/index.js'], { cwd: __dirname + '/..', detached: true, stdio: 'ignore' });
srv.unref();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
(async () => {
  let up = false;
  for (let i = 0; i < 30; i++) {
    await sleep(500);
    try { const h = await fetch('http://localhost:4600/api/farmline/health').then((r) => r.json()); if (h.ok) { up = true; break; } } catch { }
  }
  console.log('server up:', up);
  if (!up) process.exit(1);
  const chk = async (cb) => {
    const r = await fetch(`http://localhost:4600/api/farmline/updates/check?clientBuild=${cb}`);
    return r.json();
  };
  const stamp = JSON.parse(require('fs').readFileSync(__dirname + '/../../farmline-app/www/build.json', 'utf8'));
  console.log('served bundle stamp:', JSON.stringify(stamp));
  let fail = 0;
  const a = await chk(1);
  console.log(`clientBuild=1 → build ${a.build} | available: ${a.isUpdateAvailable}`);
  if (Number(a.build) !== Number(stamp.build) || !a.isUpdateAvailable) { console.log('FAIL behind-client'); fail++; }
  const b = await chk(stamp.build);
  console.log(`clientBuild=${stamp.build} → available: ${b.isUpdateAvailable} (must be false)`);
  if (b.isUpdateAvailable) { console.log('FAIL current-client'); fail++; }
  const c = await chk(stamp.build - 6);
  console.log(`clientBuild=${stamp.build - 6} → available: ${c.isUpdateAvailable} (must be true)`);
  if (!c.isUpdateAvailable) { console.log('FAIL behind-client-6'); fail++; }
  console.log(fail ? `\n${fail} FAIL` : '\nTHE CHECK READS THE SERVED BUNDLE — the truth');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });