// src/index.js — farmline server.
//
// A farmer-first farm app with two faces over ONE record system.
//   Face A (farmer)   : today's work, treatments, crops, milk, eggs, simple sales
//   Face B (customer) : the farm's own shop — a PROJECTION of those records
//
// Conventions deliberately mirror rolodex-server (LoopKeeper): plain CommonJS,
// two dependencies, env via config.envVar, HMAC auth in auth.js, one Mongo
// database of our own.
//
// Mounted at https://zyppar.com/farmline/ with the API at /api/farmline/.
// Local dev: port 4600.
const path = require('path');
const express = require('express');

// ── THE PROCESS SAFETY NET (2026-10-09, the founder's question: "Which is
// more resilient, LoopKeeper's server, or Farmline's? Zyppar and LoopKeeper
// do not go down, but Farmline has been from day one, not later than every
// 48 hours"). THE ANSWER FOUND IN THE CODE: zypparserver catches every
// uncaughtException/unhandledRejection and TRIAGES it — transient classes
// (Mongo, ECONNREFUSED, EMFILE/ENOSPC, timeouts) log and CONTINUE; farmline
// had NO net at all, so any unhandled throw in any socket handler, async
// boot step or timer killed the whole process (the mandatoryFloor crash
// loop was exactly this class; the 48-hour cycle is one unguarded path
// somewhere firing every couple of days). THE FARMLINE NET: log everything
// with the full stack, and NEVER exit — the farmline API is stateless
// per-request, so surviving an escaped error is always the right call; the
// watch's health gate remains the last resort for a true wedge. Zyppar's
// scar tissue, farmline's now too. ──
process.on('uncaughtException', (err) => {
  console.error('[FARMLINE-NET] uncaughtException (survived):', err && err.stack ? err.stack : String(err));
});
process.on('unhandledRejection', (reason) => {
  console.error('[FARMLINE-NET] unhandledRejection (survived):', reason && reason.stack ? reason.stack : String(reason));
});

const config = require('./config');
const auth = require('./auth');
const vocab = require('./vocab');
const ladder = require('./ladder');
const money = require('./money');
const zu = require('./zu');
const chat = require('./chat');
const updates = require('./updates');
const schedule = require('./schedule');
const projection = require('./projection');
const reversal = require('./reversal');
const protocols = require('./protocols');
const stages = require('./stages');
const feedback = require('./feedback');
const metacounter = require('./metacounter');
const {
  conn, Farm, Member, Customer, Plot, CropCycle, AnimalGroup, Animal,
  ScheduledEvent, Log, Hold, Sellable, Order, Ledger, PriceObservation, Rating, ZuClaim,
} = require('./models');

const app = express();
app.disable('x-powered-by');
// A3: nginx sits on loopback — trusting it lets req.ip resolve to the real client
// address nginx appended, instead of the raw client-controlled header.
app.set('trust proxy', 'loopback');
app.use(express.json({ limit: '1mb' }));
// B14: the security headers Node can own honestly. The FULL story (HSTS, CSP,
// frame-ancestors on the app shell) belongs to nginx — the requested diff is in
// the thread report; these three are right at the API layer regardless.
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  next();
});

// ── CORS — same rule as LoopKeeper: only when Express is hit DIRECTLY (localhost
// dev). Behind nginx, nginx owns Access-Control-Allow-Origin; setting it here too
// produces two ACAO headers and browsers reject the response.
app.use((req, res, next) => {
  const host = String(req.headers.host || '');
  const direct = /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(host);
  if (direct) res.set('Access-Control-Allow-Origin', '*');
  res.set('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  return next();
});

const api = express.Router();
const ok = (res, body) => res.json({ ok: true, ...body });
const bad = (res, code, error) => res.status(code).json({ ok: false, error });
// C7: THE 5XX COUNTER — wrap() logged errors but nothing counted them. The count
// rides /health (errors5xxToday) so the watch and the CommandCenter wire can
// alarm on error SPIKES, not just vision spend. In-memory and day-keyed: a
// restart resets it, and `bootedAt` says so honestly.
const errStats = { day: new Date().toISOString().slice(0, 10), n: 0, bootedAt: new Date().toISOString() };
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error('[farmline]', req.method, req.originalUrl, e?.message || e);
  const today = new Date().toISOString().slice(0, 10);
  if (errStats.day === today) errStats.n += 1; else { errStats.day = today; errStats.n = 1; }
  if (!res.headersSent) res.status(500).json({ ok: false, error: e?.message || 'failed' });
});
const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

// ══════════════════════════════════════════════════════════════════════════════
// A2: THE DEMO IMMUNITY, BY CONSTRUCTION (the GLM audit, 2026-10-10). ONE
// router-level middleware — every farm-write path is guarded HERE, so a route
// added tomorrow is guarded too; the per-route copies are deleted. The demo farm
// is the sales window, not a sandbox: no non-GET reaches it.
// THE EXEMPTIONS, SAID PLAINLY:
//   · /vision + /vision/stage — the photo door is the VISITOR'S WALK (the demo
//     exists to show the AI working; the spend is counted and capped).
//   · /crops/preview — WRITES NOTHING (it computes the estimate the walk reads).
//   · /orders/:id/stage — the buyer-flow artifact: the demo's order lifecycle is
//     the commercial story the visitor is shown (order → deliver → paid).
// Every other non-GET on the demo farm answers 403 with the honest sentence.
// ══════════════════════════════════════════════════════════════════════════════
api.use('/farm/:farmId', (req, res, next) => {
  // NB: wrap() is a (req,res) shape — it has no next. This middleware is written
  // plainly so `next` survives, with its own catch forwarding to Express.
  (async () => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const p = req.path.replace(/\/+$/, '');
    if (p === '/vision' || p === '/vision/stage' || p === '/crops/preview') return next();
    if (/^\/orders\/[^/]+\/stage$/.test(p)) return next();
    const farm = await Farm.findById(req.params.farmId).select('isDemo').lean();
    if (farm?.isDemo) return bad(res, 403, 'In the demo this stays read-only — on your farm, this writes.');
    return next();
  })().catch(next);
});

// ── chat shapes ───────────────────────────────────────────────────────────────
// Sent to the app rather than raw Mongo documents: `_id` as a string (the Angular
// client treats it as an opaque id), and only the fields a thread needs. Never the
// raw customer document — a buyer does not get to see another buyer's phone number.
const shapeConversation = (c) => ({
  _id: String(c._id),
  farmId: String(c.farmId),
  orderId: c.orderId ? String(c.orderId) : null,
  farmLabel: c.farmLabel || '',
  customerLabel: c.customerLabel || '',
  lastMessageAt: c.lastMessageAt,
  lastMessageText: c.lastMessageText || '',
  closed: !!c.closed,
});
const shapeMessage = (m) => ({
  _id: String(m._id),
  conversationId: String(m.conversationId),
  fromType: m.fromType,
  fromLabel: m.fromLabel || '',
  body: m.body,
  photo: m.photo || '',
  at: m.at,
  // ABSENT, not '' — see the note on logSchema.clientId in models.js.
  clientId: m.clientId || undefined,
});

// ══════════════════════════════════════════════════════════════════════════════
// HEALTH / VERSION
// ──────────────────────────────────────────────────────────────────────────────
app.get(['/health', config.basePath + '/health'], async (_req, res) => res.json(await healthPayloadAsync()));
// ── THE DYNAMIC SITEMAP (2026-10-09, the founder's aggressive visibility:
// "optimize for visibility, and potentially qualify for PlayStore… find
// every trick to push farmline onto the timelines of AI and search bots") —
// every farm's shop front is a crawlable page. The sitemap lists the app and
// every farm with a slug. Public, no auth, XML.
app.get('/api/farmline/sitemap.xml', async (req, res) => {
  try {
    const farms = await Farm.find({}, { slug: 1, name: 1, updatedAt: 1 }).sort({ updatedAt: -1 }).limit(500).lean();
    const base = 'https://zyppar.com';
    const today = new Date().toISOString().slice(0, 10);
    const urls = [
      '  <url><loc>' + base + '/farmline/</loc><changefreq>weekly</changefreq><priority>0.9</priority></url>',
      '  <url><loc>' + base + '/farmline/guide</loc><changefreq>monthly</changefreq><priority>0.5</priority></url>',
    ];
    for (const f of farms) {
      if (!f.slug) continue;
      const lastmod = f.updatedAt ? new Date(f.updatedAt).toISOString().slice(0, 10) : today;
      // C3: PATH-BASED URLs — the router is path-based (s/:slug), so every hash
      // URL landed on the splash; the crawlable shape is /farmline/s/<slug>.
      urls.push('  <url><loc>' + base + '/farmline/s/' + f.slug + '</loc><lastmod>' + lastmod + '</lastmod><changefreq>daily</changefreq><priority>0.7</priority></url>');
    }
    const xml = '<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n' + urls.join('\n') + '\n</urlset>';
    res.set('Content-Type', 'application/xml');
    res.set('Cache-Control', 'public, max-age=600');
    return res.status(200).send(xml);
  } catch (e) {
    return res.status(500).send('sitemap failed');
  }
});
app.get('/api/farmline/version', async (_req, res) => {
  // B1: /version reads THE SERVED-BUNDLE CLOCK — the same source of truth the
  // frozen updates.js uses (env override → /var/www/farmline/build.json → the
  // sibling checkout → package.json). The app's guard feeds this number into a
  // guard whose purpose is to heal a tab holding an old BUNDLE, so the SERVER's
  // own build was the wrong clock: the app's build is always ahead of it and the
  // guard never fired on an app deploy — exactly the event that changes chunk
  // hashes. updates.js stays frozen; this resolution shape is lifted from it.
  const path = require('path');
  const candidates = [];
  if (process.env.FARMLINE_SERVED_BUNDLE) candidates.push(path.join(process.env.FARMLINE_SERVED_BUNDLE, 'build.json'));
  candidates.push('/var/www/farmline/build.json');
  candidates.push(path.resolve(process.cwd(), '..', 'farmline-app', 'www', 'build.json'));
  let b = 0;
  for (const p of candidates) {
    try {
      const stamp = JSON.parse(require('fs').readFileSync(p, 'utf8'));
      const n = Number(stamp.build);
      if (Number.isFinite(n) && n > 0) { b = n; break; }
    } catch { /* the next candidate */ }
  }
  if (!b) b = Number(require('../package.json').build) || 0;   // the dev-machine last resort
  res.json({
    version: '0.1.' + b,
    build: b,
    latestVersion: '0.1.' + b,
    // The app reads this to say which environment it is running against. Dev and
    // production share the same public path, so this is the only honest signal.
    env: config.envName,
    isProduction: config.isProduction,
    dbName: config.dbName,
    at: new Date().toISOString(),
  });
});

// THE UPDATES CHECK — CLONED from LoopKeeper's zyppar-style update controller
// (routes/updates.routes.js + controllers/updates.controller.js): same no-store
// headers (a cached check answer is a lie), same query shape, farmline's build
// counter as the truth. PUBLIC — the check must work before any sign-in.
app.get('/api/farmline/updates/check', async (req, res) => {
  res.set(updates.UPDATE_CHECK_HEADERS);
  res.json(await updates.getUpdateStatus(req.query.clientVersion));
});

// ── B2 — THE ANNOUNCE DOOR (the socket is the accelerator) ───────────────────
// When the founder raises FARMLINE_MANDATORY_BUILD in the .env, OPEN apps learn
// it on their next 5-minute poll — or IMMEDIATELY through this door: one curl
// with the announce secret pushes `update:mandatory` to every connected socket.
// The route is disabled until FARMLINE_ANNOUNCE_SECRET exists in the .env; a
// secret-less server simply has no door (and no route to attack).
app.post('/api/farmline/updates/announce', (req, res) => {
  const secret = process.env.FARMLINE_ANNOUNCE_SECRET;
  if (!secret) return res.status(404).json({ ok: false, error: 'announce is not armed' });
  if (req.get('x-announce-secret') !== secret) return res.status(401).json({ ok: false, error: 'not the announcer' });
  const announced = chat.broadcastUpdate();
  if (!announced) return res.json({ ok: true, announced: 0, note: 'no mandatory floor set' });
  return res.json({ ok: true, announced });
});

// THE HEALTH ENDPOINT UNDER OUR OWN PREFIX.
// `/health` at the ROOT belongs to whoever serves zyppar.com — not to us. A tenant
// must never claim a root-level path: it is ambiguous today and a collision
// tomorrow (the Zyppar backend may want /health itself). farmline therefore
// exposes its health at /api/farmline/health, which the nginx API block already
// proxies and which can never be confused with a neighbour's route.
// `/health` is still served for DIRECT localhost use (deploy.sh checks it before
// nginx is in the picture) — but verify-live.cjs checks THIS one.
const healthPayload = () => ({
  ok: true,
  db: conn.readyState === 1 ? 'connected' : 'connecting',
  dbName: config.dbName,
  // A4: authArmed is NO LONGER published here — /health is public, and a server
  // with no secret must not advertise its own disarmament to the internet. The
  // armed state lives in the boot log and in /admin/farms (gated).
  //
  // THE MONEY FIELDS ARE GONE WITH THE RAIL (2026-10-11): `moneyMode` and
  // `mpesaConfigured` described a rail between a buyer and a farmer. There is no
  // such rail. What is left that a monitor actually wants is whether the ZU door
  // is OPEN — i.e. whether the operator has published collection details, since
  // without them nobody can credit an account.
  zuOpen: zu.collectionOpen(),
  basePath: config.basePath,
  build: Number(require('../package.json').build) || 0,
  at: new Date().toISOString(),
});
// THE DEMO VISION SPEND rides the health answer (Task 3): the existing monitor
// (the watch, the zyppar Farmline Wire prober) reads it for free. The counter
// NEVER blocks the watch — a DB hiccup answers without the field.
const healthPayloadAsync = async () => {
  const base = healthPayload();
  try { base.visionCallsToday = await metacounter.count('vision-demo'); } catch { /* absent, not wrong */ }
  // C7: the day's 5xx count — the watch alarms on error SPIKES, not just spend.
  base.errors5xxToday = errStats.day === new Date().toISOString().slice(0, 10) ? errStats.n : 0;
  base.bootedAt = errStats.bootedAt;
  return base;
};
api.get('/health', async (_req, res) => res.json(await healthPayloadAsync()));

// ══════════════════════════════════════════════════════════════════════════════
// AUTH — two principals
// ──────────────────────────────────────────────────────────────────────────────
api.post('/auth/farmer/register', auth.mintRateLimit, wrap(async (req, res) => {
  fl_recordVisit(req, 'register');
  const { phone, pin, name = '', farmName = '', area = '' } = req.body || {};
  if (!phone || !pin) return bad(res, 400, 'phone and pin are required');
  if (String(pin).length < 4) return bad(res, 400, 'pin must be at least 4 digits');
  if (await Member.findOne({ phone: String(phone) })) return bad(res, 409, 'that number is already registered — sign in instead');

  const farm = await Farm.create({
    name: farmName || `${name || 'My'} Farm`,
    slug: slugify(farmName || name || 'farm') + '-' + Math.random().toString(36).slice(2, 6),
    area,
    // No money-mode is set at birth any more (2026-10-11): the virtual/mpesa
    // toggle belonged to the deleted rail. A new farm starts on the free rungs
    // with a zero ZU balance, which is the honest starting state.
  });
  const { salt, hash } = auth.hashPin(pin);
  const member = await Member.create({ farmId: farm._id, phone: String(phone), name, role: 'owner', pinSalt: salt, pinHash: hash });

  return ok(res, {
    token: auth.mintFarmerToken(farm._id, member._id, 'owner'),
    farm: { id: farm._id, name: farm.name, slug: farm.slug, rung: farm.rung },
    member: { id: member._id, name: member.name, role: member.role },
    start: ladder.landing('farm'),
  });
}));

api.post('/auth/farmer/login', auth.mintRateLimit, wrap(async (req, res) => {
  fl_recordVisit(req, 'login');
  const { phone, pin } = req.body || {};
  const member = await Member.findOne({ phone: String(phone || ''), active: true });
  if (!member || !auth.checkPin(pin, member.pinSalt, member.pinHash)) return bad(res, 401, 'wrong number or PIN');
  const farm = await Farm.findById(member.farmId);
  return ok(res, {
    token: auth.mintFarmerToken(farm._id, member._id, member.role),
    farm: { id: farm._id, name: farm.name, slug: farm.slug, rung: farm.rung },
    member: { id: member._id, name: member.name, role: member.role },
  });
}));

// ── THE DEMO DOOR (the founder, 2026-10-08: "people need to SEE") ──────────
// Issues a REAL farmer token for the ONE demo farm (Farm.isDemo). No secret
// on the wire — the farm holds only fictional, re-seedable data; the real
// accounts are untouched (a demo token scopes to that farm, exactly like a
// login token). Rate-limited like every mint.

