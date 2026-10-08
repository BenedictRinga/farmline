// src/auth.js — real auth, two kinds of principal.
//
// LoopKeeper had ONE anonymous principal (a deviceId HMAC). farmline has TWO,
// because it is a two-sided product:
//
//   FARMER   — the owner of the farm. Phone + PIN. Long-lived token.
//              May read and write farm records. Scoped to ONE farm.
//   CUSTOMER — a buyer. Phone-verified (OTP). Shorter token.
//              May read the farm's PUBLIC projection and create orders.
//              May NEVER reach costs, treatments, animals or other customers.
//
// The token is the same two-segment HMAC-SHA256 JWT core LoopKeeper uses — Node's
// own crypto, no dependency. The claim set carries the ROLE and the SCOPE, so one
// middleware factory gates everything.
//
// THE SHOP ITSELF IS OPEN. A customer must be able to open a farm's link from a
// cold browser with no account — that is the whole distribution mechanism. Only
// ORDERING and everything farmer-side requires a token.
const crypto = require('crypto');
const config = require('./config');

const AUTH_SECRET = config.envVar('AUTH_SECRET') || process.env.AUTH_SECRET || '';
const FARMER_TTL = 30 * 86400;   // 30 days — a farmer should not be logged out weekly
const CUSTOMER_TTL = 7 * 86400;  // 7 days

function b64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
function sign(payload) {
  const head = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64url(JSON.stringify(payload));
  const mac = crypto.createHmac('sha256', AUTH_SECRET).update(head + '.' + body).digest();
  return head + '.' + body + '.' + b64url(mac);
}
function verify(token) {
  try {
    const parts = String(token || '').split('.');
    if (parts.length !== 3) return null;
    const mac = crypto.createHmac('sha256', AUTH_SECRET).update(parts[0] + '.' + parts[1]).digest();
    const got = Buffer.from(parts[2].replace(/-/g, '+').replace(/_/g, '/'), 'base64');
    if (mac.length !== got.length || !crypto.timingSafeEqual(mac, got)) return null;
    const payload = JSON.parse(Buffer.from(parts[1].replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8'));
    if (!payload || !payload.sub || (payload.exp && Date.now() / 1000 > payload.exp)) return null;
    return payload;
  } catch { return null; }
}

/** Farmer token. Scoped to exactly one farm. */
function mintFarmerToken(farmId, memberId, role = 'owner') {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: String(farmId), mid: String(memberId || ''), role, typ: 'farmer', iat: now, exp: now + FARMER_TTL });
}
/** Customer token. Scoped to the customer; orders are still checked against the farm. */
function mintCustomerToken(customerId) {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: String(customerId), role: 'customer', typ: 'customer', iat: now, exp: now + CUSTOMER_TTL });
}

// ── PIN hashing (scrypt, no dependency) ───────────────────────────────────────
function hashPin(pin) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(String(pin), salt, 64).toString('hex');
  return { salt, hash };
}
function checkPin(pin, salt, hash) {
  if (!salt || !hash) return false;
  const got = crypto.scryptSync(String(pin), salt, 64);
  const want = Buffer.from(hash, 'hex');
  return got.length === want.length && crypto.timingSafeEqual(got, want);
}

// ── Middleware ────────────────────────────────────────────────────────────────
function bearer(req) {
  const h = String(req.headers?.authorization || '');
  return h.startsWith('Bearer ') ? h.slice(7).trim() : '';
}

/**
 * Gate a route to one or more token types.
 * Fails OPEN when AUTH_SECRET is unset (same deliberate grace as LoopKeeper: a
 * keyless local dev must not die), and says so once, loudly.
 */
function requireAuth(...types) {
  const wanted = types.length ? types : ['farmer', 'customer'];
  return function (req, res, next) {
    if (!AUTH_SECRET) {
      if (!requireAuth.warned) {
        requireAuth.warned = true;
        console.warn('[auth] AUTH_SECRET not set — the gate is OPEN. Set AUTH_SECRET in .env to arm it.');
      }
      req.auth = { sub: 'dev', role: 'dev', typ: 'dev' };
      return next();
    }
    const payload = verify(bearer(req));
    if (!payload) return res.status(401).json({ error: 'sign in required' });
    if (!wanted.includes(payload.typ)) {
      return res.status(403).json({ error: 'this is the wrong side of the app for that' });
    }
    req.auth = payload;
    return next();
  };
}

/** The farmer's own farm, or nothing. Prevents cross-farm access by URL editing. */
function requireFarmScope(req, res, next) {
  const farmId = String(req.params.farmId || req.body?.farmId || req.query?.farmId || '');
  if (!farmId) return res.status(400).json({ error: 'farmId required' });
  if (req.auth?.typ === 'dev') return next();
  if (req.auth?.typ !== 'farmer' || String(req.auth.sub) !== farmId) {
    return res.status(403).json({ error: 'not your farm' });
  }
  return next();
}

// ── Rate limiting for token minting (in-memory valve, like LoopKeeper's) ──────
const mints = new Map(); // ip -> { n, ts }
function mintRateLimit(req, res, next) {
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '?');
  const now = Date.now();
  // THE AUDIT'S SMALL LEAK (2026-10-08): the valve never pruned — every IP that
  // ever minted stayed in the map for the life of the process. On a public
  // mint endpoint that is unbounded growth. Sweep the stale entries whenever
  // the map grows past a few hundred; a sweep this cheap never matters to a
  // request, and the live window keeps its count.
  if (mints.size > 500) {
    for (const [k, v] of mints) if (now - v.ts > 3600_000) mints.delete(k);
  }
  const rec = mints.get(ip) || { n: 0, ts: now };
  if (now - rec.ts > 3600_000) { rec.n = 0; rec.ts = now; }
  rec.n += 1;
  mints.set(ip, rec);
  if (rec.n > 40) return res.status(429).json({ error: 'too many attempts — try again in an hour' });
  return next();
}

module.exports = {
  AUTH_SECRET,
  authArmed: !!AUTH_SECRET,
  mintFarmerToken, mintCustomerToken, verify,
  hashPin, checkPin,
  requireAuth, requireFarmScope, mintRateLimit,
};
