// src/config.js — the ONE place environment is read.
// Mirrors rolodex-server's pattern: no dotenv dependency; check process.env first,
// then the shared .env files the deploy script already maintains.
const fs = require('fs');

// The shared env files, in priority order. On the droplet these are written by
// deploy.sh; in local dev the repo .env wins because it is read second only if
// the first is absent a key.
const ENV_CANDIDATES = [
  process.env.FARMLINE_ENV_FILE || '',
  'D:/TODOs/db-tools-tmp/farmline.env',
  '.env',
].filter(Boolean);

const envCache = new Map();

/** Read one env var: process.env first, then the candidate files. Cached. */
function envVar(name, fallback = '') {
  if (process.env[name] !== undefined && process.env[name] !== '') return process.env[name];
  if (envCache.has(name)) return envCache.get(name);
  let found = '';
  for (const p of ENV_CANDIDATES) {
    try {
      const m = fs.readFileSync(p, 'utf8').match(new RegExp('^' + name + '=[\\"\']?([^\\r\\n"\'#]+)', 'm'));
      if (m) { found = m[1].trim(); break; }
    } catch { /* try next */ }
  }
  if (!found) found = fallback;
  envCache.set(name, found);
  return found;
}

/**
 * Mongo URI resolution.
 * farmline owns its OWN database. The rule from AGENTS.md: never touch `zyppar`
 * or `rolodex`. We take a base URI (local mongod in dev, Atlas on the droplet)
 * and force dbName = 'farmline' at connection time.
 */