// ── THE VISIT LEDGER (2026-10-09, the founder's monitor: "how many people
//    with whom I have shared it clicked on it") — the auth endpoints record
//    their own visits: kind 'demo' (the Kimani entry — the click-through
//    signal), 'register' (the conversion), 'login' (the return). The static
//    shell is served by nginx and never reaches this process; the zyppar's
//    monitor parses that log separately and reads this collection.
function fl_recordVisit(req, kind) {
  try {
    const c = conn.db.collection('visits');
    c.insertOne({
      at: new Date(), kind,
      ip: String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim().slice(0, 64),
      ua: String(req.headers['user-agent'] || '').slice(0, 180),
      ref: String(req.headers.referer || '').slice(0, 240),
    }).catch(() => { /* the ledger never blocks an auth flow */ });
  } catch { /* never blocks */ }
}

// ── THE SHELL BEACON — the CommandCenter wire's OTHER half ─────────────────────
// WHY THIS EXISTS (2026-10-11). The wire reported "shell loads" by reading
// /var/log/nginx from the ZYPPAR server — a process that is neither www-data nor adm,
// while nginx writes those logs 0640. readdirSync threw, a bare catch swallowed it,
// and that half of the panel read a confident ZERO forever. The founder: "the panel
// and inputs are all illusory, impossibly gathering zero data so far."
//
// So the file-permission dependency is REPLACED by a signal the app reports about
// itself, into the SAME `visits` collection the wire already reads successfully (191
// rows locally, verified). One row per app boot. No farm document is touched, so the
// demo's immutability is untouched by construction.
//
// It is PUBLIC and unauthenticated on purpose — a visitor's first screen must be able
// to say "someone arrived" before anyone has a token — so it carries its own valve.
const shellBeacons = new Map();
function shellBeaconRateLimit(req, res, next) {
  const ip = auth.clientIp(req);
  const now = Date.now();
  if (shellBeacons.size > 2000) {
    for (const [k, v] of shellBeacons) if (now - v.ts > 3600_000) shellBeacons.delete(k);
  }
  const rec = shellBeacons.get(ip) || { n: 0, ts: now };
  if (now - rec.ts > 3600_000) { rec.n = 0; rec.ts = now; }
  rec.n += 1;
  shellBeacons.set(ip, rec);
  if (rec.n > 120) return res.status(429).json({ ok: false, error: 'too many beacons from this device' });
  return next();
}

api.post('/visit', shellBeaconRateLimit, wrap(async (req, res) => {
  // ONE KIND, hard-coded on purpose: this door answers one question — did a shell
  // load? — and a caller-supplied `kind` would let anyone write rows that look like
  // registers or customer logins in the founder's own analytics.
  fl_recordVisit(req, 'shell');
  return ok(res, { noted: true });
}));

api.post('/auth/demo', auth.mintRateLimit, wrap(async (req, res) => {
  fl_recordVisit(req, 'demo');
  const farm = await Farm.findOne({ isDemo: true });
  if (!farm) return bad(res, 404, 'the demo farm is not seeded yet');
  const member = await Member.findOne({ farmId: farm._id, role: 'owner', active: true });
  if (!member) return bad(res, 404, 'the demo farm is not seeded yet');
  return ok(res, {
    token: auth.mintFarmerToken(farm._id, member._id, member.role),
    farm: { id: farm._id, name: farm.name, slug: farm.slug, rung: farm.rung },
    member: { id: member._id, name: member.name, role: member.role },
    demo: true,
  });
}));

api.post('/auth/customer', auth.mintRateLimit, wrap(async (req, res) => {
  fl_recordVisit(req, 'customer');
  const { phone, name = '', slug = '' } = req.body || {};
  if (!phone) return bad(res, 400, 'phone is required');
  let customer = await Customer.findOne({ phone: String(phone) });
  let granted = 0;
  if (!customer) {
    customer = await Customer.create({ phone: String(phone), name });
    // NO STARTING ZU IS MINTED ANY MORE (the doctrine, 2026-10-11). The old grant
    // handed 500 ZU to every new buyer so a demo could be walked — Farmline
    // issuing credit into a rail that carried money between a buyer and a farmer.
    // ZU is now Farmline's own unit, bought by the FARMER to open his paid rungs,
    // and the storefront is not a paying surface at all: this endpoint's job is a
    // customer token and nothing else. `zu` remains in the answer so the app's
    // existing shape does not break, and it is honestly zero.
  }
  return ok(res, {
    token: auth.mintCustomerToken(customer._id),
    customer: { id: customer._id, name: customer.name },
    zu: { balance: 0, granted: 0 },
  });
}));

api.get('/me', auth.requireAuth('farmer'), wrap(async (req, res) => {
  // DEAD SESSION vs DATA ANOMALY — the distinction the founder's report forced
  // (2026-10-04: "We could not load your farm — farm not found", TRY AGAIN dead).
  //
  // The token's `sub` IS the farm id and `mid` IS the member credential. When a
  // database is reset (or a farm is removed) the token still verifies — HMAC does
  // not know the identity vanished — and every call then answers 404, which the
  // app read as a retryable load error. The farmer sat on a dead screen with a
  // TRY AGAIN button that re-fired the same dead call forever.
  //
  // THE HONEST ANSWER for a credential that no longer resolves is 401, not 404:
  // the ONLY recovery is signing in again, and 401 is the one status the app
  // already treats exactly that way (clear the token, walk to the door, say why).
  // 404 stays for the genuine anomaly — a live member whose farm doc is missing.
  const member = req.auth.mid ? await Member.findById(req.auth.mid).lean() : null;
  if (!member) {
    return res.status(401).json({ ok: false, error: 'this session no longer exists — sign in again' });
  }
  const farm = await Farm.findById(req.auth.sub).lean();
  if (!farm) return bad(res, 404, 'farm not found');
  // THE RUNG THE APP RENDERS IS THE EFFECTIVE ONE, resolved at read time. A lapsed
  // paid period or an expired provisional rung must not keep showing as held — that
  // is what makes "farmline decides readiness" true at the surface as well as in the
  // database. The stored value rides along as `storedRung` so nothing is lost, and
  // `rungProvisional` is what lets the farmer's own UI label a demonstration honestly.
  const eff = ladder.effectiveRung(await farmWithActivity(farm));
  // The contract is explicit even for farms minted before a field existed
  // (mongo does not backfill): the vision tier is 'none' unless set.
  return ok(res, {
    farm: {
      ...farm,
      rung: eff.rung,
      storedRung: eff.stored,
      rungPaid: eff.paid,
      rungProvisional: eff.provisional,
      rungExpired: eff.expired,
      rungPaused: eff.paused,
      visionTier: farm.visionTier || 'none',
    },
    member,
    authArmed: auth.authArmed,
  });
}));

// ── THE FARM'S PROFILE (the founder, 2026-10-07: "we have no editing of farm
// profile. I missed setting farm name, and I am since stuck with 'Farmline'
// as the default name." Settings carries a Profile section of its own; this
// route is its hand. Only these four fields — the farmer's own words and her
// own photograph; nothing here can touch the money or the ladder.
api.patch('/farm/:farmId/profile', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const b = req.body || {};
  const set = {};
  if (b.name !== undefined) {
    const name = String(b.name).trim();
    if (!name) return bad(res, 400, 'the farm name cannot be empty');
    if (name.length > 80) return bad(res, 400, 'the farm name is too long');
    set.name = name;
  }
  if (b.area !== undefined) {
    const area = String(b.area).trim();
    if (area.length > 80) return bad(res, 400, 'the location is too long');
    set.area = area;
  }
  if (b.story !== undefined) {
    const story = String(b.story).trim();
    if (story.length > 2000) return bad(res, 400, 'the story is too long');
    set.story = story;
  }
  if (b.photo !== undefined) {
    const photo = String(b.photo || '');
    // THE FARM'S FACE travels as a client-downsized JPEG data URL (the
    // established farm-page pattern). A string that is not a small image
    // data URL is a malformed body, not a photo — refuse it plainly.
    if (photo && (!photo.startsWith('data:image/') || photo.length > 400000)) {
      return bad(res, 400, 'the photo is too large — pick a smaller one');
    }
    set.photo = photo;
  }
  if (b.payTo !== undefined) {
    // THE FARMER'S OWN PAYMENT WORDS (the ZU doctrine, 2026-10-11): how HIS buyers
    // should pay HIM — paybill/till/bank/Airtel/"cash at pickup". Free text, and
    // deliberately so: Farmline shows it and never parses it. There is no rail
    // here and no validation of account numbers, because we are not a party to
    // the payment and must never look like one.
    const payTo = String(b.payTo || '').trim();
    if (payTo.length > 600) return bad(res, 400, 'that is too long — keep it to the lines a buyer needs');
    set.payTo = payTo;
  }
  if (!Object.keys(set).length) return bad(res, 400, 'nothing to update');
  const farm = await Farm.findByIdAndUpdate(req.auth.sub, { $set: set }, { new: true }).lean();
  if (!farm) return bad(res, 404, 'farm not found');
  return ok(res, { farm });
}));

// ── AI VISION — THE COMPUTE (the founder’s expansion directive, 2026-10-07:
// “AI to ‘see’ the farm through the device camera — compute, count, label,
// identify, measure — under advanced subscription packages”). The
// ENTITLEMENT lives on the farm (visionTier === 'advanced', server-side only
// — nothing on the wire can flip it). The COMPUTE rides the OpenRouter chat
// API with a vision model — plain fetch, no new dependency (the cap is three).
// Not armed (no OPENROUTER_API_KEY) means an honest 503, never a silent
// failure. The photo travels as the same client-downsized data URL the
// profile photo uses; a bigger allowance than the profile (a herd shot
// carries detail), still bounded.
// B13: the photo routes carry the only big bodies (data-URL photos) — the 4mb
// limit rides THESE routes; everything else answers under the 1mb default.
// B7: the daily per-client cap — the first line of defence for the OpenRouter
// credit (the CommandCenter alarm is the second); the cap counts SUCCESSFUL
// model answers per client IP per EAT day.
const visionBody = express.json({ limit: '4mb' });
const visionIpKey = (req) => 'vision-ip-' + require('crypto').createHash('sha256').update(auth.clientIp(req)).digest('hex').slice(0, 16);

api.post('/farm/:farmId/vision', visionBody, auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const cap = config.visionIpDailyCap;
  const ipKey = visionIpKey(req);
  if (await metacounter.count(ipKey) >= cap) {
    return bad(res, 429, `the photo door has a daily limit of ${cap} per device — try again tomorrow`);
  }
  const farm = await Farm.findById(req.auth.sub).lean();
  if (!farm) return bad(res, 404, 'farm not found');
  if (farm.visionTier !== 'advanced') {
    // THE PAID-TIER TRUTH (Task 2, the founder: "attach photo assessment to a paid
    // tier, so that user is notified on choosing it — this is paid tier, and any
    // other benefits riding on that tier"): the refusal NAMES the tier and the
    // other benefits riding it, so even an API-level arrival learns the wall.
    return bad(res, 403, 'AI Vision is part of the Advanced package — the commercial rungs, with the AI diagnosis, the market intelligence and the priority support (see the ladder)');
  }
  // THE PRICE OF THE INSIGHT — checked BEFORE the model call, so we never do work we
  // cannot bill for, and a short farm is told exactly what to do about it. (Free-text
  // door, same price as the photo door: one model call, one value.)
  const afford = await visionAffordable(req, res, farm);
  if (!afford.ok) {
    return res.status(402).json({
      ok: false,
      error: `this insight costs ${zu.VISION_ZU} ZU and the farm holds ${afford.have} — collect today's free ZU, or top up with a pack`,
      needed: afford.needed, have: afford.have, short: afford.short, suggestedPack: afford.suggestedPack,
    });
  }
  const b = req.body || {};
  // THE PHOTO FIRST: a body the farmer can fix is judged before the key she
  // cannot — a junk photo gets its 400 even on a not-yet-armed server.
  const photo = String(b.photo || '');
  if (!photo.startsWith('data:image/')) return bad(res, 400, 'send a photo of the farm');
  if (photo.length > 1200000) return bad(res, 400, 'the photo is too large — pick a smaller one');
  const question = String(b.question || '').trim().slice(0, 500);

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return bad(res, 503, 'AI Vision is not armed on this server');
  const model = process.env.FARMLINE_VISION_MODEL || 'z-ai/glm-4.5v';
  const system = [
    "You are farmline's farm-vision assistant for smallholder farms in Kenya and East Africa.",
    'Look at the photo and answer with what a good extension officer would say: COUNT animals or produce if visible; IDENTIFY breeds, plants, pests or diseases; LABEL what you see; ESTIMATE measures where possible.',
    'Be concrete and brief (at most 120 words). If the photo is unclear, say exactly what is unclear.',
  ].join(' ');
  const userText = question ? 'The farmer asks: ' + question : 'Look at this photo from my farm. Count, identify, label and estimate what you see.';

  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        model,
        max_tokens: 400,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: [
            { type: 'text', text: userText },
            { type: 'image_url', image_url: { url: photo } },
          ] },
        ],
      }),
    });
    const j = await r.json().catch(() => null);
    const insight = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (!r.ok || !insight) {
      console.warn('[farmline] vision:', r.status, JSON.stringify(j).slice(0, 200));
      return bad(res, 502, 'the vision service did not answer — try again');
    }
    // THE DEMO VISION SPEND (Task 3): a demo-farm call that the model ANSWERED is
    // real money — counted in the DB so restarts preserve it, exposed at /health
    // and /meta/vision-spend, alarmed by the CommandCenter's Farmline Wire.
    if (farm.isDemo) { try { await metacounter.bump('vision-demo'); } catch { /* the counter never blocks the answer */ } }
    // B7: the caller's own daily cap counts the same successful answer.
    try { await metacounter.bump(ipKey); } catch { /* never blocks */ }
    // THE INSIGHT IS PAID (the founder, 2026-10-11: "I do want it paid for"). Charged
    // HERE, after the model has answered — a 502 above bills nothing. The free-text
    // door carries the same price as the photo door: one model call, one value.
    const charged = await chargeVision(req, farm);
    return ok(res, {
      insight,
      charged: charged.charged,
      demo: !!charged.demo,
      balance: charged.balance,
      bought: 'insight',
    });
  } catch (e) {
    console.warn('[farmline] vision error:', e.message);
    return bad(res, 502, 'the vision service did not answer — try again');
  }
}));

// ── THE VISION STAGE PROPOSAL (Door 2 of the mid-season door, 2026-10-09) ─────
/**
 * THE VISION CHARGE — the mid-season door, the founder's ruling: "both".
 * He pays for the INSIGHT (a real model call, real value) and he gets a PROVISIONAL
 * rung to feel the paid layer. Two rules it must obey:
 *   · the DEMO is NEVER charged — a visitor's walk has no balance and never should;
 *   · refusal happens BEFORE the model call, and the charge lands only when the model
 *     has actually ANSWERED. A 502 bills nothing (the standing rule: gate on success).
 */
async function visionAffordable(req, res, farm) {
  if (farm?.isDemo) return { ok: true, demo: true, have: 0 };
  const have = await money.balance({ farmId: req.params.farmId });
  if (have < zu.VISION_ZU) {
    const short = zu.VISION_ZU - have;
    return { ok: false, have, needed: zu.VISION_ZU, short, suggestedPack: zu.packFor(short) };
  }
  return { ok: true, have };
}

/** Charge AFTER the model answered. Idempotent within one request — never twice. */
async function chargeVision(req, farm) {
  if (req._zuVision) return req._zuVision;
  if (farm?.isDemo) { req._zuVision = { charged: 0, demo: true }; return req._zuVision; }
  const r = await money.spend({
    farmId: req.params.farmId, amountZU: zu.VISION_ZU, ref: 'vision', note: 'AI vision call',
  });
  req._zuVision = r.ok ? { charged: zu.VISION_ZU, balance: r.balance } : { charged: 0, uncharged: true };
  return req._zuVision;
}

/**
 * THE PROVISIONAL RUNG — the second half of the mid-season door.
 * ███  DORMANT — THIS IS NOT CALLED  ███  (2026-10-11, by the founder's own ruling)
 *
 * This was written to grant a 14-day provisional rung at the mid-season door. The
 * founder then resolved his conflict: "I do want it paid for, but at the same time
 * not activate a paid rung for which the farmer has not merited by data input, only
 * payment fact." That sentence retires this function: the mid-season farmer has
 * PAID, and an AI estimate is not data he entered. Granting VERDICT here would open
 * a badge on payment fact — the same lie C6 removed from the trust fields.
 *
 * It is kept, UNCALLED, as a documented switch in case he ever decides the carrot is
 * worth it. `ladder.effectiveRung` already understands `rungProvisionalUntil` and
 * reports it as provisional forever, and the smoke suite proves that behaviour, so
 * switching it on is a ONE-LINE change. Do not call it without his word.
 */
