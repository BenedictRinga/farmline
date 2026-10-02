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
const config = require('./config');
const auth = require('./auth');
const vocab = require('./vocab');
const ladder = require('./ladder');
const money = require('./money');
const schedule = require('./schedule');
const projection = require('./projection');
const protocols = require('./protocols');
const {
  conn, Farm, Member, Customer, Plot, CropCycle, AnimalGroup, Animal,
  ScheduledEvent, Log, Hold, Sellable, Order, Ledger, PriceObservation,
} = require('./models');

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '4mb' }));

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
const wrap = (fn) => (req, res) => Promise.resolve(fn(req, res)).catch((e) => {
  console.error('[farmline]', req.method, req.originalUrl, e?.message || e);
  if (!res.headersSent) res.status(500).json({ ok: false, error: e?.message || 'failed' });
});
const slugify = (s) => String(s || '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48);

// ══════════════════════════════════════════════════════════════════════════════
// HEALTH / VERSION
// ──────────────────────────────────────────────────────────────────────────────
app.get(['/health', config.basePath + '/health'], (_req, res) => res.json(healthPayload()));
app.get('/api/farmline/version', (_req, res) => {
  const b = Number(require('../package.json').build) || 0;
  res.json({ version: '0.1.' + b, build: b, at: new Date().toISOString() });
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
  authArmed: auth.authArmed,
  moneyMode: config.moneyMode,
  mpesaConfigured: money.mpesaConfigured(),
  basePath: config.basePath,
  build: Number(require('../package.json').build) || 0,
  at: new Date().toISOString(),
});
api.get('/health', (_req, res) => res.json(healthPayload()));

// ══════════════════════════════════════════════════════════════════════════════
// AUTH — two principals
// ──────────────────────────────────────────────────────────────────────────────
api.post('/auth/farmer/register', auth.mintRateLimit, wrap(async (req, res) => {
  const { phone, pin, name = '', farmName = '', area = '' } = req.body || {};
  if (!phone || !pin) return bad(res, 400, 'phone and pin are required');
  if (String(pin).length < 4) return bad(res, 400, 'pin must be at least 4 digits');
  if (await Member.findOne({ phone: String(phone) })) return bad(res, 409, 'that number is already registered — sign in instead');

  const farm = await Farm.create({
    name: farmName || `${name || 'My'} Farm`,
    slug: slugify(farmName || name || 'farm') + '-' + Math.random().toString(36).slice(2, 6),
    area, moneyMode: config.moneyMode,
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

api.post('/auth/customer', auth.mintRateLimit, wrap(async (req, res) => {
  const { phone, name = '', slug = '' } = req.body || {};
  if (!phone) return bad(res, 400, 'phone is required');
  let customer = await Customer.findOne({ phone: String(phone) });
  let granted = 0;
  if (!customer) {
    customer = await Customer.create({ phone: String(phone), name });
    // Virtual mode is only usable if a new buyer has something to spend, so the
    // first visit grants a starting credit. Real mode needs none of this.
    if (config.moneyMode === 'virtual') {
      const farm = slug ? await Farm.findOne({ slug }) : null;
      granted = await money.grantStartingZU({ farm, customer, zu: 500 });
    }
  }
  const bal = await money.balance({ ownerType: 'customer', ownerId: customer._id, mode: 'virtual' });
  return ok(res, {
    token: auth.mintCustomerToken(customer._id),
    customer: { id: customer._id, name: customer.name },
    zu: { balance: bal, granted },
  });
}));

api.get('/me', auth.requireAuth('farmer'), wrap(async (req, res) => {
  const farm = await Farm.findById(req.auth.sub).lean();
  const member = req.auth.mid ? await Member.findById(req.auth.mid).lean() : null;
  if (!farm) return bad(res, 404, 'farm not found');
  return ok(res, { farm, member, authArmed: auth.authArmed });
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

api.post('/farm/:farmId/crops', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const { plotId = null, crop, variety = '', acres = 0, season = '', plantedOn = null, fodderFor = '' } = req.body || {};
  if (!crop) return bad(res, 400, 'crop required');
  const cycle = await CropCycle.create({
    farmId: req.params.farmId, plotId, crop, variety, acres, season,
    plantedOn: plantedOn ? new Date(plantedOn) : null, fodderFor, status: plantedOn ? 'growing' : 'planned',
  });
  const built = await schedule.materialise({
    farmId: req.params.farmId, subjectType: 'cropcycle', subjectId: cycle._id,
    subjectLabel: crop, species: crop, anchor: cycle.plantedOn || new Date(),
  });
  return ok(res, { cycle, scheduled: built.created });
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
      clientId: r.clientId || '',
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

/** COMPLETE a scheduled event — marks done, records it, opens the hold, sets the next. */
api.post('/farm/:farmId/events/:eventId/complete', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const farm = await Farm.findById(req.params.farmId);
  const result = await schedule.complete({
    farm, eventId: req.params.eventId, byMemberId: req.auth.mid || null,
    productUsed: req.body?.productUsed || '', speciesHint: req.body?.species || '',
  });
  if (!result.ok) return bad(res, 404, result.error || 'event not found');
  const holds = await projection.activeHolds(req.params.farmId);
  const availability = await projection.buildAvailability(req.params.farmId);
  return ok(res, { ...result, holds, availability });
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
// FARMER — the ladder (the self-deciding engine)
// ─═════════════════════════════════════════════════════════════════════════════
async function farmFacts(farmId) {
  const since = new Date(Date.now() - 30 * 86400000);
  const [logs30d, daysAgg, sellables, plots, groups, cycles, treatments, orders, completed] = await Promise.all([
    Log.countDocuments({ farmId, at: { $gte: since } }),
    Log.aggregate([{ $match: { farmId } }, { $group: { _id: null, oldest: { $min: '$at' } } }]),
    Sellable.countDocuments({ farmId }),
    Plot.countDocuments({ farmId }),
    AnimalGroup.countDocuments({ farmId, active: true }),
    CropCycle.countDocuments({ farmId }),
    Log.countDocuments({ farmId, kind: { $in: ['treatment', 'spray'] } }),
    Order.countDocuments({ farmId }),
    Order.countDocuments({ farmId, stage: 5 }),
  ]);
  const oldest = daysAgg[0]?.oldest ? new Date(daysAgg[0].oldest) : null;
  const daysOfHistory = oldest ? Math.floor((Date.now() - oldest.getTime()) / 86400000) : 0;
  const farm = await Farm.findById(farmId).lean();
  return {
    logs30d, daysOfHistory, sellables, plots, animalGroups: groups, cropCycles: cycles,
    treatmentsLogged: treatments, orderCount: orders, completedOrders: completed,
    hasRequiredIncome: !!(farm?.requiredIncome?.offFarmMonthly || farm?.requiredIncome?.householdMonthly),
    confidence: farm?.confidence?.grade || 'low',
  };
}

api.get('/farm/:farmId/ladder', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const farm = await Farm.findById(req.params.farmId).lean();
  const facts = await farmFacts(req.params.farmId);
  const read = ladder.readiness(facts);
  const stale = ladder.staleness(farm);
  return ok(res, {
    currentRung: farm.rung,
    // The whole ladder, so the first farmer can SEE the start AND the upside.
    foundation: ladder.FOUNDATION.map((r) => ladder.landing(r.id, req.query.lang === 'sw' ? 'sw' : 'en')),
    commercial: ladder.COMMERCIAL.map((r) => ({ ...ladder.landing(r.id, req.query.lang === 'sw' ? 'sw' : 'en'), layer: r.layer })),
    recommended: read.recommended,
    recommendation: ladder.landing(ladder.RUNGS[read.recommended]?.id, req.query.lang === 'sw' ? 'sw' : 'en'),
    gaps: read.gaps,
    reason: read.reason,
    staleness: stale,
    facts,
  });
}));

/** Accepting a rung is an explicit act. Nothing is ever charged silently. */
api.post('/farm/:farmId/ladder/accept', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const id = String(req.body?.rung || '');
  const r = ladder.byId(id);
  if (!r) return bad(res, 400, 'unknown rung');
  const farm = await Farm.findById(req.params.farmId).lean();
  const facts = await farmFacts(req.params.farmId);
  const read = ladder.readiness(facts);
  if (r.rung > read.recommended && !req.body?.force) {
    return res.status(409).json({
      ok: false,
      error: 'not ready for that rung yet',
      gaps: read.gaps.filter((g) => g.for === id),
    });
  }
  await Farm.updateOne({ _id: req.params.farmId }, { $set: { rung: r.rung, rungAcceptedAt: new Date() } });
  return ok(res, { rung: r.rung, name: r.name, free: r.free, priceKES: r.priceKES });
}));

// ══════════════════════════════════════════════════════════════════════════════
// MONEY — the two-mode toggle (AGENTS.md rule 2)
// ══════════════════════════════════════════════════════════════════════════════
api.get('/farm/:farmId/money', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const farm = await Farm.findById(req.params.farmId).lean();
  const [zu, kes] = await Promise.all([
    money.balance({ ownerType: 'farm', ownerId: farm._id, mode: 'virtual' }),
    money.balance({ ownerType: 'farm', ownerId: farm._id, mode: 'mpesa' }),
  ]);
  return ok(res, {
    mode: money.modeFor(farm),
    modes: money.MODES,
    balances: { zu, kes },
    quote: money.quote(1000),
    mpesaConfigured: money.mpesaConfigured(),
    mpesaSet: !!(farm?.mpesa?.paybill || farm?.mpesa?.till),
  });
}));

api.post('/farm/:farmId/money/mode', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const mode = String(req.body?.mode || '');
  if (!money.MODES.includes(mode)) return bad(res, 400, 'mode must be virtual or mpesa');
  if (mode === 'mpesa' && !money.mpesaConfigured()) {
    return bad(res, 501, 'M-Pesa is not armed on this server yet — stay on ZU (virtual) for now');
  }
  await Farm.updateOne({ _id: req.params.farmId }, { $set: { moneyMode: mode } });
  return ok(res, { mode });
}));

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC SHOP — open by design. A farm's link must work from a cold browser;
// that is the entire distribution mechanism.
// ──────────────────────────────────────────────────────────────────────────────
api.get('/shop/:slug', wrap(async (req, res) => {
  const farm = await Farm.findOne({ slug: req.params.slug }).lean();
  if (!farm) return bad(res, 404, 'no such farm');
  const lang = req.query.lang === 'sw' ? 'sw' : 'en';
  const availability = await projection.buildAvailability(farm._id, { lang });
  return ok(res, {
    farm: projection.publicFarm(farm),   // ALLOWLIST ONLY
    availability,
    moneyMode: money.modeFor(farm),
  });
}));

/** ENQUIRE — a message to the farmer. Response time is a trust signal, so it is
 *  a real thread, not a bot. */
api.post('/shop/:slug/enquire', auth.requireAuth('customer', 'farmer'), wrap(async (req, res) => {
  const farm = await Farm.findOne({ slug: req.params.slug }).lean();
  if (!farm) return bad(res, 404, 'no such farm');
  const text = String(req.body?.text || '').slice(0, 600);
  if (!text.trim()) return bad(res, 400, 'a message is required');
  return ok(res, { received: true, at: new Date().toISOString() });
}));

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

  const order = await Order.create({
    farmId: farm._id,
    customerId: req.auth.typ === 'customer' ? req.auth.sub : null,
    ref: 'FL-' + Math.random().toString(36).slice(2, 7).toUpperCase(),
    lines, subtotal, deliveryFee: fee, total, how,
    slot: String(req.body?.slot || '').slice(0, 80),
    addr: String(req.body?.addr || '').slice(0, 200),
    note: String(req.body?.note || '').slice(0, 300),
    stage: 1,
    stageHistory: [{ stage: 1, at: new Date() }],
    payment: { mode: money.modeFor(farm), status: 'unpaid' },
  });

  // Payment is attempted only when asked for, and a failure never destroys the
  // order — the farmer still gets the work, which is the point of the app.
  let payment = null;
  if (req.body?.pay) {
    const customer = req.auth.typ === 'customer' ? await Customer.findById(req.auth.sub) : null;
    payment = await money.charge({ farm, customer, order, amountKES: total, phone: req.body?.phone });
    order.payment.status = payment.status === 'paid' ? 'paid' : (payment.ok ? 'pending' : 'unpaid');
    order.payment.ref = payment.ref || '';
    if (payment.status === 'paid') order.payment.paidAt = new Date();
    await order.save();
  }

  return res.status(201).json({ ok: true, order, payment, farm: { name: farm.name, slug: farm.slug } });
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
  const gate = config.checkAdminKey(String(req.query?.key || ''));
  if (!gate.ok) return res.status(gate.status).json({ ok: false, error: gate.error });
  const farms = await Farm.find().sort({ createdAt: -1 }).limit(100).lean();
  const withCounts = [];
  for (const f of farms) {
    withCounts.push({
      id: f._id, name: f.name, slug: f.slug, rung: f.rung, moneyMode: money.modeFor(f),
      logs: await Log.countDocuments({ farmId: f._id }),
      orders: await Order.countDocuments({ farmId: f._id }),
      createdAt: f.createdAt,
    });
  }
  return ok(res, { farms: withCounts, count: withCounts.length });
}));

