// scripts/smoke.cjs — start the server, run the 67-check suite against it, stop it.
//
// WHY THIS EXISTS: up to now this was done by hand — background the server, sleep,
// curl, kill. That dance produced two false failures during the build (a stale
// server holding the port and answering with OLD code, which made a correct fix
// look broken). A script cannot forget to kill the previous process.
//
// It runs on its OWN port (4699) by default, so `yarn smoke` never fights a dev
// server on 4600 — and never silently tests the wrong build.
const { spawn } = require('child_process');
const path = require('path');
const net = require('net');

const ROOT = path.join(__dirname, '..');
const PORT = Number(process.env.SMOKE_PORT || 4699);
// THE ONE DATABASE NAME FOR THE WHOLE RUN: the server child AND the test child must both be
// told it, because the test file talks to the models directly. One child inheriting it is not
// the same as the run inheriting it.
const TEST_DB = process.env.SMOKE_DB_NAME || 'farmline_test';
const BASE = `http://127.0.0.1:${PORT}`;

function portFree() {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once('error', () => resolve(false));
    s.once('listening', () => s.close(() => resolve(true)));
    s.listen(PORT);
  });
}

(async () => {
  console.log(`\nfarmline smoke  (port ${PORT})\n`);

  if (!(await portFree())) {
    console.error(`  FATAL port ${PORT} is already in use — refusing to run, because testing an`);
    console.error(`        unknown server is worse than testing nothing.`);
    process.exit(1);
  }

  const child = spawn(process.execPath, [path.join(ROOT, 'src', 'index.js')], {
    cwd: ROOT,
    // THE TESTS GET THEIR OWN DATABASE (2026-10-13): every run used to write its artifacts
    // into the database the farmers use. "farmline_test" by default; override with SMOKE_DB_NAME.
    env: {
      ...process.env,
      PORT: String(PORT),
      NODE_ENV: process.env.NODE_ENV || 'development',
      FARMLINE_DB_NAME: TEST_DB,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let bootLog = '';
  child.stdout.on('data', (d) => { bootLog += d.toString(); });
  child.stderr.on('data', (d) => { bootLog += d.toString(); });

  const stop = () => { try { child.kill('SIGTERM'); } catch { /* already gone */ } };
  process.on('exit', stop);
  process.on('SIGINT', () => { stop(); process.exit(130); });

  // Wait for /health rather than sleeping a fixed number of seconds.
  //
  // BUDGET: 150s. It was 30s, and that failed on this machine — a boot takes ~48s
  // when two other Angular dev servers are running (zyppar runs `ng serve --poll
  // 2000`, which is heavy). A short budget turns a slow machine into a RED build and
  // sends you hunting a bug in code that is fine. A genuine hang never becomes
  // healthy, so a generous ceiling costs nothing but wall-clock on real failures.
  let up = false;
  for (let i = 0; i < 300; i++) {
    await new Promise((r) => setTimeout(r, 500));
    try {
      const r = await fetch(BASE + '/health');
      if (r.ok) { up = true; break; }
    } catch { /* not yet */ }
    if (child.exitCode !== null) break;
  }

  if (!up) {
    console.error('  FATAL the server never became healthy. Boot output:\n');
    console.error(bootLog.split('\n').map((l) => '        ' + l).join('\n'));
    stop();
    process.exit(1);
  }

  const health = await fetch(BASE + '/health').then((r) => r.json()).catch(() => null);
  console.log(`  ok    server healthy — db=${health?.db} dbName=${health?.dbName} auth=${health?.authArmed ? 'ARMED' : 'OPEN'} money=${health?.moneyMode}`);
  // THE GUARD, INVERTED (2026-10-13). It used to REFUSE anything but "farmline" - which
  // made a test database impossible and guaranteed the pollution. Now it refuses the REAL
  // database: a test run may never write its farms into the place real farmers live. A
  // database explicitly named for testing is the only thing accepted.
  const dbName = String(health?.dbName || '');
  if (!/_test$/.test(dbName)) {
    console.error(`  FATAL the smoke is pointed at "${dbName}" - not a *_test database. Refusing to write test farms into it.`);
    stop(); process.exit(1);
  }
  console.log(`  ok    the test database is "${dbName}" - the app's own database is untouched`);

  // Three suites, in order:
  //   1. integration.js  — does the server BEHAVE?
  //   2. ui-contract.js  — can the app READ what the server says?
  //   3. chat-money.js   — do the two new doors work, and is the money rail honest?
  // The second exists because a renamed field passes every server test and shows the
  // farmer an empty screen. The third exists because chat can fail invisibly and a
  // fabricated payment is the worst bug this codebase could ship.
  const run = (file) => new Promise((resolve) => {
    const t = spawn(process.execPath, [path.join(ROOT, 'test', file)], {
      cwd: ROOT,
      env: { ...process.env, FARMLINE_TEST_BASE: BASE, FARMLINE_DB_NAME: TEST_DB },
      stdio: 'inherit',
    });
    t.on('exit', resolve);
  });

  const a = await run('integration.js');
  const b = await run('ui-contract.js');
  const c = await run('chat-money.js');
  const code = (a === 0 && b === 0 && c === 0) ? 0 : 1;

  stop();
  await new Promise((r) => setTimeout(r, 300));

  console.log(code === 0 ? '\nSMOKE PASSED\n' : '\nSMOKE FAILED\n');
  process.exit(code);
})();