async function grantProvisional(farmId) {
  const farm = await Farm.findById(farmId);
  if (!farm) return null;
  const paidLive = farm.rungPaidUntil && new Date(farm.rungPaidUntil).getTime() > Date.now();
  if (paidLive) return null;                       // never demote or duplicate a paid farm
  farm.rung = Math.max(Number(farm.rung) || 0, ladder.FREE_CEILING + 1);
  farm.rungProvisionalUntil = new Date(Date.now() + zu.PROVISIONAL_DAYS * 86400000);
  await farm.save();
  return { rung: farm.rung, until: farm.rungProvisionalUntil, days: zu.PROVISIONAL_DAYS };
}

// The farmer photographs the crop; the model proposes crop + growth stage; ONE
// confirm tap in the app turns that into Door 1's back-calculation. The AI
// proposes; the farmer confirms; nothing writes without the tap (the
// capture-honesty law) — this route only READS the photo and returns a proposal.
// Same entitlement gate as the free-text vision route; the demo farm carries
// visionTier 'advanced' so a visitor can walk this door too.
api.post('/farm/:farmId/vision/stage', visionBody, auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const cap = config.visionIpDailyCap;
  const ipKey = visionIpKey(req);
  if (await metacounter.count(ipKey) >= cap) {
    return bad(res, 429, `the photo door has a daily limit of ${cap} per device — try again tomorrow`);
  }
  const farm = await Farm.findById(req.params.farmId).lean();
  if (!farm) return bad(res, 404, 'farm not found');
  if (farm.visionTier !== 'advanced') {
    // THE PAID-TIER TRUTH (Task 2) — the same sentence the free-text vision route
    // carries: the refusal names the tier and the benefits riding it.
    return bad(res, 403, 'AI Vision is part of the Advanced package — the commercial rungs, with the AI diagnosis, the market intelligence and the priority support (see the ladder)');
  }
  // THE PRICE OF THE INSIGHT — checked BEFORE the model call so we never do work we
  // cannot bill for, and so a short farm is told exactly what to do about it.
  const afford = await visionAffordable(req, res, farm);
  if (!afford.ok) {
    return res.status(402).json({
      ok: false,
      error: `this insight costs ${zu.VISION_ZU} ZU and the farm holds ${afford.have} — collect today's free ZU, or top up with a pack`,
      needed: afford.needed, have: afford.have, short: afford.short, suggestedPack: afford.suggestedPack,
    });
  }
  const photo = String(req.body?.photo || '');
  if (!photo.startsWith('data:image/')) return bad(res, 400, 'send a photo of the crop');
  if (photo.length > 1200000) return bad(res, 400, 'the photo is too large — pick a smaller one');

  const key = process.env.OPENROUTER_API_KEY;
  if (!key) return bad(res, 503, 'AI Vision is not armed on this server');
  const model = process.env.FARMLINE_VISION_MODEL || 'z-ai/glm-4.5v';
  const system = [
    'You identify field crops and their growth stage for smallholder farms in Kenya and East Africa.',
    'Answer ONLY with compact JSON, no prose around it:',
    '{"crop":"<the crop name, common English, lowercase>","weeksFromPlanting":<integer weeks since planting or sowing, 0-120>,"note":"<one short phrase describing the crops current look, e.g. about knee-high>","confidence":"high"|"medium"|"low"}',
    'If the photo shows no crop, answer {"crop":"","weeksFromPlanting":-1,"note":"no crop visible","confidence":"low"}.',
    'Judge the stage from what you see: height, leaf count, flowering, fruiting, drying.',
  ].join(' ');

  try {
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      signal: AbortSignal.timeout(60000),
      body: JSON.stringify({
        model,
        max_tokens: 300,
        temperature: 0.1,
        messages: [
          { role: 'system', content: system },
          { role: 'user', content: [
            { type: 'text', text: 'Which crop is this and how long ago was it planted?' },
            { type: 'image_url', image_url: { url: photo } },
          ] },
        ],
      }),
    });
    const j = await r.json().catch(() => null);
    const text = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;
    if (!r.ok || !text) {
      console.warn('[farmline] vision/stage:', r.status, JSON.stringify(j).slice(0, 200));
      return bad(res, 502, 'the vision service did not answer — try again');
    }
    // THE DEFENSIVE PARSE: the model answers JSON; a wrapped or chatty answer is
    // salvaged by taking the first {...} block. Anything else is an honest 502.
    const m = String(text).match(/\{[\s\S]*\}/);
    let p = null;
    try { p = m ? JSON.parse(m[0]) : null; } catch { p = null; }
    if (!p || typeof p !== 'object') {
      return bad(res, 502, 'the vision answer could not be read — try again, or pick the stage yourself');
    }
    // THE DEMO VISION SPEND (Task 3): the model answered a demo-farm call — counted
    // (the same DB counter /health and /meta/vision-spend expose).
    if (farm.isDemo) { try { await metacounter.bump('vision-demo'); } catch { /* never blocks */ } }
    // B7: the caller's own daily cap counts the same successful answer.
    try { await metacounter.bump(ipKey); } catch { /* never blocks */ }
    const cropRaw = String(p.crop || '').trim().toLowerCase();
    const weeks = Number(p.weeksFromPlanting);
    const note = String(p.note || '').trim().slice(0, 120);
    const confidence = ['high', 'medium', 'low'].includes(String(p.confidence)) ? String(p.confidence) : 'medium';
    if (!cropRaw || !Number.isFinite(weeks) || weeks < 0) {
      // The model ANSWERED but told us nothing usable. An answered call is still a
      // real call we paid for, so it is charged — but no rung is granted for it.
      const c1 = await chargeVision(req, farm);
      return ok(res, { proposal: { crop: '', cropKey: '', note, confidence, band: null, weeksFromPlanting: null }, charged: c1.charged, demo: !!c1.demo });
    }
    // The model's name must land on a species farmline serves — direct key match
    // first, then the label-guesser (corn→maize, maize|mahindi→maize…). No match
    // is an honest empty crop; the app falls back to the picker list.
    const known = protocols.speciesList().includes(cropRaw) ? cropRaw : schedule.guessSpecies(cropRaw);
    const cropKey = known && protocols.speciesList().includes(known) ? known : '';
    if (!cropKey) {
      const c2 = await chargeVision(req, farm);
      return ok(res, { proposal: { crop: cropRaw, cropKey: '', note, confidence, band: null, weeksFromPlanting: Math.max(0, Math.round(weeks)) }, charged: c2.charged, demo: !!c2.demo });
    }
    const band = stages.resolveStage(cropKey, Math.round(weeks) * 7);
    // THE MID-SEASON DOOR — THE INSIGHT IS PAID, THE RUNG IS NOT GRANTED.
    //
    // The founder's ruling of 2026-10-11, resolving his own conflict: "I do want it
    // paid for, but at the same time not activate a paid rung for which the farmer
    // has not merited by data input, only payment fact."
    //
    // So the two are DECOUPLED, and that is the whole resolution:
    //   · he PAYS for the insight (VISION_ZU) — real value, a real model call, and
    //     this is revenue that needs no rung to justify it;
    //   · the rung is NOT touched. Not by the payment, not by the estimate.
    //
    // The earlier provisional-rung grant is REMOVED (grantProvisional is now dormant
    // and uncalled, kept only as a documented switch in case he ever wants the
    // carrot). It failed his own test: it would have opened VERDICT on an AI estimate
    // that he had merely paid for, and a badge bought that way means nothing to a
    // buyer — which is the same lie C6 removed from the trust fields.
    const charged = await chargeVision(req, farm);
    return ok(res, {
      proposal: {
        crop: cropRaw, cropKey, note, confidence, band,
        weeksFromPlanting: Math.max(0, Math.round(weeks)),
      },
      charged: charged.charged,
      demo: !!charged.demo,
      balance: charged.balance,
      // Stated to the client so the app can be honest on the spot: this bought an
      // ANSWER, not a rung. The rung still has to be earned from real records.
      bought: 'insight',
    });
  } catch (e) {
    console.warn('[farmline] vision/stage error:', e.message);
    return bad(res, 502, 'the vision service did not answer — try again');
  }
}));

// ══════════════════════════════════════════════════════════════════════════════
// FARMER — setup
// ──────────────────────────────────────────────────────────────────────────────
api.post('/farm/:farmId/plots', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const { name, acres = 0, soil = '', water = '' } = req.body || {};
  if (!name) return bad(res, 400, 'plot name required');
  const plot = await Plot.create({ farmId: req.params.farmId, name, acres, soil, water });
  return ok(res, { plot });
}));

// ── THE FARM'S FACE — one photograph, persisted on the farm document ─────────
// A photograph makes a stranger's place real (the trust layer). The client
// downsizes before upload (max 640px JPEG, tens of KB); the cap here is a guard,
// not the resizing strategy. `/me` returns the farm doc, so the photo rides to
// the app on every boot — no extra fetch, nothing to go stale.
api.post('/farm/:farmId/photo', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const { photo } = req.body || {};
  // THE DEMO WEARS HER FOUNDER'S PHOTOGRAPH (2026-10-09): guarded at the router
  // level now (A2 — the demo immunity is by construction).

  if (typeof photo !== 'string' || !/^data:image\/(jpeg|png);base64,/.test(photo)) {
    return bad(res, 400, 'photo must be a base64 JPEG or PNG data URL');
  }
  if (photo.length > 300000) return bad(res, 413, 'photo too large — resize before upload');
  await Farm.updateOne({ _id: req.params.farmId }, { $set: { photo } });
  return ok(res, { saved: true });
}));

api.delete('/farm/:farmId/photo', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  // THE DEMO WEARS HER FOUNDER'S PHOTOGRAPH (2026-10-09): guarded at the router
  // level now (A2 — the demo immunity is by construction).
  await Farm.updateOne({ _id: req.params.farmId }, { $set: { photo: '' } });
  return ok(res, { saved: true });
}));

api.post('/farm/:farmId/groups', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const { species, label = '', count = 0, productionKind = '' } = req.body || {};
  if (!protocols.speciesList().includes(String(species))) {
    return bad(res, 400, `unknown species. Seeded: ${protocols.speciesList().join(', ')}`);
  }
  const group = await AnimalGroup.create({ farmId: req.params.farmId, species, label, count, productionKind });
  // Setting the group up materialises its whole schedule — the farmer configures
  // nothing. This is the difference between a work list and a template library.
  const farm = await Farm.findById(req.params.farmId);
  const built = await schedule.materialise({
    farmId: farm._id, subjectType: 'group', subjectId: group._id,
    subjectLabel: label || species, species,
  });
  return ok(res, { group, scheduled: built.created });
}));

// ── THE MID-SEASON DOOR — the stage table, served (2026-10-09) ────────────────
// Door 1's picker data: every crop's LOOK bands, derived from its OWN cycle data
// (src/stages.js — the boundaries are the crop's protocol day-offsets; the
// look-words are generic phases placed by fraction of cycle). A crop with no
// planting-anchored schedule is absent here, and the app degrades that crop to
// Door 3 with an honest note — never a dead end.
api.get('/meta/crop-stages', auth.requireAuth('farmer'), wrap(async (_req, res) => {
  return ok(res, { crops: stages.stageTableAll() });
}));

// THE PREVIEW — what a mid-season entry WOULD set, computed by the one pure
// function, before anything writes. The confirm tap gates the write; this is
// what the tap confirms. Read-only: no document is created here.
api.post('/farm/:farmId/crops/preview', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const { crop, stageKey, within = 'mid' } = req.body || {};
  if (!crop) return bad(res, 400, 'crop required');
  const table = stages.stageTable(String(crop));
  if (!table) return bad(res, 400, 'this crop has no stage table yet — start from today instead');
  const calc = stages.backCalculate(String(crop), String(stageKey || ''), String(within || 'mid'));
  if (!calc) return bad(res, 400, 'pick the stage from the list — that one is not in this crop’s cycle');
  const preview = stages.previewFor(String(crop), calc.plantedOn);
  return ok(res, {
    crop, stageKey: calc.stageKey, within: calc.within, band: calc.band,
    plantedOn: calc.plantedOn, weeksAgo: calc.weeksAgo,
    estimatedPast: (preview?.estimatedPast || []).map((e) => ({
      intervention: e.intervention, en: e.en, dueOn: e.dueOn, windowDays: e.windowDays,
    })),
    upcoming: (preview?.upcoming || []).map((e) => ({ intervention: e.intervention, en: e.en, dueOn: e.dueOn })),
    baselines: preview?.baselines || 0,
  });
}));

api.post('/farm/:farmId/crops', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const { plotId = null, crop, variety = '', acres = 0, season = '', plantedOn = null, fodderFor = '' } = req.body || {};
  if (!crop) return bad(res, 400, 'crop required');
  // THE DEMO WEARS ITS OWN FIELDS: guarded at the router level now (A2 — the demo
  // immunity is by construction; the plots/groups note this comment carried is
  // cured by the same middleware).
  const entry = String(req.body?.entry || 'planting');

  // ── THE THREE ENTRIES (the mid-season door, 2026-10-09) ──
  // 'planting'  — the classic path: the farmer knows the date (unchanged behavior).
  // 'midseason' — Door 1/2: the farmer picked the crop's current STAGE; the planting
  //               date is BACK-CALCULATED by the one pure function and stamped as an
  //               estimate. Past events materialise as confirmation-due estimates.
  // 'today'     — Door 3: the farmer knows nothing about the past; plantedOn stays
  //               NULL (nothing is invented), the remaining schedule anchors today.
  let anchor = null;
  let plantedEstimated = false;
  let cycleStart = null;
  let status = 'planned';
  if (entry === 'midseason') {
    const table = stages.stageTable(String(crop));
    if (!table) return bad(res, 400, 'this crop has no stage table yet — start from today instead');
    const calc = stages.backCalculate(String(crop), String(req.body?.stageKey || ''), String(req.body?.within || 'mid'));
    if (!calc) return bad(res, 400, 'pick the stage from the list — that one is not in this crop’s cycle');
    anchor = calc.plantedOn;
    plantedEstimated = true;
    status = 'growing';
  } else if (entry === 'today') {
    cycleStart = new Date();
    anchor = cycleStart;
    status = 'growing';
  } else {
    anchor = plantedOn ? new Date(plantedOn) : null;
    status = anchor ? 'growing' : 'planned';
  }

  const cycle = await CropCycle.create({
    farmId: req.params.farmId, plotId, crop, variety, acres, season,
    plantedOn: entry === 'today' ? null : anchor,
    plantedOnEstimated: plantedEstimated,
    cycleStartOn: cycleStart,
    fodderFor, status,
  });
  const built = await schedule.materialise({
    farmId: req.params.farmId, subjectType: 'cropcycle', subjectId: cycle._id,
    subjectLabel: crop, species: crop,
    anchor: cycle.plantedOn || cycle.cycleStartOn || new Date(),
    markPastAsEstimated: entry === 'midseason',
    futureOnly: entry === 'today',
  });
  // The response says what the door did, so the toast can say it honestly.
  const estCount = await ScheduledEvent.countDocuments({ farmId: req.params.farmId, subjectId: cycle._id, status: 'estimated' });
  return ok(res, {
    cycle, scheduled: built.created,
    entry, estimated: estCount,
    plantedOn: cycle.plantedOn, calendarFrom: cycle.cycleStartOn,
  });
}));

