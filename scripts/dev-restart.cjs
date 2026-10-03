// scripts/dev-restart.cjs — clear whatever is on the dev port, then start clean.
//
// WHY THIS EXISTS: the most expensive dev failure in this project was a leftover
// `node src/index.js` from an earlier session holding :4600 with OLD code. A correct
// fix looked broken, twice. `yarn dev` refuses to start a second server (that is the
// right call), but refusing leaves you stuck if the one running is stale.
//
// This is the way out: find the process on the port, stop it, start again.
const { execSync, spawn } = require('child_process');
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

/** Every PID listening on the port. Windows netstat, and lsof everywhere else. */
function pidsOnPort(port) {
  const pids = new Set();
  try {
    if (process.platform === 'win32') {
      const out = execSync('netstat -ano', { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      for (const line of out.split('\n')) {
        if (!line.includes(`:${port} `)) continue;
        if (!/LISTENING/i.test(line)) continue;
        const pid = line.trim().split(/\s+/).pop();
        if (/^\d+$/.test(pid)) pids.add(pid);
      }
    } else {
      const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
      for (const pid of out.split('\n')) if (/^\d+$/.test(pid.trim())) pids.add(pid.trim());
    }
  } catch { /* nothing listening, or the tools are unavailable */ }
  return [...pids];
}

console.log(`\nfarmline dev:restart  (port ${PORT})\n`);

const pids = pidsOnPort(PORT);
if (!pids.length) {
  console.log('  nothing is listening on that port — starting normally.');
} else {
  for (const pid of pids) {
    // Say WHO is being killed before killing it. Blindly stopping a PID the user did
    // not expect (their editor's language server, another product) would be worse than
    // the stale server this is meant to fix.
    let what = 'unknown process';
    try {
      if (process.platform === 'win32') {
        const cl = execSync(
          `powershell.exe -NoProfile -Command "(Get-CimInstance Win32_Process -Filter 'ProcessId=${pid}').CommandLine"`,
          { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
        ).trim();
        if (cl) what = cl;
      } else {
        what = execSync(`ps -p ${pid} -o command=`, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
      }
    } catch { /* leave it as unknown */ }

    const ours = /farmline/i.test(what) || /src[\\/]index\.js/.test(what) || /node/i.test(what);
    if (!ours) {
      console.log(`  pid ${pid} is NOT a node process — leaving it alone.`);
      console.log(`      ${what}`);
      console.log('  Stop it yourself if it should not be there.');
      process.exit(1);
    }

    console.log(`  stopping pid ${pid}`);
    console.log(`      ${what}`);
    try {
      execSync(process.platform === 'win32' ? `taskkill /PID ${pid} /T /F` : `kill -9 ${pid}`, { stdio: 'ignore' });
    } catch { console.log(`      could not stop ${pid} — you may need elevated rights`); }
  }
  // Let the socket actually release before rebinding.
  const until = Date.now() + 3000;
  while (Date.now() < until) { /* brief settle */ }
}

console.log('\n  starting a clean server…\n');
const child = spawn(process.execPath, [path.join(ROOT, 'src', 'index.js')], { cwd: ROOT, stdio: 'inherit', env: process.env });
process.on('exit', () => { try { child.kill('SIGTERM'); } catch { /* gone */ } });
process.on('SIGINT', () => { try { child.kill('SIGTERM'); } catch { /* gone */ } process.exit(130); });
child.on('exit', (code) => process.exit(code ?? 0));