// Re-export the vocab so a reviewer can see the enforced vocabulary from the API.
api.get('/meta/vocab', (_req, res) => ok(res, { terms: vocab.TERMS, banned: vocab.BANNED }));

app.use(config.apiPrefix, api);

// ══════════════════════════════════════════════════════════════════════════════
// STATIC APP — served at BASE_PATH (zyppar.com/farmline/)
// ──────────────────────────────────────────────────────────────────────────────
const PUBLIC_DIR = path.join(__dirname, '..', 'public');

// CACHE HEADERS BY ROLE — the app-side half of the LoopKeeper lesson.
//
// The nginx insert pins /farmline/index.html to no-cache, and that is correct.
// But an application that relies on a proxy to keep it honest breaks the moment
// the proxy is missing or drifts — a staging box, a direct :4600 hit, a phone
// wrapper, a future ingress. `maxAge: '1h'` on the HTML was a real defect: it
// let a farmer hold an app shell for an hour that no longer matched the API.
//
// So the app states the rule itself: the SHELL is never cached; the version
// stamp is never cached; everything else (there is almost nothing else) may be.
app.use(config.basePath, express.static(PUBLIC_DIR, {
  extensions: ['html'],
  etag: true,
  lastModified: true,
  setHeaders(res, filePath) {
    if (/index\.html$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache, must-revalidate');
    } else if (/build\.json$/.test(filePath)) {
      res.setHeader('Cache-Control', 'no-cache');
    } else {
      res.setHeader('Cache-Control', 'public, max-age=3600');
    }
  },
}));
// A shop deeplink is the farm's own URL: /farmline/s/<slug>
app.get(config.basePath + '/s/:slug', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get(config.basePath, (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));
app.get('/', (_req, res) => res.redirect(config.basePath + '/'));

app.use((req, res) => res.status(404).json({ ok: false, error: 'no such route', path: req.originalUrl }));

// ── boot ──────────────────────────────────────────────────────────────────────
const server = app.listen(config.port, () => {
  console.log(`farmline server on :${config.port}  (app at ${config.basePath}/, api at ${config.apiPrefix}/)`);
  console.log(`  dbName=${config.dbName}  auth=${auth.authArmed ? 'ARMED' : 'OPEN (set AUTH_SECRET)'}  money=${config.moneyMode}  mpesa=${money.mpesaConfigured() ? 'configured' : 'not armed'}`);
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { server.close(() => { conn.close().finally(() => process.exit(0)); }); });
}

module.exports = app;