// ──────────────────────────────────────────────────────────────────────────────
// LAYER 1 — WHAT DO I HAVE?
// ──────────────────────────────────────────────────────────────────────────────
// The answer to the first question in the framework, and the thing that had no
// screen: the farmer's ANIMALS and their CROPS, as entities they own and manage.
// Not as rows on a task list, and not as products on a shelf.
//
// One call, because the screen is one screen, and because a farmer on a phone
// should not wait for four round trips to find out what is on their own farm.
//
// Read-only, and deliberately shaped for the farmer: every subject carries the next
// thing due to it, so "what I have" and "what is coming" are answered together. A
// holding with nothing due is as much an answer as one with work.
api.get('/farm/:farmId/inventory', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const farmId = req.params.farmId;
  const now = new Date();

  const [farmDoc, plots, cycles, groups, animals, openEvents, estimatedEvents, holds] = await Promise.all([
    // The header needs the farm's IDENTITY, not just its name — this is the screen
    // that has to feel like the farmer's own place. Photography is the strongest trust
    // signal we have (framework §1.8), so the photos come with it.
    Farm.findById(farmId).select('name slug rung area county story photos verifiedFarm photo').lean(),
    // archivedAt: null — a reversed holding is hidden, not destroyed (src/reversal.js)
    Plot.find({ farmId, archivedAt: null }).sort({ name: 1 }).lean(),
    CropCycle.find({ farmId, archivedAt: null }).sort({ plantedOn: -1 }).lean(),
    AnimalGroup.find({ farmId, active: true, archivedAt: null }).sort({ species: 1 }).lean(),
    Animal.find({ farmId, status: { $ne: 'sold' } }).lean(),
    // Only what is still outstanding. Completed and abandoned history is Layer 2+.
    // Estimated events ride a SEPARATE query — a back-calculated past step is a
    // question, never the crop's "next due" work.
    ScheduledEvent.find({ farmId, status: { $in: ['due', 'carried'] } })
      .select('subjectType subjectId subjectLabel intervention dueOn baseline withdrawal')
      .lean(),
    ScheduledEvent.find({ farmId, status: 'estimated' })
      .select('subjectId intervention dueOn windowDays')
      .sort({ dueOn: 1 }).lean(),
    // active: true — a LIFTED hold (its record was reversed) must not keep showing
    // on the farm screen. Until now this read only the window; the shop read
    // `active` too, so the two faces could disagree. Layer 2's record reversal
    // made the difference visible, so it is closed at the source.
    Hold.find({ farmId, active: true, until: { $gt: now } })
      .select('subjectId subjectLabel affects product until days').lean(),
  ]);

  // A farm doc that does not resolve is a 404, never a 200 with farm:null.
  // The soft shape made the app render an empty farm that looks like lost data;
  // the honest answer sends the caller to the same recovery path as a dead session.
  if (!farmDoc) return bad(res, 404, 'farm not found');

  // The soonest outstanding event per subject. Doing this once in memory beats a query
  // per plot and per group, and a farm is small by construction.
  const nextBySubject = new Map();
  for (const ev of openEvents) {
    const key = String(ev.subjectId);
    const prev = nextBySubject.get(key);
    if (!prev || new Date(ev.dueOn) < new Date(prev.dueOn)) nextBySubject.set(key, ev);
  }
  const holdsBySubject = new Map();
  for (const h of holds) {
    const key = String(h.subjectId);
    if (!holdsBySubject.has(key)) holdsBySubject.set(key, []);
    holdsBySubject.get(key).push({ affects: h.affects, product: h.product, until: h.until, days: h.days });
  }

  const shapeNext = (subjectId) => {
    const ev = nextBySubject.get(String(subjectId));
    if (!ev) return null;
    // Negative means overdue. The app decides how loudly to say so; the API reports
    // the truth rather than clamping it to zero.
    const inDays = Math.round((new Date(ev.dueOn) - now) / 86400000);
    return {
      id: ev._id, intervention: ev.intervention, dueOn: ev.dueOn,
      inDays, overdue: inDays < 0, isBaseline: !!ev.baseline,
      withdrawal: ev.withdrawal || null,
    };
  };

  // Crops hang off their plot, because that is how a farmer thinks about them.
  const estBySubject = new Map();
  for (const ev of estimatedEvents) {
    const key = String(ev.subjectId);
    if (!estBySubject.has(key)) estBySubject.set(key, []);
    const inDays = Math.round((new Date(ev.dueOn) - now) / 86400000);
    estBySubject.get(key).push({
      id: ev._id, intervention: ev.intervention, dueOn: ev.dueOn, inDays,
    });
  }
  const cropsByPlot = new Map();
  const unplaced = [];
  for (const c of cycles) {
    const shaped = {
      _id: c._id, crop: c.crop, variety: c.variety, acres: c.acres, season: c.season,
      status: c.status, plantedOn: c.plantedOn, expectedHarvest: c.expectedHarvest,
      fodderFor: c.fodderFor || '',
      // THE MID-SEASON DOOR fields: an estimated planting date is shown as an
      // estimate everywhere; a Door-3 crop has no planting date at all and carries
      // the day its remaining calendar started instead.
      plantedOnEstimated: !!c.plantedOnEstimated,
      calendarFrom: c.cycleStartOn || null,
      daysGrowing: c.plantedOn ? Math.max(0, Math.round((now - new Date(c.plantedOn)) / 86400000)) : null,
      harvested: c.yield && c.yield.quantity
        ? { quantity: c.yield.quantity, unit: c.yield.unit, on: c.yield.harvestedOn } : null,
      next: shapeNext(c._id),
      estimated: estBySubject.get(String(c._id)) || [],
      holds: holdsBySubject.get(String(c._id)) || [],
    };
    if (c.plotId) {
      const key = String(c.plotId);
      if (!cropsByPlot.has(key)) cropsByPlot.set(key, []);
      cropsByPlot.get(key).push(shaped);
    } else {
      unplaced.push(shaped);
    }
  }

  const animalsByGroup = new Map();
  for (const a of animals) {
    if (!a.groupId) continue;
    const key = String(a.groupId);
    if (!animalsByGroup.has(key)) animalsByGroup.set(key, []);
    animalsByGroup.get(key).push({
      _id: a._id, name: a.name, tag: a.tag, sex: a.sex, bornOn: a.bornOn,
      weightKg: a.weightKg, status: a.status, salePrice: a.salePrice,
      ageMonths: a.bornOn ? Math.floor((now - new Date(a.bornOn)) / (86400000 * 30.44)) : null,
    });
  }

  const shapedPlots = plots.map((p) => ({
    _id: p._id, name: p.name, acres: p.acres, soil: p.soil, water: p.water, notes: p.notes,
    crops: cropsByPlot.get(String(p._id)) || [],
  }));

  const shapedGroups = groups.map((g) => {
    const members = animalsByGroup.get(String(g._id)) || [];
    return {
      _id: g._id, species: g.species, label: g.label, count: g.count,
      productionKind: g.productionKind,
      // The tracked individuals, when the farmer keeps them. Many do not, and an empty
      // list is not an error — the COUNT is still the truth.
      animals: members,
      tracked: members.length,
      next: shapeNext(g._id),
      holds: holdsBySubject.get(String(g._id)) || [],
    };
  });

  return ok(res, {
    farm: farmDoc || null,
    summary: {
      plots: shapedPlots.length,
      acres: Math.round(shapedPlots.reduce((s, p) => s + (p.acres || 0), 0) * 100) / 100,
      crops: cycles.length,
      growing: cycles.filter((c) => c.status === 'growing').length,
      animalGroups: shapedGroups.length,
      animals: shapedGroups.reduce((s, g) => s + (g.count || 0), 0),
      species: shapedGroups.map((g) => g.species),
      production: [...new Set(shapedGroups.map((g) => g.productionKind).filter(Boolean))],
      activeHolds: holds.length,
      // The honest empty state: a farm with nothing here needs SETUP, and the app must
      // not render an empty dashboard as though everything were fine.
      isSetUp: shapedPlots.length > 0 || shapedGroups.length > 0,
    },
    plots: shapedPlots,
    animalGroups: shapedGroups,
    // Crops with no plot: a real case, and hiding them would lose the farmer's data.
    cropsWithoutPlot: unplaced,
    at: now,
  });
}));

// ── TRACK AN ANIMAL (the entry the story page needed: the farmer adds an
// individual to a group — a name, a tag, and whatever she knows today; every
// other field can stay empty and be filled later on the story page).
api.post('/farm/:farmId/animals', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const { groupId, name = '', tag = '', sex = '', bornOn = null, weightKg = 0 } = req.body || {};
  if (!groupId) return bad(res, 400, 'groupId required');
  const g = await AnimalGroup.findOne({ _id: groupId, farmId: req.params.farmId, archivedAt: null }).lean();
  if (!g) return bad(res, 404, 'group not found');
  const a = await Animal.create({
    farmId: req.params.farmId, groupId: g._id, name: String(name || '').trim(),
    tag: String(tag || '').trim(), sex: String(sex || '').trim(), species: g.species,
    bornOn: bornOn ? new Date(bornOn) : null, weightKg: Number(weightKg) || 0,
  });
  return ok(res, { animal: a });
}));

// ── THE ANIMAL'S STORY (the version note's promise, 2026-10-06: "tap any
// animal and see its whole story on one page"). ONE route, everything the
// detail page reads. HONESTY SHAPE: the animal's IDENTITY is its own; the CARE
// and the RECORDS belong to the GROUP it lives in (materialise is group-level —
// the app says so rather than inventing per-animal history). The money is what
// exists: the animal's listed price and the group's open care costs.
api.get('/farm/:farmId/animal/:animalId', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const a = await Animal.findOne({ _id: req.params.animalId, farmId: req.params.farmId }).lean();
  if (!a) return bad(res, 404, 'animal not found');
  const g = a.groupId
    ? await AnimalGroup.findOne({ _id: a.groupId, farmId: req.params.farmId, archivedAt: null }).lean()
    : null;
  const now = new Date();
  const protos = g ? protocols.forSpecies(g.species) : [];
  const labelOf = (id) => {
    const p = protos.find((x) => x.id === id);
    return p ? { sw: p.name, en: p.en } : { sw: id, en: id };
  };
  const events = g
    ? (await ScheduledEvent.find({
        farmId: req.params.farmId, subjectType: 'group', subjectId: g._id,
        status: { $in: ['due', 'carried'] },
      }).sort({ dueOn: 1 }).limit(60).lean())
        .map((e) => ({
          id: String(e._id), intervention: e.intervention, label: labelOf(e.intervention),
          dueOn: e.dueOn, inDays: Math.round((new Date(e.dueOn) - now) / 86400000),
          overdue: new Date(e.dueOn) < now, windowDays: e.windowDays || 7,
          baseline: !!e.baseline, costEstimate: e.costEstimate || 0,
        }))
    : [];
  const holds = g
    ? await Hold.find({ farmId: req.params.farmId, subjectId: g._id, active: true, until: { $gt: now } })
        .select('product affects until days').lean()
    : [];
  const logs = g
    ? await Log.find({ farmId: req.params.farmId, subjectId: g._id, archivedAt: null })
        .sort({ at: -1 }).limit(30).lean()
    : [];
  return ok(res, {
    animal: {
      _id: String(a._id), name: a.name, tag: a.tag, species: a.species, sex: a.sex,
      bornOn: a.bornOn, weightKg: a.weightKg, status: a.status,
      salePrice: a.salePrice || null, photo: a.photo || '',
      ageMonths: a.bornOn ? Math.floor((now - new Date(a.bornOn)) / (86400000 * 30.44)) : null,
    },
    group: g ? { _id: String(g._id), label: g.label || g.species, species: g.species } : null,
    events,
    upcomingKes: events.reduce((s, e) => s + (e.costEstimate || 0), 0),
    holds: holds.map((h) => ({ product: h.product, affects: h.affects, days: h.days, until: h.until })),
    records: logs.map((r) => ({ id: String(r._id), at: r.at, kind: r.kind, product: r.product, note: r.note })),
  });
}));

// ── THE ANIMAL'S OWN EDIT (the founder's audit ruling, 2026-10-08: "iv-A").
// Until now an animal was write-once: no correction, no for-sale, no sold, no
// died — the demo showed a cow priced at KES 95,000 that no real farmer could
// reproduce, and the shop's animalForSale shelf could never be stocked. This
// route is the story page's hand. The same allowlist discipline as the profile
// route: only these fields; a body the farmer can fix is refused plainly. A
// status change is a statement, not a deletion — nothing is archived.
api.patch('/farm/:farmId/animals/:animalId', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const b = req.body || {};
  const a = await Animal.findOne({ _id: req.params.animalId, farmId: req.params.farmId });
  if (!a) return bad(res, 404, 'animal not found');
  const set = {};
  if (b.name !== undefined) set.name = String(b.name).trim().slice(0, 40);
  if (b.tag !== undefined) set.tag = String(b.tag).trim().slice(0, 20);
  if (b.sex !== undefined) set.sex = String(b.sex).trim().slice(0, 10);
  if (b.bornOn !== undefined) set.bornOn = b.bornOn ? new Date(b.bornOn) : null;
  if (b.weightKg !== undefined) {
    const w = Number(b.weightKg);
    if (!Number.isFinite(w) || w < 0) return bad(res, 400, 'the weight must be a number');
    set.weightKg = w;
  }
  if (b.status !== undefined) {
    if (!['alive', 'forSale', 'sold', 'dead'].includes(String(b.status))) {
      return bad(res, 400, 'status must be alive, forSale, sold or dead');
    }
    set.status = String(b.status);
  }
  if (b.salePrice !== undefined) {
    if (b.salePrice === null) set.salePrice = 0;
    else {
      const p = Number(b.salePrice);
      if (!Number.isFinite(p) || p < 0) return bad(res, 400, 'the price must be a number');
      set.salePrice = p;
    }
  }
  if (!Object.keys(set).length) return bad(res, 400, 'nothing to update');
  Object.assign(a, set);
  await a.save();
  const now = new Date();
  return ok(res, { animal: {
    _id: String(a._id), name: a.name, tag: a.tag, species: a.species, sex: a.sex,
    bornOn: a.bornOn, weightKg: a.weightKg, status: a.status,
    salePrice: a.salePrice || null, photo: a.photo || '',
    ageMonths: a.bornOn ? Math.floor((now - new Date(a.bornOn)) / (86400000 * 30.44)) : null,
  } });
}));

// ──────────────────────────────────────────────────────────────────────────────
// REVERSAL — correct it, undo it, put it back. One pattern, all three kinds.
// ──────────────────────────────────────────────────────────────────────────────
// The founder asked for "template reversal... particular input or all data". The whole
// behaviour lives in src/reversal.js so that a group, a plot and a crop cannot drift
// apart; these routes are a thin, uniform shell over it.
//
// The refusal cases are as important as the successful ones: a plot with crops in it is
// refused with a reason rather than silently emptied, and "undo everything" must be
// confirmed by TYPING THE FARM'S OWN NAME, because a tap-through dialog is not a
// confirmation for something that empties a farm.

// Layer 2 adds 'logs' — the RECORDS themselves are reversible, in situ. A
// reversed record lifts the hold it opened and re-opens its schedule event; see
// src/reversal.js RULE 4 for the consequence chain.
const REVERSAL_KINDS = ['groups', 'plots', 'crops', 'logs'];

function checkKind(req, res) {
  if (!REVERSAL_KINDS.includes(req.params.kind)) {
    bad(res, 404, `no such kind: ${req.params.kind}`);
    return false;
  }
  return true;
}

/** Correct a mistake — a mistyped count, a wrong planting date. */
api.patch('/farm/:farmId/:kind/:id', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  if (!checkKind(req, res)) return;
  try {
    const doc = await reversal.edit(req.params.kind, req.params.farmId, req.params.id, req.body || {});
    return ok(res, { updated: doc });
  } catch (e) {
    return bad(res, e.status || 500, e.message);
  }
}));

/** Undo it. Archived, not destroyed, so this can itself be undone. */
api.delete('/farm/:farmId/:kind/:id', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  if (!checkKind(req, res)) return;
  try {
    const r = await reversal.reverse(req.params.kind, req.params.farmId, req.params.id);
    const out = {
      reversed: true,
      // Say what actually happened to the schedule — a farmer who is told "3 dates
      // cancelled" understands; one who is told "deleted" does not know what is left.
      cancelledDates: r.cancelled,
    };
    // RECORDS say more (Layer 2): what happened to the hold and to the work list.
    // The app turns these into honest sentences — "the milk hold is lifted",
    // "the deworming is back on your list".
    if (req.params.kind === 'logs') {
      out.holdsLifted = r.holdsLifted || 0;
      out.eventReopened = !!r.eventReopened;
      out.nextCancelled = r.nextCancelled || 0;
    }
    return ok(res, out);
  } catch (e) {
    return bad(res, e.status || 500, e.message);
  }
}));

/** Put it back, exactly as it was. */
api.post('/farm/:farmId/:kind/:id/restore', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  if (!checkKind(req, res)) return;
  try {
    const r = await reversal.restore(req.params.kind, req.params.farmId, req.params.id);
    const out = { restored: r.doc, datesRestored: r.added };
    if (req.params.kind === 'logs') {
      out.holdsReArmed = r.holdsReArmed || 0;
      out.eventRedone = !!r.eventRedone;
      out.nextRescheduled = !!r.nextRescheduled;
    }
    return ok(res, out);
  } catch (e) {
    return bad(res, e.status || 500, e.message);
  }
}));

/** What has been undone, so it can be recovered. */
api.get('/farm/:farmId/reversed', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  return ok(res, { reversed: await reversal.reversed(req.params.farmId) });
}));

/** ALL DATA. Confirmed by typing the farm's own name. */
api.post('/farm/:farmId/reverse-all', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const farm = await Farm.findById(req.params.farmId).select('name').lean();
  try {
    const counts = await reversal.reverseAll(req.params.farmId, req.body?.confirmName, farm && farm.name);
    return ok(res, { reversed: counts });
  } catch (e) {
    return bad(res, e.status || 500, e.message);
  }
}));