function resolveMongoUri() {
  if (process.env.MONGO_DB_URI_FARMLINE) return process.env.MONGO_DB_URI_FARMLINE;
  const explicit = envVar('MONGO_DB_URI_FARMLINE');
  if (explicit) return explicit;

  // Local dev default: the mongod already running on this machine.
  const local = envVar('MONGO_LOCAL_URI', 'mongodb://localhost:27017/farmline');
  // ── THE SECOND `return local;`, KILLED (2026-10-13) ─────────────────────────────
  // The refusal below replaced the LAST silent fallback. This one — guarded by a flag that
  // DEFAULTED TO TRUE — sat above it and shadowed it, so any host where the flag was absent
  // (a fresh box, a re-provisioned droplet, an env file not found from the working directory)
  // silently returned the local mongod and never reached the refusal. Development is
  // unaffected: with no URI it still reaches the final `return local;`, which is right for a
  // laptop. Production can no longer take that path at all.
  if (process.env.NODE_ENV !== 'production' && envVar('FARMLINE_USE_LOCAL_MONGO', 'false') === 'true') return local;

  // Droplet: derive a clean farmline db from the shared paid cluster URI.
  for (const p of ENV_CANDIDATES) {
    try {
      const m = fs.readFileSync(p, 'utf8').match(/^MONGO_DB_URI_PAID=["']?([^\r\n"']+)/m);
      if (m) {
        const base = m[1].replace(/\/[^/?]*\?/, '/?');
        return base.replace('/?', '/farmline?');
      }
    } catch { /* try next */ }
  }
  // THE FALLBACK KILLED (the founder, 2026-10-13: "delete every false
  // invention... no future regression cures"). The old line `return local;`
  // silently absorbed every missing-URI misconfiguration - production ran on
  // the droplet's local mongod for weeks because of it. In production a
  // missing URI is a BOOT REFUSAL, never a smile-and-write-to-disk.
  if (process.env.NODE_ENV === 'production') {
    throw new Error('[config] no database URI resolved - refusing to boot on a silent local fallback. Set MONGO_DB_URI_FARMLINE (or FARMLINE_USE_LOCAL_MONGO=true deliberately for dev).');
  }
  return local;
}

// THE TEST DATABASE (2026-10-13). The default is unchanged - the app still uses
// "farmline" - but the name is now overridable so the TEST SUITES can be sent somewhere
// else. They were writing into the app's own database: of 245 non-demo rows locally, 244
// were artifacts ("Contract Farm N", "Chat Farm N", the demo re-seeds) against ONE real
// farm. A real farmer has to be findable in the database.
const DB_NAME = envVar('FARMLINE_DB_NAME', 'farmline');

const config = {
  port: Number(envVar('PORT', '4600')),          // 4200 and 4400 are taken by other projects
  basePath: envVar('BASE_PATH', '/farmline'),    // mounted at zyppar.com/farmline/
  apiPrefix: '/api/farmline',
  dbName: DB_NAME,
  mongoUri: resolveMongoUri(),
  isProduction: envVar('NODE_ENV', 'development') === 'production',

  // WHICH ENVIRONMENT IS THIS? Dev and production both serve the SAME public path
  // (/farmline/), so without this the app cannot tell a farmer's live farm from a
  // debugging session on a laptop. `ENV_NAME` lets staging announce itself; it
  // defaults to NODE_ENV so nothing has to be configured for dev to be honest.
  envName: envVar('ENV_NAME', envVar('NODE_ENV', 'development')),

  // ── MONEY (rewritten 2026-10-11 — the ZU-only doctrine) ─────────────────────
  // REMOVED: `moneyMode` (the virtual/mpesa rail toggle), `zuPerKes` (a KES peg
  // on ZU) and the whole `mpesa` credential block. All three existed to run a
  // rail that moved money BETWEEN a buyer and a farmer — the one thing the
  // founder ruled out on jurisdictional and reputational grounds.
  //
  // Farmline sells ONE thing — ZU — and ZU unlocks the paid rungs. There is no
  // mode to configure, no peg to maintain, and no outbound credentials to hold.
  // See src/zu.js (the unit and the prices), src/money.js (the ledger), and
  // D:\TODOs\farmline-zu-doctrine-20261011.md (the authority).

  // WHERE THE PUBLIC WORLD CAN REACH US.
  publicUrl: envVar('FARMLINE_PUBLIC_URL', 'https://zyppar.com'),

  // ── THE DEMO VISION SPEND (Task 3, 2026-10-10) — the daily threshold at which
  // the CommandCenter's Farmline Wire alarms. The demo farm's photo door makes
  // REAL billed model calls; the spend is counted (metacounters in the DB),
  // exposed at /health + /meta/vision-spend, and alarmed at this number.
  visionDemoThreshold: Number(envVar('FARMLINE_VISION_DEMO_THRESHOLD', '20')) || 20,

  // B7 (the GLM audit, 2026-10-10): the DAILY CAP PER CLIENT on the vision routes
  // — the first line of defence for the OpenRouter credit (the CommandCenter
  // alarm is the second). A human walking the demo needs a handful; a bot hits
  // the wall. Per EAT day, keyed on the client IP.
  visionIpDailyCap: Number(envVar('FARMLINE_VISION_IP_DAILY_CAP', '10')) || 10,

  // RULING 1 (the founder, 2026-10-12): the vision tier is a STANDALONE SERVICE
  // with a FREE MONTHLY ALLOCATION (default 5 assessments/month per farm) beyond
  // which each assessment costs ZU at the per-use price (default 2). The
  // mid-season insight keeps its OWN product price (zu.VISION_ZU = 5) — never
  // merged into the per-use meter.
  visionFreeMonthly: Number(envVar('FARMLINE_VISION_FREE_MONTHLY', '5')) || 5,
  visionPerUseZU: Number(envVar('FARMLINE_VISION_PER_USE_ZU', '2')) || 2,

  /** Admin gate — same shape as rolodex-server's config.checkAdminKey. */
  checkAdminKey(key) {
    const expected = envVar('FARMLINE_ADMIN_KEY');
    if (!expected) return { ok: false, status: 403, error: 'admin gate is closed (FARMLINE_ADMIN_KEY not set)' };
    if (!key || String(key) !== expected) return { ok: false, status: 401, error: 'bad admin key' };
    return { ok: true };
  },
};

module.exports = config;
module.exports.envVar = envVar;
module.exports.resolveMongoUri = resolveMongoUri;
