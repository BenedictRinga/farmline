// scripts/preflight.cjs — run BEFORE the server starts, and before any deploy.
//
// The LoopKeeper equivalent of this logic lives scattered inside deploy.sh. Here
// it is one script so `yarn preflight` answers the same question locally and on
// the droplet: is this machine actually able to run farmline right now?
//
// It FAILS LOUDLY on the things that fail silently in production:
//   · an unset AUTH_SECRET means the write gate is OPEN (by design) — fatal on a
//     public host, fine on a laptop
//   · FARMLINE_USE_LOCAL_MONGO=true on a droplet means it will hunt for a mongod
//     that is not there
//   · a Mongo database name that is not `farmline` would write into another
//     tenant — the one thing AGENTS.md forbids outright
//
// Exit 0 = go. Exit 1 = do not start.
const fs = require('fs');
const path = require('path');
const net = require('net');

const ROOT = path.join(__dirname, '..');
let fatal = 0;
let warn = 0;
const pass = (m) => console.log('  ok    ' + m);
const bad = (m) => { fatal++; console.log('  FATAL ' + m); };
const soft = (m) => { warn++; console.log('  warn  ' + m); };

function readEnv(file) {
  const out = {};
  try {
    for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
      const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
      if (m) out[m[1]] = m[2].trim().replace(/^["']|["']$/g, '');
    }
  } catch { /* no file */ }
  return out;
}

const isProd = process.env.NODE_ENV === 'production' || !!process.env.FARMLINE_PROD;
console.log(`\nfarmline preflight  (${isProd ? 'PRODUCTION' : 'development'})\n`);

// ── 1. node + deps ────────────────────────────────────────────────────────────
console.log('runtime');
const major = Number(process.versions.node.split('.')[0]);
major >= 20 ? pass(`node ${process.versions.node}`) : bad(`node ${process.versions.node} — needs >=20`);

const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
for (const dep of Object.keys(pkg.dependencies || {})) {
  try { require.resolve(dep, { paths: [ROOT] }); pass(`dependency ${dep}`); }
  catch { bad(`dependency ${dep} is not installed — run: yarn install`); }
}
const depCount = Object.keys(pkg.dependencies || {}).length;
depCount <= 2 ? pass(`dependency count is ${depCount} (AGENTS.md caps it at two)`)
              : soft(`${depCount} dependencies — AGENTS.md says two without explicit approval`);

// ── 2. the app shell ──────────────────────────────────────────────────────────
console.log('\napp');
const shell = path.join(ROOT, 'public', 'index.html');
if (fs.existsSync(shell)) {
  const html = fs.readFileSync(shell, 'utf8');
  const kb = Buffer.byteLength(html) / 1024;
  pass(`public/index.html present (${kb.toFixed(1)} KB)`);
  kb > 120 ? soft(`${kb.toFixed(1)} KB is heavy for a rural 2G target`) : null;
  /https?:\/\/(fonts|cdn)\./i.test(html)
    ? bad('the shell references an external font/CDN — AGENTS.md forbids it')
    : pass('shell is self-contained (no external fonts or CDNs)');
  const stamped = html.match(/<meta\s+name="farmline-build"\s+content="(\d+)"/);
  stamped ? pass(`shell stamped with build ${stamped[1]}`)
          : soft('shell is NOT stamped — run `yarn build` so the app can self-heal a stale cache');
} else {
  bad('public/index.html is missing — the app has nothing to serve');
}

// ── 3. .env ───────────────────────────────────────────────────────────────────
console.log('\nenvironment');
const envFile = path.join(ROOT, '.env');
const fileEnv = readEnv(envFile);
const get = (k) => (process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : fileEnv[k]);
fs.existsSync(envFile) ? pass('.env present') : soft('.env absent — falling back to .env.example defaults');

const auth = get('AUTH_SECRET');
if (!auth) {
  isProd ? bad('AUTH_SECRET is UNSET — THE WRITE GATE WILL FAIL OPEN ON A PUBLIC HOST')
         : soft('AUTH_SECRET unset — the gate fails open (fine locally, never on the droplet)');
} else if (auth.length < 32) {
  bad(`AUTH_SECRET is only ${auth.length} chars — use 64 hex chars`);
} else {
  pass(`AUTH_SECRET set (${auth.length} chars)`);
}

const admin = get('FARMLINE_ADMIN_KEY');
admin ? pass('FARMLINE_ADMIN_KEY set (admin routes reachable)')
      : soft('FARMLINE_ADMIN_KEY unset — /api/farmline/admin/* answers 403 (door sealed, never open)');

const mode = get('MONEY_MODE') || 'virtual';
['virtual', 'mpesa'].includes(mode) ? pass(`MONEY_MODE=${mode}`) : bad(`MONEY_MODE=${mode} is not virtual|mpesa`);
if (mode === 'mpesa') {
  const armed = ['MPESA_CONSUMER_KEY', 'MPESA_CONSUMER_SECRET', 'MPESA_SHORTCODE', 'MPESA_PASSKEY'].every((k) => get(k));
  armed ? pass('M-Pesa credentials present — REAL MONEY will move')
        : bad('MONEY_MODE=mpesa but the Daraja credentials are incomplete — switch back to virtual');
} else {
  pass('money is virtual (ZU) — no real money can move, by construction');
}

// ── 4. database ───────────────────────────────────────────────────────────────
console.log('\ndatabase');
const useLocal = (get('FARMLINE_USE_LOCAL_MONGO') || 'true') === 'true';
if (isProd && useLocal) {
  bad('FARMLINE_USE_LOCAL_MONGO=true on a production host — there is no local mongod on a droplet');
} else {
  pass(`local mongo: ${useLocal}`);
}
const uri = get('MONGO_DB_URI_FARMLINE') || get('MONGO_LOCAL_URI') || '(none — will derive or fail)';
// The one invariant that must never break: farmline owns its own database.
const dbName = (uri.match(/\/([^/?]+)(\?|$)/) || [])[1] || '';
if (dbName && !['farmline'].includes(dbName) && !/farmline/.test(dbName)) {
  bad(`the URI points at database "${dbName}" — farmline must ONLY ever write to its own "farmline" db (AGENTS.md)`);
} else if (dbName) {
  pass(`database name "${dbName}"`);
}
pass(`uri: ${uri.replace(/:\/\/([^:]+):[^@]+@/, '://$1:***@').slice(0, 70)}`);

// ── 5. port ───────────────────────────────────────────────────────────────────
const port = Number(get('PORT') || 4600);
console.log('\nport');
if (port === 4200 || port === 4400 || port === 4411) {
  bad(`port ${port} is taken by another tenant (4200 / 4400 / 4411) — farmline uses 4600`);
} else {
  pass(`port ${port}`);
}
// Not fatal: a live server on the port is normal in dev. But it IS fatal for a
// smoke test, so say who holds it rather than leaving a mystery EADDRINUSE.
const probe = net.createServer();
probe.once('error', (e) => {
  if (e.code === 'EADDRINUSE') soft(`port ${port} is ALREADY IN USE — a server is running (fine for dev, fatal for \`yarn smoke\`)`);
  else soft(`port probe: ${e.code}`);
  probe.close(() => finish());
});
probe.once('listening', () => { pass(`port ${port} is free`); probe.close(() => finish()); });
probe.listen(port);

function finish() {
  console.log(`\n${fatal ? `PREFLIGHT FAILED — ${fatal} fatal, ${warn} warning(s). Do not start.` : `PREFLIGHT OK${warn ? ` — ${warn} warning(s)` : ''}.`}\n`);
  process.exit(fatal ? 1 : 0);
}