/** Put the whole farm back. */
api.post('/farm/:farmId/restore-all', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  return ok(res, { restored: await reversal.restoreAll(req.params.farmId) });
}));

api.post('/farm/:farmId/sellables', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const {
    product, label = '', labelSw = '', icon = '', unit = '', unitSw = '',
    price, minQty = 1, source = {}, affects = [],
  } = req.body || {};
  if (!product || !(price >= 0)) return bad(res, 400, 'product and price required');
  const doc = await Sellable.findOneAndUpdate(
    { farmId: req.params.farmId, product },
    { $set: { label, labelSw, icon, unit, unitSw, price, minQty, source, affects, enabled: true } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return ok(res, { sellable: doc });
}));

api.get('/farm/:farmId/sellables', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const rows = await Sellable.find({ farmId: req.params.farmId }).lean();
  const availability = await projection.buildAvailability(req.params.farmId, { lang: 'en' });
  return ok(res, { sellables: rows, availability });
}));

// ══════════════════════════════════════════════════════════════════════════════
// FARMER — the daily loop
// ──────────────────────────────────────────────────────────────────────────────
api.get('/farm/:farmId/today', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const work = await schedule.today(req.params.farmId);
  const holds = await projection.activeHolds(req.params.farmId);
  return ok(res, { ...work, holds });
}));

/**
 * LOG — one-tap capture. Offline-first: the client mints `clientId`, so a replayed
 * batch is idempotent and a farmer never loses an entry to a dropped connection.
 */
api.post('/farm/:farmId/logs', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const body = req.body || {};
  const rows = Array.isArray(body.logs) ? body.logs : [body.log || body];

  // Idempotency: if a clientId was already stored, return it rather than duplicate.
  const accepted = [];
  for (const r of rows.slice(0, 200)) {
    if (!r || !r.kind) continue;
    if (r.clientId) {
      const seen = await Log.findOne({ farmId: req.params.farmId, clientId: String(r.clientId) }).lean();
      if (seen) { accepted.push({ id: seen._id, duplicate: true }); continue; }
    }
    const doc = await Log.create({
      farmId: req.params.farmId,
      kind: String(r.kind),
      at: r.at ? new Date(r.at) : new Date(),
      byMemberId: req.auth.mid || null,
      subjectType: r.subjectType || '',
      subjectId: r.subjectId || null,
      subjectLabel: r.subjectLabel || '',
      product: r.product || '',
      quantity: Number(r.quantity) || 0,
      unit: r.unit || '',
      amountKES: Number(r.amountKES) || 0,
      buyer: r.buyer || '',
      note: r.note || '',
      clientId: r.clientId || undefined,
      deviceAt: r.deviceAt ? new Date(r.deviceAt) : null,
    });
    accepted.push({ id: doc._id });

    // A treatment logged directly (not through the schedule) still opens a hold —
    // the compliance rule must not depend on which path the farmer took.
    if ((doc.kind === 'treatment' || doc.kind === 'spray') && Number(r.withdrawalDays) > 0) {
      await Hold.create({
        farmId: req.params.farmId, subjectType: doc.subjectType || 'group',
        subjectId: doc.subjectId, subjectLabel: doc.subjectLabel,
        product: doc.product || doc.kind, affects: r.affects || ['milk'],
        days: Number(r.withdrawalDays), startedAt: new Date(),
        until: new Date(Date.now() + Number(r.withdrawalDays) * 86400000),
        active: true,
        viaLogId: doc._id,   // reversal follows the RECORD that opened the hold (Layer 2)
      });
    }
  }

  const farm = await Farm.findById(req.params.farmId);
  farm.confidence = { ...(farm.confidence || {}), lastLoggedAt: new Date() };
  await farm.save();

  const holds = await projection.activeHolds(req.params.farmId);
  const availability = await projection.buildAvailability(req.params.farmId);
  // The projection result is returned in the SAME response, so the farmer can SEE
  // their log change the shop. That feedback loop is what keeps them logging.
  return ok(res, { accepted, holds, availability });
}));

// ──────────────────────────────────────────────────────────────────────────────
// RECORDS — Layer 2: "What did I do, and what happened?"
// ──────────────────────────────────────────────────────────────────────────────
// The read side of the record. Until now the logs existed only as WRITE targets
// (quick capture, event completion) and as projection inputs; the farmer could not
// SEE their own history anywhere. This answers it: the newest records first, every
// row shaped in plain language inputs (what, how much, on what, when) — the APP
// renders the sentences, because the farmer's language lives there.
//
// `days` bounds the window (default 14, cap 90): a farmer reads recent history,
// not an archive. Reversed records are excluded here — they live in /reversed
// until restored. Every row carries whether it came from the schedule and whether
// it opened a hold, so the app can say "milk not for sale for 3 days" next to the
// deworming that caused it — cause and consequence on one line.
api.get('/farm/:farmId/records', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 14, 1), 90);
  const since = new Date(Date.now() - days * 86400000);
  const rows = await Log.find({ farmId: req.params.farmId, archivedAt: null, at: { $gte: since } })
    .sort({ at: -1 })
    .limit(400)
    .lean();

  // The holds these records opened, looked up once and matched by either link.
  // Only still-active holds are attached — a lifted hold is not a fact about today.
  const holds = await Hold.find({ farmId: req.params.farmId, active: true }).lean();
  const byLog = new Map(holds.filter((h) => h.viaLogId).map((h) => [String(h.viaLogId), h]));
  const byEvent = new Map(holds.filter((h) => h.viaEventId).map((h) => [String(h.viaEventId), h]));

  const records = rows.map((r) => {
    const hold = byLog.get(String(r._id)) || (r.scheduledEventId ? byEvent.get(String(r.scheduledEventId)) : null);
    return {
      id: String(r._id),
      at: r.at,
      kind: r.kind,
      product: r.product,
      quantity: r.quantity,
      unit: r.unit,
      subjectLabel: r.subjectLabel,
      note: r.note,
      amountKES: r.amountKES || 0,
      fromSchedule: !!r.scheduledEventId,
      hold: hold ? { affects: hold.affects, days: hold.days, until: hold.until } : null,
    };
  });

  return ok(res, { records, counts: { shown: records.length, days } });
}));

// ──────────────────────────────────────────────────────────────────────────────
// SHARPEN — Layer 3: "What is working, what is not?"  (free layer, §1.5)
// ──────────────────────────────────────────────────────────────────────────────
// The records the farmer already keeps, aggregated into PLAIN SHAPES — numbers
// and windows only, never sentences: the farmer's language lives in the app, and
// the vocabulary law (no accountancy words) is enforced there. The app renders
// "Your 6 cows gave 118 litres this week — 14 more than last week" from these
// fields; the server never says it, so both languages stay honest.
//
// Design laws carried in:
// - ANIMALS AND CROPS AS EQUALS: one response carries both, neither is an
//   afterthought.
// - REVERSAL-AWARE: archived records and archived holdings are excluded — an
//   undone record must not sharpen a picture it is no longer part of.
// - CARE ADHERENCE, not nagging: how many of this window's completions were done
//   within the protocol's tolerance window (doneAt <= dueOn + windowDays), and
//   how many were late. Numbers, never judgement.
api.get('/farm/:farmId/sharp', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const DAY = 86400000;
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
  const now = Date.now();
  const since = new Date(now - days * DAY);
  const prevSince = new Date(now - 2 * days * DAY);

  const [groups, cycles, plots] = await Promise.all([
    AnimalGroup.find({ farmId: req.params.farmId, archivedAt: null }).lean(),
    CropCycle.find({ farmId: req.params.farmId, archivedAt: null }).lean(),
    Plot.find({ farmId: req.params.farmId, archivedAt: null }).select('name').lean(),
  ]);
  const plotName = new Map(plots.map((p) => [String(p._id), p.name]));

  const logs = await Log.find({
    farmId: req.params.farmId, archivedAt: null,
    kind: { $in: ['milk', 'eggs', 'harvest', 'mortality'] },
    at: { $gte: prevSince },
  }).lean();

  const events = await ScheduledEvent.find({
    farmId: req.params.farmId, status: 'done', doneAt: { $gte: since },
  }).select('subjectId intervention dueOn doneAt windowDays').lean();

  const orders = await Order.find({
    farmId: req.params.farmId, stage: 5, createdAt: { $gte: since },
  }).select('total createdAt').lean();

  const round2 = (n) => Math.round(n * 100) / 100;

  // ── per animal group ──
  const groupList = groups.map((g) => {
    const gid = String(g._id);
    const mine = logs.filter((l) => String(l.subjectId || '') === gid);
    // Groups may name their production 'milk' or 'dairy' (both spellings live in
    // the wild); the LOG kind they feed is 'milk' or 'eggs'. Map liberally.
    const pk = ({ milk: 'milk', dairy: 'milk', eggs: 'eggs' })[g.productionKind || ''] || '';
    const prod = mine.filter((l) => pk && l.kind === pk);
    const sum = (rows) => round2(rows.reduce((s, l) => s + (Number(l.quantity) || 0), 0));
    const production = prod.length ? {
      product: prod[0].product || (pk === 'milk' ? 'milk' : 'eggs'),
      unit: prod[0].unit || (pk === 'milk' ? 'litre' : 'tray'),
      this: sum(prod.filter((l) => l.at >= since)),
      prev: sum(prod.filter((l) => l.at < since)),
    } : null;
    const losses = mine.filter((l) => l.kind === 'mortality' && l.at >= since)
      .reduce((s, l) => s + (Number(l.quantity) || 1), 0);
    const evs = events.filter((e) => String(e.subjectId || '') === gid);
    const late = evs.filter((e) => new Date(e.doneAt) > new Date(new Date(e.dueOn).getTime() + (e.windowDays || 7) * DAY)).length;
    return {
      id: gid, label: g.label, count: g.count || 0, species: g.species || '',
      production, losses,
      care: { done: evs.length, late },
    };
  });

  // ── per crop ──
  const cropList = cycles.map((c) => {
    const mine = logs.filter((l) => String(l.subjectId || '') === String(c._id) && l.kind === 'harvest');
    return {
      id: String(c._id), crop: c.crop, plot: plotName.get(String(c.plotId)) || '',
      status: c.status,
      daysGrowing: c.plantedOn ? Math.max(0, Math.floor((now - new Date(c.plantedOn).getTime()) / DAY)) : null,
      harvestThis: round2(mine.filter((l) => l.at >= since).reduce((s, l) => s + (Number(l.quantity) || 0), 0)),
      unit: (c.yield && c.yield.unit) || (mine[0] && mine[0].unit) || '',
    };
  });

  // ── the record pulse + completed sales ──
  const pulseNow = await Log.countDocuments({ farmId: req.params.farmId, archivedAt: null, at: { $gte: since } });
  const pulsePrev = await Log.countDocuments({ farmId: req.params.farmId, archivedAt: null, at: { $gte: prevSince, $lt: since } });
  const sales = {
    orders: orders.length,
    kes: round2(orders.reduce((s, o) => s + (Number(o.total) || 0), 0)),
  };

  return ok(res, {
    window: { days },
    groups: groupList,
    crops: cropList,
    pulse: { this: pulseNow, prev: pulsePrev },
    sales,
  });
}));


/** COMPLETE a scheduled event — marks done, records it, opens the hold, sets the next. */
api.post('/farm/:farmId/events/:eventId/complete', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const farm = await Farm.findById(req.params.farmId);
  const result = await schedule.complete({
    farm, eventId: req.params.eventId, byMemberId: req.auth.mid || null,
    productUsed: req.body?.productUsed || '', speciesHint: req.body?.species || '',
    // A5: the client's own id — the second tap (or the TRY-AGAIN retry) lands on
    // the atomic claim as an honest no-op, and the Log's partial index recognises
    // a replayed id.
    clientId: String(req.body?.clientId || '').slice(0, 64),
  });
  if (!result.ok) return bad(res, 404, result.error || 'event not found');
  const holds = await projection.activeHolds(req.params.farmId);
  const availability = await projection.buildAvailability(req.params.farmId);
  return ok(res, { ...result, holds, availability });
}));

// ── THE ESTIMATED STEPS (the mid-season door's confirmation-due events) ───────
// A mid-season entry back-calculates the planting date, and the steps that date
// puts in the PAST are questions, not records: "already done (estimated)". Confirm
// runs the normal completion machinery (record + hold + next occurrence) and the
// record SAYS it was confirmed from an estimate. Dismiss deletes the event —
// zero trace in the ledgers or the records.
// THE DEMO GUARD: now at the router level (A2 — the demo immunity is by
// construction; the demoGuard copies are retired).

api.post('/farm/:farmId/events/:eventId/confirm-estimated', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const farm = await Farm.findById(req.params.farmId);
  if (!farm) return bad(res, 404, 'farm not found');
  const ev = await ScheduledEvent.findOne({ _id: req.params.eventId, farmId: req.params.farmId }).lean();
  if (!ev) return bad(res, 404, 'event not found');
  if (ev.status !== 'estimated') return bad(res, 409, 'only an estimated step can be confirmed here');
  const result = await schedule.complete({
    farm, eventId: req.params.eventId, byMemberId: req.auth.mid || null,
    productUsed: req.body?.productUsed || '', speciesHint: req.body?.species || '',
    noteExtra: 'confirmed from the mid-season estimate (planting date estimated)',
    // THE HONESTY FLAG (the founder's ruling, 2026-10-11): this record was
    // BACK-CALCULATED by the mid-season estimate, not witnessed by the farmer. It
    // travels as `estimated: true` so readiness can never count it as history — the
    // estimate buys a SCHEDULE, never HISTORY. See farmFacts().
    estimated: true,
  });
  if (!result.ok) return bad(res, 404, result.error || 'event not found');
  const holds = await projection.activeHolds(req.params.farmId);
  const availability = await projection.buildAvailability(req.params.farmId);
  return ok(res, { ...result, holds, availability });
}));

api.post('/farm/:farmId/events/:eventId/dismiss-estimated', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const farm = await Farm.findById(req.params.farmId).select('isDemo').lean();
  if (!farm) return bad(res, 404, 'farm not found');
  // ZERO TRACE: the document is removed, not flagged. No Log, no Hold, no
  // record of any kind was ever written for a dismissed estimate, and now the
  // question itself is gone too. materialise() will not resurrect it unless the
  // planting anchor itself changes — and then it is a new estimate, honestly made.
  const out = await ScheduledEvent.findOneAndDelete({ _id: req.params.eventId, farmId: req.params.farmId, status: 'estimated' });
  if (!out) return bad(res, 404, 'event not found — it may already be dismissed');
  return ok(res, { dismissed: true });
}));

// ══════════════════════════════════════════════════════════════════════════════
// THE FEEDBACK CHAT (the LoopKeeper tester-channel mechanism, farmline-shaped —
// the founder: "Clone the chat feature in LoopKeeper home page and place it at
// header of farmline home (shamba) page, so that it opens and any one can give
// feedback, text or images. Assign them persistent id when they try to chat").
// The domain logic lives in src/feedback.js; these routes are its HTTP face.
// NO AUTH on the sender's doors: the persistent FL- id bound to the device is the
// identity (LoopKeeper's mint, idempotent per device). NO farm document is touched
// — the demo's immutability is untouched by construction. REST only (the socket
// requires an HMAC principal an anonymous sender does not have); the sheet polls
// while it stands.
// ══════════════════════════════════════════════════════════════════════════════

// The send valve: looser than the mint's (a real conversation sends many lines),
// still a wall against a flood — 120/hour/IP with the same sweep shape.
const feedbackSends = new Map();
function feedbackSendRateLimit(req, res, next) {
  const ip = auth.clientIp(req);   // A3: the unspoofable resolution, one helper
  const now = Date.now();
  if (feedbackSends.size > 500) {
    for (const [k, v] of feedbackSends) if (now - v.ts > 3600_000) feedbackSends.delete(k);
  }
  const rec = feedbackSends.get(ip) || { n: 0, ts: now };
  if (now - rec.ts > 3600_000) { rec.n = 0; rec.ts = now; }
  rec.n += 1;
  feedbackSends.set(ip, rec);
  if (rec.n > 120) return res.status(429).json({ ok: false, error: 'too many messages — try again later' });
  next();
}

// THE MINT — idempotent per device: the same device always gets the SAME FL- id
// (LoopKeeper's POST /chat-id shape). One id per device, forever.
api.post('/feedback/id', auth.mintRateLimit, wrap(async (req, res) => {
  const deviceId = String(req.body?.deviceId || '').slice(0, 80);
  if (!deviceId) return bad(res, 400, 'deviceId required');
  const minted = await feedback.ensureId(deviceId);
  if (!minted) return bad(res, 500, 'feedback id mint failed');
  return ok(res, { ok: true, feedbackId: minted.feedbackId, created: minted.created });
}));

