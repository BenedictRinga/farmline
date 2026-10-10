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
  if (envVar('FARMLINE_USE_LOCAL_MONGO', 'true') === 'true') return local;

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
  return local;
}

const DB_NAME = 'farmline'; // enforced at connect time — see AGENTS.md

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

  // ── MONEY (AGENTS.md rule 2) ──────────────────────────────────────────────
  // 'virtual' = ZU (Zyppar Units, 1 ZU ≈ $0.01)   'mpesa' = real money
  // Per-farm override lives on the Farm document; this is only the default.
  moneyMode: envVar('MONEY_MODE', 'virtual') === 'mpesa' ? 'mpesa' : 'virtual',
  zuPerKes: Number(envVar('ZU_PER_KES', '0.13')),   // ~1 USD = 130 KES; 1 ZU ≈ $0.01 ⇒ 1 KES ≈ 0.13 ZU
  mpesa: {
    consumerKey: envVar('MPESA_CONSUMER_KEY'),
    consumerSecret: envVar('MPESA_CONSUMER_SECRET'),
    shortcode: envVar('MPESA_SHORTCODE'),
    passkey: envVar('MPESA_PASSKEY'),
    env: envVar('MPESA_ENV', 'sandbox'),
  },

  // WHERE THE PUBLIC WORLD CAN REACH US. Daraja needs an https URL to POST the
  // payment result to, so this must be the real host, not localhost — a callback
  // pointed at localhost silently never arrives and the order stays pending
  // forever with the buyer's money already gone.
  publicUrl: envVar('FARMLINE_PUBLIC_URL', 'https://zyppar.com'),

  // ── THE DEMO VISION SPEND (Task 3, 2026-10-10) — the daily threshold at which
  // the CommandCenter's Farmline Wire alarms. The demo farm's photo door makes
  // REAL billed model calls; the spend is counted (metacounters in the DB),
  // exposed at /health + /meta/vision-spend, and alarmed at this number.
  visionDemoThreshold: Number(envVar('FARMLINE_VISION_DEMO_THRESHOLD', '20')) || 20,

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