// THE SEND — the sender's line (text or text+photo). Nothing writes without the
// tap that already happened; the binding (id ↔ device) is the scope check.
api.post('/feedback/chat', feedbackSendRateLimit, wrap(async (req, res) => {
  const deviceId = String(req.body?.deviceId || '').slice(0, 80);
  const feedbackId = String(req.body?.feedbackId || '').toUpperCase().slice(0, 16);
  if (!deviceId || !feedbackId) return bad(res, 400, 'deviceId and feedbackId required');
  const r = await feedback.send({
    deviceId, feedbackId,
    text: req.body?.text || '', photo: req.body?.photo || '',
    clientId: String(req.body?.clientId || '').slice(0, 64),
  });
  if (!r.ok) return bad(res, r.status || 400, r.error);
  return ok(res, { ok: true, duplicate: !!r.duplicate });
}));

// THE READ — the sender's own thread; reading stamps their receipt.
api.get('/feedback/chat', wrap(async (req, res) => {
  const deviceId = String(req.query?.deviceId || '').slice(0, 80);
  const feedbackId = String(req.query?.feedbackId || '').toUpperCase().slice(0, 16);
  if (!deviceId || !feedbackId) return bad(res, 400, 'deviceId and feedbackId required');
  const r = await feedback.read({ deviceId, feedbackId });
  if (!r) return bad(res, 403, 'this feedback id does not belong to this device');
  return ok(res, { ok: true, ...r });
}));

// THE HQ INBOX (the FARMLINE_ADMIN_KEY gate, the /admin/farms pattern): every
// thread, newest activity first; reading stamps HQ's receipt so the sender's
// sheet can show that the report was picked up.
api.get('/feedback/chat/inbox', wrap(async (req, res) => {
  // B11: the admin key rides the x-admin-key HEADER; the query form still works
  // for one release, then deprecates (query strings land in logs and history).
  const gate = config.checkAdminKey(String(req.headers['x-admin-key'] || req.query?.key || ''));
  if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error });
  const threads = await feedback.inbox();
  return ok(res, { ok: true, threads });
}));

// THE HQ REPLY — HQ's line lands in the same thread; the sender's sheet sees it
// on the next poll while the sheet stands (the LoopKeeper promise).
api.post('/feedback/chat/reply', wrap(async (req, res) => {
  const gate = config.checkAdminKey(String(req.body?.key || ''));
  if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error });
  const r = await feedback.reply(req.body?.feedbackId, req.body?.text);
  if (!r.ok) return bad(res, r.status || 400, r.error);
  return ok(res, { ok: true });
}));

// ══════════════════════════════════════════════════════════════════════════════
// THE RATINGS (Task 6, the founder: "an intuitive ratings bar — Rate Farmline,
// backend persisted, truthful, and live — inside the top section of the Feedback
// chat interface, sticky"). THE IDENTITY is the FL- feedback id (Task 5's mint —
// the sheet's native identity; a signed-in farmer using the sheet carries theirs
// all the same). ONE current rating per identity, the latest wins; the history
// keeps the trend (capped at 20). The tap IS the action (the capture-honesty law);
// the id↔device binding is the scope check (the chat's law); NO farm document is
// touched (demo-safe by construction).
// ══════════════════════════════════════════════════════════════════════════════

// THE RATE — one tap, the rating lands. Re-taps update (latest wins); the previous
// value falls into the history for the trend.
api.post('/rating', auth.mintRateLimit, wrap(async (req, res) => {
  const deviceId = String(req.body?.deviceId || '').slice(0, 80);
  const feedbackId = String(req.body?.feedbackId || '').toUpperCase().slice(0, 16);
  const value = Number(req.body?.value);
  if (!deviceId || !feedbackId) return bad(res, 400, 'deviceId and feedbackId required');
  if (!Number.isInteger(value) || value < 1 || value > 5) return bad(res, 400, 'value must be 1..5');
  const thread = await feedback.threadFor(deviceId, feedbackId);
  if (!thread) return bad(res, 403, 'this feedback id does not belong to this device');
  const existing = await Rating.findOne({ identity: feedbackId }).lean();
  if (existing) {
    const history = [...(existing.history || []), { value: existing.value, at: existing.at || existing.createdAt }].slice(-20);
    await Rating.updateOne({ _id: existing._id }, { $set: { value, at: new Date(), history } });
  } else {
    await Rating.create({ identity: feedbackId, value, history: [] });
  }
  return ok(res, { ok: true, value });
}));

// THE OWN READ — the identity's current rating (the sheet's initial star state);
// an unrated identity answers null honestly.
api.get('/rating', wrap(async (req, res) => {
  const deviceId = String(req.query?.deviceId || '').slice(0, 80);
  const feedbackId = String(req.query?.feedbackId || '').toUpperCase().slice(0, 16);
  if (!deviceId || !feedbackId) return bad(res, 400, 'deviceId and feedbackId required');
  const thread = await feedback.threadFor(deviceId, feedbackId);
  if (!thread) return bad(res, 403, 'this feedback id does not belong to this device');
  const r = await Rating.findOne({ identity: feedbackId }).lean();
  return ok(res, { ok: true, value: r ? r.value : null, at: r?.at || null });
}));

// THE PUBLIC AGGREGATE — the truth law: the real stored average, honestly rounded
// to one decimal; an unrated world answers count 0 and NO average (never a zero
// presented as a score, never a fabricated number).
api.get('/meta/rating', wrap(async (_req, res) => {
  const agg = await Rating.aggregate([{ $group: { _id: null, count: { $sum: 1 }, avg: { $avg: '$value' } } }]);
  const count = agg[0]?.count || 0;
  const average = count ? Math.round(agg[0].avg * 10) / 10 : null;
  return ok(res, { count, average, at: new Date().toISOString() });
}));

// ══════════════════════════════════════════════════════════════════════════════
// C5: THE PRICE INTELLIGENCE — PriceObservation was modelled but NO ROUTE wrote
// or read it, so the market-intelligence rung was data-model-only. Two doors:
//   · POST /farm/:farmId/prices — the farmer reports what their product really
//     sold for (source 'farmer'; the tap is the action; the mint valve).
//   · GET /meta/prices?product= — the PUBLIC aggregate (count, average, low, high,
//     the last observed) over the last 30 days for one product, or the top
//     products when none is named. Averages carry their count — a number with no
//     crowd behind it is not shown (the no-assurance law).
// ══════════════════════════════════════════════════════════════════════════════
api.post('/farm/:farmId/prices', auth.requireAuth('farmer'), auth.requireFarmScope, auth.mintRateLimit, wrap(async (req, res) => {
  const product = String(req.body?.product || '').trim().toLowerCase().slice(0, 40);
  const price = Number(req.body?.price);
  if (!product) return bad(res, 400, 'the product is required');
  if (!Number.isFinite(price) || price <= 0) return bad(res, 400, 'the price must be a positive number');
  const obs = await PriceObservation.create({
    farmId: req.params.farmId,
    product,
    unit: String(req.body?.unit || '').slice(0, 12),
    price,
    market: String(req.body?.market || '').slice(0, 60),
    source: 'farmer',
  });
  return ok(res, { price: { id: String(obs._id), product: obs.product, price: obs.price, at: obs.observedAt } });
}));

api.get('/meta/prices', wrap(async (req, res) => {
  const product = String(req.query?.product || '').trim().toLowerCase();
  const since = new Date(Date.now() - 30 * 86400000);
  const match = product ? { product, observedAt: { $gte: since } } : { observedAt: { $gte: since } };
  const group = product ? null : '$product';
  const agg = await PriceObservation.aggregate([
    { $match: match },
    { $group: {
      _id: group,
      count: { $sum: 1 },
      average: { $avg: '$price' },
      low: { $min: '$price' },
      high: { $max: '$price' },
      last: { $max: '$observedAt' },
      unit: { $first: '$unit' },
    } },
    { $sort: { count: -1 } },
    { $limit: product ? 1 : 20 },
  ]);
  const round = (n) => (Number.isFinite(n) ? Math.round(n * 10) / 10 : null);
  const shape = (r) => r && ({
    product: r._id || product,
    count: r.count,
    // An average stands only when a crowd stands behind it.
    average: r.count >= 3 ? round(r.average) : null,
    low: round(r.low), high: round(r.high),
    unit: r.unit || '', last: r.last,
  });
  return ok(res, { prices: product ? (agg[0] ? [shape(agg[0])] : []) : agg.map(shape) });
}));

// ══════════════════════════════════════════════════════════════════════════════
// C2 (the server face): THE PER-FARM OG DATA — the one JSON a per-farm share
// card needs, public, keyed by the shop slug. The card itself needs an nginx
// rewrite to feed crawler UAs this JSON (the requested diff is in the thread
// report); until that lands, the app shares the honest static card and this
// route carries the truth for the day the plumbing arrives.
// ══════════════════════════════════════════════════════════════════════════════
api.get('/og/s/:slug', wrap(async (req, res) => {
  const farm = await Farm.findOne({ slug: String(req.params.slug || '').toLowerCase() }).lean();
  if (!farm) return bad(res, 404, 'no such farm');
  const shelf = await projection.buildAvailability(String(farm._id));
  return ok(res, {
    og: {
      title: `${farm.name} — fresh from the farm`,
      description: farm.story || 'Order straight from a real smallholder farm.',
      image: farm.photo || '',
      url: `${config.publicUrl}${config.basePath}/s/${farm.slug}`,
      products: (Array.isArray(shelf) ? shelf : []).filter((i) => i.qty > 0).length,
    },
  });
}));

api.get('/farm/:farmId/holds', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  return ok(res, { holds: await projection.activeHolds(req.params.farmId) });
}));

api.get('/farm/:farmId/orders', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const orders = await Order.find({ farmId: req.params.farmId }).sort({ createdAt: -1 }).limit(50).lean();
  return ok(res, { orders });
}));

api.post('/farm/:farmId/orders/:orderId/stage', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const stage = Math.max(0, Math.min(5, Number(req.body?.stage) || 0));
  const order = await Order.findOneAndUpdate(
    { _id: req.params.orderId, farmId: req.params.farmId },
    { $set: { stage }, $push: { stageHistory: { stage, at: new Date() } } },
    { new: true },
  );
  if (!order) return bad(res, 404, 'order not found');
  if (stage === 5) await Farm.updateOne({ _id: req.params.farmId }, { $inc: { 'trust.ordersFulfilled': 1 } });
  return ok(res, { order });
}));

// ══════════════════════════════════════════════════════════════════════════════
// CHAT — farmer ↔ buyer (src/chat.js). Real-time over socket.io, and ALWAYS
// available over REST so a phone that lost its socket can still read and send.
// ══════════════════════════════════════════════════════════════════════════════

/** Open (or continue) the thread with a farm. Customer-initiated, from the shop;
 *  ALSO the farmer's order-anchored open (the audit's dead "Write to the buyer"
 *  on Oda — 2026-10-08). The farmer supplies only the ORDER: the buyer is read
 *  from it, scoped to the farmer's OWN farm, never from the wire. */
api.post('/conversations', auth.requireAuth('customer', 'farmer'), wrap(async (req, res) => {
  if (req.auth.typ === 'farmer') {
    const orderId = String(req.body?.orderId || '');
    if (!orderId) return bad(res, 400, 'an orderId is required to open a thread from the farm side');
    const order = await Order.findOne({ _id: orderId, farmId: req.auth.sub }).lean();
    if (!order) return bad(res, 404, 'order not found on your farm');
    if (!order.customerId) return bad(res, 404, 'that order has no buyer account to message');
    const conv = await chat.openConversation({
      farmId: order.farmId, customerId: order.customerId, orderId: order._id,
    });
    if (!conv) return bad(res, 404, 'could not open the conversation');
    return ok(res, { conversation: shapeConversation(conv) });
  }
  const slug = String(req.body?.slug || '').trim();
  const farm = slug
    ? await Farm.findOne({ slug }).select('_id')
    : (req.body?.farmId ? await Farm.findById(req.body.farmId).select('_id').catch(() => null) : null);
  if (!farm) return bad(res, 404, 'farm not found');
  const conv = await chat.openConversation({
    farmId: farm._id, customerId: req.auth.sub, orderId: req.body?.orderId || null,
  });
  if (!conv) return bad(res, 404, 'could not open the conversation');
  return ok(res, { conversation: shapeConversation(conv) });
}));

/** Every thread this principal is in — the farmer's inbox, or the buyer's. */
api.get('/conversations', auth.requireAuth('farmer', 'customer'), wrap(async (req, res) => {
  const principal = { type: req.auth.typ, id: req.auth.sub };
  const rows = await chat.listFor(principal);
  return ok(res, { conversations: rows });
}));

/** The messages. Scoped: a non-participant gets 403, not an empty thread. */
api.get('/conversations/:id/messages', auth.requireAuth('farmer', 'customer'), wrap(async (req, res) => {
  const principal = { type: req.auth.typ, id: req.auth.sub };
  const conv = await chat.canAccess(req.params.id, principal);
  if (!conv) return bad(res, 403, 'not your conversation');
  const rows = await chat.history(conv._id, { limit: Number(req.query.limit) || 200 });
  return ok(res, {
    conversation: shapeConversation(conv),
    messages: rows.map(shapeMessage),
  });
}));

/** Send a message over REST. Same path as the socket — one write, two doors. */
api.post('/conversations/:id/messages', auth.requireAuth('farmer', 'customer'), wrap(async (req, res) => {
  const principal = { type: req.auth.typ, id: req.auth.sub };
  const conv = await chat.canAccess(req.params.id, principal);
  if (!conv) return bad(res, 403, 'not your conversation');
  const label = principal.type === 'farmer' ? conv.farmLabel : conv.customerLabel;
  const out = await chat.postMessage({
    conversationId: conv._id, fromType: principal.type, fromId: principal.id,
    fromLabel: label, body: req.body?.body, photo: req.body?.photo || '',
    clientId: req.body?.clientId || undefined,
  });
  if (!out.ok) return bad(res, 400, out.error);
  return ok(res, { message: shapeMessage(out.message), duplicate: !!out.duplicate });
}));

/** Mark this side's thread read. */
api.post('/conversations/:id/read', auth.requireAuth('farmer', 'customer'), wrap(async (req, res) => {
  const principal = { type: req.auth.typ, id: req.auth.sub };
  const conv = await chat.canAccess(req.params.id, principal);
  if (!conv) return bad(res, 403, 'not your conversation');
  const at = await chat.markRead(conv._id, principal);
  return ok(res, { readAt: at });
}));

// ══════════════════════════════════════════════════════════════════════════════
// THE M-PESA CALLBACK IS DELETED — READ THIS BEFORE PUTTING ANYTHING BACK
// ══════════════════════════════════════════════════════════════════════════════
// What stood here: `POST /mpesa/callback[/:seg]`, which settled a buyer's payment
// to a FARMER against a public endpoint, plus the amount-mismatch logic and the
// idempotence trail behind it. It was hardened once (secret in the URL, A1),
// which then leaked that secret into the nginx access log (N1) and needed a
// constant-time compare (N2).
//
// The founder's ruling of 2026-10-11 removed the need for any of it: Farmline is
// not between a farmer and a buyer, so Farmline has no settlement to be told
// about. The rail — and this callback with it — is deleted, not disabled. A1, N1
// and N2 are not fixed here; they are UNREACHABLE, because the code that carried
// them no longer exists. That is the point, and it is worth more than a hardened
// callback would have been.
//
// DO NOT REINTRODUCE a money callback. If a provider is ever added (Paystack,
// Flutterwave, M-Pesa), it may automate the CONFIRMATION of a ZU claim —
// /zu/claims/:id/confirm — and nothing else. Money still moves one way: the payer
// → US, into our own account, for our own service. See
// D:\TODOs\farmline-zu-doctrine-20261011.md, and src/money.js for the why.

// ══════════════════════════════════════════════════════════════════════════════
// FARMER — the ladder (the self-deciding engine)
// ─═════════════════════════════════════════════════════════════════════════════
/**
 * FARM FACTS — the numbers readiness decides on.
 *
 * THE HONESTY RULE (the founder's ruling, 2026-10-11: "readiness must exclude
 * estimated artifacts or we allow a monster"). The mid-season door writes
 * BACK-CALCULATED logs (`estimated: true`) so a farmer gets a schedule to work to.
 * Those are real value, and they must NEVER count as history — otherwise a farmer
 * could manufacture three weeks of records in one afternoon and buy the VERDICT
 * badge on fiction.
 *
 * So the line is: the SETUP may be declared (a crop he started is a crop he
 * started), but the HISTORY must be earned. Every count below is `estimated: false`.
 *
 * `confidence` is DERIVED here, on read. Nothing persisted it before — the field
 * existed, was read by readiness, and was written by nobody, which is why the
 * ladder could never recommend past rung 2 and the only visible way into a paid
 * rung was the shortcut. It is derived for the same reason the ZU balance is: a
 * stored grade drifts away from the records it claims to summarise, and the ladder
 * would then be deciding on a stale opinion.
 */
async function farmFacts(farmId) {
  const since = new Date(Date.now() - 30 * 86400000);
  const real = { farmId, estimated: { $ne: true } };
  const [logs30d, oldestAgg, dayAgg, sellables, plots, groups, cycles, treatments, orders, completed, newestAgg] = await Promise.all([
    Log.countDocuments({ ...real, at: { $gte: since } }),
    Log.aggregate([{ $match: real }, { $group: { _id: null, oldest: { $min: '$at' } } }]),
    Log.aggregate([
      { $match: { ...real, at: { $gte: since } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$at' } } } },
      { $count: 'days' },
    ]),
    Sellable.countDocuments({ farmId }),
    Plot.countDocuments({ farmId }),
    AnimalGroup.countDocuments({ farmId, active: true }),
    CropCycle.countDocuments({ farmId }),
    Log.countDocuments({ ...real, kind: { $in: ['treatment', 'spray'] } }),
    Order.countDocuments({ farmId }),
    Order.countDocuments({ farmId, stage: 5 }),
    Log.aggregate([{ $match: real }, { $group: { _id: null, newest: { $max: '$at' } } }]),
  ]);
  const oldest = oldestAgg[0]?.oldest ? new Date(oldestAgg[0].oldest) : null;
  const newest = newestAgg[0]?.newest ? new Date(newestAgg[0].newest) : null;
  const daysOfHistory = oldest ? Math.floor((Date.now() - oldest.getTime()) / 86400000) : 0;
  const distinctDays = dayAgg[0]?.days || 0;
  const farm = await Farm.findById(farmId).lean();

  // The grade, from REAL records. The thresholds match the product's own copy:
  // 21 days is where the comparisons unlock, "about 30 days" is where the verdict
  // becomes trustworthy. 30 distinct days ≈ a month of actually showing up.
  const derived = (distinctDays >= 30 && logs30d >= 45) ? 'high'
    : (distinctDays >= 21 && logs30d >= 25) ? 'medium'
      : 'low';
  // A stored grade is honoured ONLY when the records support it — never above them.
  const rank = { low: 0, medium: 1, high: 2 };
  const stored = farm?.confidence?.grade;
  const confidence = (stored && rank[stored] !== undefined && rank[stored] <= rank[derived]) ? stored : derived;

  return {
    logs30d, daysOfHistory, distinctDays, sellables, plots, animalGroups: groups, cropCycles: cycles,
    treatmentsLogged: treatments, orderCount: orders, completedOrders: completed,
    hasRequiredIncome: !!(farm?.requiredIncome?.offFarmMonthly || farm?.requiredIncome?.householdMonthly),
    confidence, confidenceDerived: derived,
    lastLoggedAt: newest,   // REAL activity only — what the staleness/pause rule must read
  };
}

/**
 * THE FARM AS THE LADDER SHOULD SEE IT. `ladder.staleness()` reads
 * `confidence.lastLoggedAt`, which nothing stores — so the pause rule could never
 * fire. This attaches the newest REAL log before the ladder is asked anything, so
 * "has this farm stopped working?" is answered from records, not from a field that
 * is always empty.
 */
async function farmWithActivity(farm) {
  if (!farm) return farm;
  const last = await Log.findOne({ farmId: farm._id, estimated: { $ne: true } })
    .sort({ at: -1 }).select('at').lean();
  return { ...farm, confidence: { ...(farm.confidence || {}), lastLoggedAt: last?.at || null } };
}

api.get('/farm/:farmId/ladder', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const raw = await Farm.findById(req.params.farmId).lean();
  const farm = await farmWithActivity(raw);
  const facts = await farmFacts(req.params.farmId);
  const read = ladder.readiness(facts);
  const stale = ladder.staleness(farm);
  const eff = ladder.effectiveRung(farm);
  const lang = req.query.lang === 'sw' ? 'sw' : 'en';
  return ok(res, {
    // THE RUNG HE ACTUALLY STANDS ON, resolved at read time — never the raw stored
    // number, which would keep claiming a rung that nothing is paying for. A lapsed
    // paid period, an expired provisional rung and a paused farm all show up here.
    currentRung: eff.rung,
    storedRung: eff.stored,
    rungPaid: eff.paid,
    rungProvisional: eff.provisional,
    rungExpired: eff.expired,
    rungPaused: eff.paused,
    // The whole ladder, so the first farmer can SEE the start AND the upside.
    foundation: ladder.FOUNDATION.map((r) => ladder.landing(r.id, lang)),
    commercial: ladder.COMMERCIAL.map((r) => ({ ...ladder.landing(r.id, lang), layer: r.layer })),
    recommended: read.recommended,
    recommendation: ladder.landing(ladder.RUNGS[read.recommended]?.id, lang),
    gaps: read.gaps,
    reason: read.reason,
    staleness: stale,
    facts,
  });
}));

/** Accepting a rung is an explicit act. Nothing is ever charged silently.
 *
 *  FREE RUNGS (0-2) open on readiness alone — that is the distribution model.
 *
 *  PAID RUNGS (3-6) are bought with ZU (the doctrine, 2026-10-11: "no local
 *  currency to Farmline direct — just ZU for paid rungs"). The farmer's tap is
 *  the purchase; ZU is deducted for a 30-day period and the rung opens. When the
 *  period lapses the rung PAUSES — it never auto-bills, because the standing law
 *  is "nothing is ever charged silently", and because a farm that stops providing
 *  data should be downgraded rather than billed (ladder.staleness, already built).
 *
 *  ATOMICITY (the A5 lesson): the farm row is CLAIMED first with one
 *  findOneAndUpdate on the not-yet-paid state, the ZU is spent second, and the
 *  claim is rolled back if the balance will not cover it. A double-tap therefore
 *  cannot buy two periods, and a short balance cannot leave a phantom badge. */
api.post('/farm/:farmId/ladder/accept', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const id = String(req.body?.rung || '');
  const r = ladder.byId(id);
  if (!r) return bad(res, 400, 'unknown rung');

  const facts = await farmFacts(req.params.farmId);
  const read = ladder.readiness(facts);
  if (r.rung > read.recommended && !req.body?.force) {
    return res.status(409).json({
      ok: false,
      error: 'not ready for that rung yet',
      gaps: read.gaps.filter((g) => g.for === id),
    });
  }

  // ── THE FREE RUNGS ──────────────────────────────────────────────────────────
  if (r.free) {
    await Farm.updateOne({ _id: req.params.farmId }, { $set: { rung: r.rung, rungAcceptedAt: new Date() } });
    return ok(res, { rung: r.rung, name: r.name, free: true, zu: 0, paidUntil: null });
  }

  // ── THE PAID RUNGS — ZU buys the period ─────────────────────────────────────
  const priceZU = zu.priceForRung(id);
  if (!priceZU) return bad(res, 400, 'that rung has no ZU price yet');

  const until = new Date(Date.now() + zu.PERIOD_DAYS * 86400000);
  const alreadyPaid = await Farm.findOne({
    _id: req.params.farmId,
    rungPaidUntil: { $gt: new Date() },
  }).select('_id rungPaidUntil').lean();
  if (alreadyPaid) {
    return bad(res, 409, 'this rung is already open — it runs until your paid period ends');
  }

  // THE CLAIM: one atomic transition from "not paid" to "paid". Two taps race
  // here and only one wins.
  const claimed = await Farm.findOneAndUpdate(
    {
      _id: req.params.farmId,
      $or: [{ rungPaidUntil: null }, { rungPaidUntil: { $lte: new Date() } }],
    },
    { $set: { rung: r.rung, rungAcceptedAt: new Date(), rungPaidUntil: until } },
    { new: true },
  );
  if (!claimed) return bad(res, 409, 'this rung is already open — it runs until your paid period ends');

  const spent = await money.spend({
    farmId: req.params.farmId,
    amountZU: priceZU,
    ref: `rung-${id}`,
    note: `${r.name?.en || id} opened for ${zu.PERIOD_DAYS} days`,
  });
  if (!spent.ok) {
    // ROLL BACK the claim — an unaffordable tap must leave no trace at all.
    await Farm.updateOne(
      { _id: req.params.farmId },
      { $set: { rung: 0, rungPaidUntil: null } },
    );
    const pack = zu.packFor(spent.short || priceZU);
    return res.status(402).json({
      ok: false,
      error: `You need ${priceZU} ZU for this rung and have ${spent.have}. ${spent.short} ZU short.`,
      needed: priceZU,
      have: spent.have,
      short: spent.short,
      suggestedPack: { id: pack.id, name: pack.name, zu: pack.zu, usd: pack.usd },
    });
  }

  return ok(res, {
    rung: r.rung,
    name: r.name,
    free: false,
    zu: priceZU,
    balance: spent.balance,
    paidUntil: until,
  });
}));

// ══════════════════════════════════════════════════════════════════════════════
// ZU — FARMLINE'S OWN UNIT (the money doctrine, 2026-10-11)
// ══════════════════════════════════════════════════════════════════════════════
// Farmline sells ONE thing — ZU — and ZU unlocks the paid rungs. Money moves ONE
// WAY: the farmer pays US, claims it, and the operator confirms. There is no
// payment provider in the path, and no endpoint in this file touches anybody
// else's money. The authority is D:\TODOs\farmline-zu-doctrine-20261011.md.
//
// This block REPLACES the old two-mode money toggle (`/money` + `/money/mode`),
// which existed to switch a farm between a ZU ledger and an M-Pesa rail that
// asked a BUYER's phone to pay a FARMER. That rail is deleted — not disabled.

const shapeClaim = (c) => ({
  id: String(c._id),
  packId: c.packId || '',
  zu: c.zu,
  usd: c.usd,
  method: c.method || '',
  reference: c.reference || '',
  note: c.note || '',
  status: c.status,
  reason: c.reason || '',
  at: c.createdAt,
  decidedAt: c.decidedAt || null,
});

// THE FARMER'S ZU VIEW: balance, packs, rung prices, our collection details, and
// his own claims. This is the whole commercial surface of the product.
/**
 * THE DAY KEY for the allowance. It is a CALENDAR boundary in the founder's own
 * day (Africa/Nairobi), never a rolling 24 hours — a rolling window would let a
 * farmer collect twice within minutes by waiting for the clock to tick over.
 */
function zuDayKey(now = new Date()) {
  try {
    return new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Africa/Nairobi', year: 'numeric', month: '2-digit', day: '2-digit',
    }).format(now);
  } catch {
    return now.toISOString().slice(0, 10);
  }
}

/**
 * IS THIS FARM ACTUALLY WORKING? Distinct days with a REAL log in the last 30 —
 * the Farmline analogue of Zyppar's "creator" tier (3+ posts a month). Estimated
 * artifacts do not count here either: the allowance is a reward for showing up.
 */
async function isActiveFarm(farmId) {
  const { Types } = require('mongoose');
  const since = new Date(Date.now() - 30 * 86400000);
  const agg = await Log.aggregate([
    { $match: { farmId: new Types.ObjectId(String(farmId)), estimated: { $ne: true }, at: { $gte: since } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$at' } } } },
    { $count: 'days' },
  ]);
  return (agg[0]?.days || 0) >= zu.ACTIVE_LOGGING_DAYS;
}

api.get('/farm/:farmId/zu', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const farm = await Farm.findById(req.params.farmId).select('rung rungPaidUntil rungProvisionalUntil payTo').lean();
  const day = zuDayKey();
  const [balance, claims, movements, active, collectedToday] = await Promise.all([
    money.balance({ farmId: req.params.farmId }),
    ZuClaim.find({ farmId: req.params.farmId }).sort({ createdAt: -1 }).limit(20).lean(),
    money.history({ farmId: req.params.farmId, limit: 20 }),
    isActiveFarm(req.params.farmId),
    money.dailyClaimed({ farmId: req.params.farmId, day }),
  ]);
  // Resolve through the ladder so EVERY surface agrees: a lapsed paid period, an
  // expired provisional rung and a paused farm all read the same here as in /me.
  const eff = ladder.effectiveRung(await farmWithActivity(farm));
  const paidUntil = farm?.rungPaidUntil ? new Date(farm.rungPaidUntil) : null;
  const provUntil = farm?.rungProvisionalUntil ? new Date(farm.rungProvisionalUntil) : null;
  return ok(res, {
    balance,
    ...zu.publicShape(),
    rung: eff.rung,
    storedRung: eff.stored,
    paidUntil,
    paid: eff.paid,
    provisional: eff.provisional,
    provisionalUntil: provUntil,
    expired: eff.expired,
    paused: eff.paused,
    payTo: farm?.payTo || '',
    // THE REFILL: what today's allowance is worth to THIS farm and whether he has
    // taken it. One tap in the app; the unique index makes a double tap harmless.
    allowance: { amount: zu.dailyAllowanceFor(active), active, day, collectedToday },
    claims: claims.map(shapeClaim),
    movements,
  });
}));

// ── THE DAILY ALLOWANCE — THE REFILL (claimed, not minted silently) ───────────
// Ported from Zyppar's `claimTopUp()`: the farmer TAPS to collect, so he watches the
// balance grow and the habit is the product. One per farm per day, locked by a
// unique index rather than a check-then-write.
//
// IT IS CLAIMABLE EVEN WHILE THE COLLECTION DOOR IS CLOSED, and that is on purpose:
// before collection details are published a farmer would otherwise have NO route to
// ZU at all and the paid rungs would be unreachable by every path. This is the one
// door that is always open, and it is the honest alternative to a shortcut.
api.post('/farm/:farmId/zu/daily', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const day = zuDayKey();
  const active = await isActiveFarm(req.params.farmId);
  const amount = zu.dailyAllowanceFor(active);
  const r = await money.claimDaily({ farmId: req.params.farmId, amountZU: amount, day });
  if (r.ok) {
    return ok(res, { credited: r.credited, balance: r.balance, day, active, amount });
  }
  if (r.already) {
    // Idempotent, and honest about it rather than a silent second credit.
    return ok(res, { credited: 0, already: true, balance: r.balance, day, active, amount });
  }
  return bad(res, 400, r.error || 'the allowance could not be credited');
}));

// ALIAS — the app's older `/money` read keeps working, answered in ZU. Nothing
// in the app needs to break on the day the rail disappears.
api.get('/farm/:farmId/money', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const balance = await money.balance({ farmId: req.params.farmId });
  return ok(res, { mode: 'zu', balance, balances: { zu: balance }, ...zu.publicShape() });
}));

// THE CLAIM — the payer tells us he has paid. It credits NOTHING: a claim is a
// request to be checked, and only the operator's confirm turns it into money.
api.post('/farm/:farmId/zu/claim', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  if (!zu.collectionOpen()) {
    return bad(res, 503, 'the ZU door is not open yet — no collection details have been published');
  }
  const pack = zu.PACKS.find((p) => p.id === String(req.body?.packId || '').trim());
  const amount = pack ? pack.zu : Math.max(0, Math.floor(Number(req.body?.zu) || 0));
  if (!amount) return bad(res, 400, 'choose a pack');
  const reference = String(req.body?.reference || '').trim().slice(0, 80);
  if (!reference) return bad(res, 400, 'the reference from your payment is required — it is what we match on');
  const claim = await ZuClaim.create({
    farmId: req.params.farmId,
    memberId: req.auth.mid || null,
    packId: pack?.id || '',
    zu: amount,
    usd: zu.usdFor(amount),
    method: String(req.body?.method || '').slice(0, 60),
    reference,
    note: String(req.body?.note || '').slice(0, 400),
  });
  return ok(res, {
    claim: shapeClaim(claim),
    note: 'Your claim is filed. ZU is credited once it has been checked against our account.',
  });
}));

// ── THE OPERATOR'S DOOR (admin key). Confirming is the ONLY thing that credits.
api.get('/zu/claims', wrap(async (req, res) => {
  // HEADER ONLY, and that is a security decision, not a style one (the N1 class, the
  // audit's 2026-10-10 finding): a key in a QUERY STRING lands in nginx's access log
  // verbatim. The M-Pesa callback that made N1 famous is deleted, so this was the last
  // URL that could carry a farmline secret — and now it cannot. A caller arriving with
  // ?key=… is told to use the header rather than silently accepted.
  const gate = config.checkAdminKey(String(req.headers['x-admin-key'] || ''));
  if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error });
  const wanted = String(req.query?.status || 'claimed');
  const status = ['claimed', 'confirmed', 'rejected'].includes(wanted) ? wanted : 'claimed';
  const claims = await ZuClaim.find({ status }).sort({ createdAt: 1 }).limit(100).lean();
  return ok(res, { status, claims: claims.map(shapeClaim) });
}));

api.post('/zu/claims/:id/confirm', wrap(async (req, res) => {
  const gate = config.checkAdminKey(String(req.headers['x-admin-key'] || req.body?.key || ''));
  if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error });

  // DECIDE FIRST, atomically: `status: 'claimed'` in the filter means an operator's
  // double-tap can never credit twice (the A5 lesson — a check-then-write alone
  // can be won twice).
  const claim = await ZuClaim.findOneAndUpdate(
    { _id: req.params.id, status: 'claimed' },
    { $set: { status: 'confirmed', decidedBy: 'operator', decidedAt: new Date() } },
    { new: true },
  );
  if (!claim) return bad(res, 409, 'that claim is not open (already decided, or unknown)');

  const credited = await money.award({
    farmId: claim.farmId,
    amountZU: claim.zu,
    ref: claim.reference,
    note: `ZU ${claim.zu} credited (${claim.packId || 'custom'})`,
  });
  if (!credited.ok) {
    // Roll the decision back so the operator can retry. A claim marked confirmed
    // that credited nothing would be a lie in the books.
    await ZuClaim.updateOne(
      { _id: claim._id },
      { $set: { status: 'claimed', decidedBy: '', decidedAt: null } },
    );
    return bad(res, 500, credited.error || 'the credit failed');
  }
  return ok(res, { balance: credited.balance });
}));

api.post('/zu/claims/:id/reject', wrap(async (req, res) => {
  const gate = config.checkAdminKey(String(req.headers['x-admin-key'] || req.body?.key || ''));
  if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error });
  const claim = await ZuClaim.findOneAndUpdate(
    { _id: req.params.id, status: 'claimed' },
    {
      $set: {
        status: 'rejected', decidedBy: 'operator', decidedAt: new Date(),
        reason: String(req.body?.reason || '').slice(0, 200),
      },
    },
    { new: true },
  );
  if (!claim) return bad(res, 409, 'that claim is not open (already decided, or unknown)');
  return ok(res, { ok: true });
}));

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC SHOP — open by design. A farm's link must work from a cold browser;
// that is the entire distribution mechanism.
// ──────────────────────────────────────────────────────────────────────────────

// ── the buyer's single order, PUBLIC ─────────────────────────────────────────
// §1.6: the customer face is open by design — a link must work from a cold
// browser. Until now the order page only worked when checkout handed it the
// order object in memory; a refresh (or a forwarded link) showed an empty
// state. This serves the buyer's OWN order fields only, scoped by the farm
// slug, so the cold link works and nothing else leaks.
api.get('/shop/:slug/order/:id', wrap(async (req, res) => {
  const farm = await Farm.findOne({ slug: req.params.slug }).select('_id').lean();
  if (!farm) return bad(res, 404, 'no such farm');
  const order = await Order.findOne({ _id: req.params.id, farmId: farm._id }).lean();
  if (!order) return bad(res, 404, 'no such order');
  return ok(res, {
    order: {
      id: String(order._id), ref: order.ref, stage: order.stage,
      lines: order.lines, subtotal: order.subtotal, deliveryFee: order.deliveryFee,
      total: order.total, how: order.how, slot: order.slot,
      // B9 (the founder's ruling): addr is DROPPED from the public read — this
      // link is handed out and lives forever; the buyer sees their own address in
      // their session (the 201 response), not on a shareable URL. The signed-URL
      // alternative was judged overkill for now.
      createdAt: order.createdAt,
    },
  });
}));

api.get('/shop/:slug', wrap(async (req, res) => {
  const farm = await Farm.findOne({ slug: req.params.slug }).lean();
  if (!farm) return bad(res, 404, 'no such farm');
  const lang = req.query.lang === 'sw' ? 'sw' : 'en';
  const [availability, records] = await Promise.all([
    projection.buildAvailability(farm._id, { lang }),
    // ROUND A — the buyer's guide: the readable records (numbers only; the app
    // renders the sentences). Built inside projection.js, the security boundary.
    projection.buyerRecords(farm._id, { lang }),
  ]);
  return ok(res, {
    farm: projection.publicFarm(farm),   // ALLOWLIST ONLY — carries the farmer's own payTo words
    availability,
    records,
    // NO `moneyMode` (2026-10-11): there is no rail for Farmline to name. What the
    // buyer actually needs is the FARMER's own payment instruction, which rides
    // `farm.payTo` out of the allowlist — text the farmer wrote, shown as text,
    // never read by our code to initiate or verify anything.
  });
}));

// ── THE ENQUIRE DOOR IS GONE (the founder's audit ruling, 2026-10-08: "iii-A").
// It answered {received:true} while storing nothing and telling nobody — a door
// that lied. The REAL chat (POST /conversations) is the contact path: every
// message persists, the farmer sees it, the thread is the record.

/**
 * ORDER.
 * Prices are ALWAYS taken from the farm's own Sellables server-side. A client
 * price is never trusted — that is the one rule that must not bend in a shop.
 */
api.post('/shop/:slug/order', auth.requireAuth('customer', 'farmer'), wrap(async (req, res) => {
  const farm = await Farm.findOne({ slug: req.params.slug });
  if (!farm) return bad(res, 404, 'no such farm');

  const wanted = Array.isArray(req.body?.lines) ? req.body.lines : [];
  if (!wanted.length) return bad(res, 400, 'no items in the order');

  const availability = await projection.buildAvailability(farm._id, { lang: 'en' });
  const lines = [];
  for (const w of wanted) {
    const item = availability.find((a) => a.product === w.product);
    if (!item) return bad(res, 400, `unknown item: ${w.product}`);
    if (item.suppressed) return bad(res, 409, `${item.label} is not available to sell right now (${item.reason || 'held'})`);
    const qty = Math.max(1, Number(w.qty) || 1);
    if (qty > item.qty) return bad(res, 409, `only ${item.qty} ${item.unit} of ${item.label} available`);
    lines.push({ product: item.product, label: item.label, unit: item.unit, qty, price: item.price, sum: item.price * qty });
  }

  const subtotal = lines.reduce((a, l) => a + l.sum, 0);
  const how = req.body?.how === 'delivery' ? 'delivery' : 'pickup';
  const fee = how === 'delivery' ? Number(farm.terms?.deliveryFee || 0) : 0;
  const total = subtotal + fee;

  // B8: the ref is the buyer's receipt on an M-Pesa SMS — human-readable stays —
  // but 5 random chars (~60M of space) behind a global unique index with no retry
  // surfaced a duplicate key as a 500 mid-checkout with money already in flight.
  // 8 hex chars from crypto (~4 billion) + a small retry loop on E11000.
  let order = null;
  for (let attempt = 0; attempt < 4 && !order; attempt++) {
    try {
      order = await Order.create({
        farmId: farm._id,
        customerId: req.auth.typ === 'customer' ? req.auth.sub : null,
        ref: 'FL-' + require('crypto').randomBytes(4).toString('hex').toUpperCase(),
        lines, subtotal, deliveryFee: fee, total, how,
        slot: String(req.body?.slot || '').slice(0, 80),
        addr: String(req.body?.addr || '').slice(0, 200),
        note: String(req.body?.note || '').slice(0, 300),
        stage: 1,
        stageHistory: [{ stage: 1, at: new Date() }],
        // THE FARMER'S OWN CLAIM (2026-10-11). Farmline runs no rail between this
        // buyer and this farmer, so Farmline does not assert whether money moved.
        // 'direct' means: the buyer settles on the farmer's own terms, published
        // as the farmer's own payTo words. `stage` (0..5) is the operational truth.
        payment: { mode: 'direct', status: 'unpaid' },
      });
    } catch (e) {
      if (e?.code !== 11000) throw e;   // a real failure is not a collision
    }
  }
  if (!order) return bad(res, 500, 'the order reference collided four times — please try again');

  // THE `pay` DOOR IS GONE (2026-10-11). It used to hand the buyer's phone number
  // to our M-Pesa rail and ask their phone to pay the FARMER. Farmline is not
  // between them, so there is nothing here to attempt: a `pay: true` in the body
  // is now simply ignored, and the buyer is told to settle on the farmer's terms.
  // Nothing is written to the ledger — no ZU moves for a farmer↔buyer settlement.

  return res.status(201).json({
    ok: true,
    order,
    // NO payment object from a rail. What the buyer needs is the FARMER's own
    // instruction; it rides the farm allowlist as `payTo`, and it is text.
    payment: null,
    payTo: String(farm.payTo || ''),
    farm: { name: farm.name, slug: farm.slug },
  });
}));

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN / META
// ──────────────────────────────────────────────────────────────────────────────
api.get('/meta/protocols', (_req, res) => ok(res, {
  species: protocols.speciesList(),
  counts: Object.fromEntries(protocols.speciesList().map((s) => [s, protocols.forSpecies(s).length])),
}));

api.get('/meta/ladder', (req, res) => {
  const lang = req.query.lang === 'sw' ? 'sw' : 'en';
  return ok(res, {
    foundation: ladder.FOUNDATION.map((r) => ladder.landing(r.id, lang)),
    commercial: ladder.COMMERCIAL.map((r) => ({ ...ladder.landing(r.id, lang), layer: r.layer })),
  });
});

api.get('/admin/farms', wrap(async (req, res) => {
  // B11: the admin key rides the x-admin-key HEADER (query strings land in nginx
  // access logs, browser history and Referer); the query form still works for one
  // release for anything already calling it, then deprecates.
  const gate = config.checkAdminKey(String(req.headers['x-admin-key'] || req.query?.key || ''));
  if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error });
  const farms = await Farm.find().sort({ createdAt: -1 }).limit(100).lean();
  // B12: two aggregations instead of 200 count queries — the admin surface was
  // N+1 (2 counts per farm × 100 farms) and would time out as data grows.
  const ids = farms.map((f) => f._id);
  const [logAgg, orderAgg] = await Promise.all([
    Log.aggregate([{ $match: { farmId: { $in: ids } } }, { $group: { _id: '$farmId', n: { $sum: 1 } } }]),
    Order.aggregate([{ $match: { farmId: { $in: ids } } }, { $group: { _id: '$farmId', n: { $sum: 1 } } }]),
  ]);
  const logBy = new Map(logAgg.map((r) => [String(r._id), r.n]));
  const orderBy = new Map(orderAgg.map((r) => [String(r._id), r.n]));
  const withCounts = farms.map((f) => ({
    id: f._id, name: f.name, slug: f.slug, rung: f.rung,
    // THE OPERATOR'S VIEW OF THE MONEY (2026-10-11): no rail, no mode. What an
    // operator actually needs to see is whether a farm is PAID up, and until when.
    paid: !!(f.rungPaidUntil && new Date(f.rungPaidUntil).getTime() > Date.now()),
    rungPaidUntil: f.rungPaidUntil || null,
    logs: logBy.get(String(f._id)) || 0,
    orders: orderBy.get(String(f._id)) || 0,
    createdAt: f.createdAt,
  }));
  return ok(res, { farms: withCounts, count: withCounts.length, authArmed: auth.authArmed });
}));

// Re-export the vocab so a reviewer can see the enforced vocabulary from the API.
api.get('/meta/vocab', (_req, res) => ok(res, { terms: vocab.TERMS, banned: vocab.BANNED }));

// THE DEMO VISION SPEND, exposed (Task 3): the day's demo-farm model calls, the
// threshold they alarm at, and the moment of the read. PUBLIC — the zyppar
// Farmline Wire prober polls it without a farmline principal; the number is a
// counter, not farm data.
api.get('/meta/vision-spend', async (_req, res) => {
  let today = 0;
  try { today = await metacounter.count('vision-demo'); } catch { today = 0; }
  return ok(res, { today, threshold: config.visionDemoThreshold, at: new Date().toISOString() });
});

app.use(config.apiPrefix, api);

// ══════════════════════════════════════════════════════════════════════════════
// NO FRONTEND HERE. THIS PROCESS IS THE API ONLY.
// ──────────────────────────────────────────────────────────────────────────────
// Until build 8 this process also served the frontend: one hand-written HTML file
// from public/. The Angular rewrite (farmline-app) moved the frontend to its own
// repo and its own static build, which nginx serves from /var/www/farmline — the
// LoopKeeper shape.
//
// So the static handler, the SPA deeplink routes and public/ are GONE. Keeping them
// would have been worse than dead code: two frontends on one URL, and whichever one
// won would depend on whether nginx was in front. On the droplet nginx would win; on
// a direct :4600 hit THIS would win, and `yarn dev` would open a vanilla app that no
// longer reflects the product. That is exactly the clash this removal prevents.
//
// The app lives at http://localhost:4700 in dev (see farmline-app), and at
// https://zyppar.com/farmline/ behind nginx.
//
// A root hit here is a human looking for the app, so say where it is rather than
// returning a bare 404.
app.get('/', (_req, res) => res.json({
  ok: true,
  service: 'farmline API',
  api: config.apiPrefix,
  appDev: 'http://localhost:4700/',
  appProd: `${config.publicUrl}${config.basePath}/`,
  note: 'This process serves the API only. The app is a separate static build (farmline-app).',
}));

app.use((req, res) => res.status(404).json({ ok: false, error: 'no such route', path: req.originalUrl }));

// B13: body-parser errors answered in the app's own shape, not Express's HTML
// page (the client's err.error.error read was receiving HTML). A malformed body
// is a 400 with a sentence; an oversized one is a 413.
app.use((err, req, res, next) => {
  if (err?.type === 'entity.too.large') return res.status(413).json({ ok: false, error: 'the request body is too large' });
  if (err instanceof SyntaxError || err?.status === 400 || err?.statusCode === 400) {
    return res.status(400).json({ ok: false, error: 'the request body could not be read' });
  }
  return next(err);
});

// ── boot ──────────────────────────────────────────────────────────────────────
// http.createServer rather than app.listen, because socket.io needs to share the
// same port as the API: one port, one origin, one TLS certificate, no second
// nginx upstream. The chat path is namespaced (/socket-farmline/) so it cannot
// collide with Zyppar's /socket.io or LoopKeeper's /socket-rolodex/ on this host.
const http = require('http');
const server = http.createServer(app);
const io = chat.attach(server);

// Fix the legacy offline-idempotency indexes BEFORE accepting traffic. The old
// `sparse` index treated a null clientId as a duplicate, so the second "mark done" of
// the day answered 500. MongoDB cannot change an index in place, so the wrong one has
// to be dropped first — and mongoose rebuilds it correctly on connect.
const { migrateLegacyIndexes } = require('./models');

server.listen(config.port, () => {
  console.log(`farmline server on :${config.port}  (app at ${config.basePath}/, api at ${config.apiPrefix}/)`);
  // THE BOOT LINE (2026-10-11): it no longer reports a money mode or an M-Pesa
  // rail, because there is neither. It reports the ONE money fact a monitor wants:
  // whether the ZU door is open (collection details published) — without them no
  // farmer can credit an account, and the paid rungs cannot be bought.
  console.log(`  dbName=${config.dbName}  auth=${auth.authArmed ? 'ARMED' : 'OPEN (set AUTH_SECRET)'}  zu=${zu.collectionOpen() ? 'door open' : 'CLOSED (set FARMLINE_ZU_COLLECTION)'}  unit=${zu.ZU_PER_USD} ZU/USD`);
  console.log(`  chat=${io ? 'socket.io at /socket-farmline/ (+ REST)' : 'REST only (socket.io not installed)'}  env=${config.envName}`);
  migrateLegacyIndexes().catch((e) => console.warn('[farmline] index migration error:', e.message));
});

  // ── 2026-10-08 THE BOOT-SEED (the founder: 'feeding the demo via a script
  // after deployment' — retired): the Kimani Farms demo self-seeds at boot,
  // fire-and-forget, idempotent (an existing demo farm is replaced whole).
  // No post-deploy hands, no manual script, no nginx. The demo data is
  // fictional and re-seedable by design.
  setTimeout(() => {
    // THE ISOLATION (the crash-loop lesson): the seed script calls its own
    // process.exit(0) — require()ing it here killed the server (122 pm2
    // restarts). As a CHILD PROCESS its exit is its own; the server lives.
    const { spawn } = require('child_process');
    // 2026-10-09 THE COLLAPSE AUDIT: cwd: __dirname is src/ — the seed resolves
  // src/scripts/seed-demo-farm.cjs, which does not exist (the seed lives in
  // scripts/), so the child crashed on EVERY boot ('[demo-seed] finished,
  // code 1') and the demo never re-seeded on boot. The repo root is the cwd.
  const child = spawn(process.execPath, ['scripts/seed-demo-farm.cjs'], { cwd: require('path').join(__dirname, '..'), stdio: 'inherit' });
    child.on('exit', (code) => console.log('[demo-seed] finished, code', code));
  }, 2500);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (io) io.close();
    server.close(() => { conn.close().finally(() => process.exit(0)); });
  });
}

module.exports = app;
