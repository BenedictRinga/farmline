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
const mpesa = require('./mpesa');
const chat = require('./chat');
const updates = require('./updates');
const schedule = require('./schedule');
const projection = require('./projection');
const reversal = require('./reversal');
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
app.get(['/health', config.basePath + '/health'], (_req, res) => res.json(healthPayload()));
app.get('/api/farmline/version', (_req, res) => {
  const b = Number(require('../package.json').build) || 0;
  res.json({
    version: '0.1.' + b,
    build: b,
    // A2 tranche 4 — THE UPDATES SERVICE: the founder's beta floor rides beside
    // the build, so one boot check answers both questions at once.
    latestBuild: updates.serverBuild(),
    mandatoryBuild: updates.mandatoryFloor(),
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
app.get('/api/farmline/updates/check', (req, res) => {
  res.set(updates.UPDATE_CHECK_HEADERS);
  res.json(updates.getUpdateStatus(req.query.clientBuild));
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

// ── THE FARM'S FACE — one photograph, persisted on the farm document ─────────
// A photograph makes a stranger's place real (the trust layer). The client
// downsizes before upload (max 640px JPEG, tens of KB); the cap here is a guard,
// not the resizing strategy. `/me` returns the farm doc, so the photo rides to
// the app on every boot — no extra fetch, nothing to go stale.
api.post('/farm/:farmId/photo', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
  const { photo } = req.body || {};
  if (typeof photo !== 'string' || !/^data:image\/(jpeg|png);base64,/.test(photo)) {
    return bad(res, 400, 'photo must be a base64 JPEG or PNG data URL');
  }
  if (photo.length > 300000) return bad(res, 413, 'photo too large — resize before upload');
  await Farm.updateOne({ _id: req.params.farmId }, { $set: { photo } });
  return ok(res, { saved: true });
}));

api.delete('/farm/:farmId/photo', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {
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

  const [farmDoc, plots, cycles, groups, animals, openEvents, holds] = await Promise.all([
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
    ScheduledEvent.find({ farmId, status: { $in: ['due', 'carried'] } })
      .select('subjectType subjectId subjectLabel intervention dueOn baseline withdrawal')
      .lean(),
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
  const cropsByPlot = new Map();
  const unplaced = [];
  for (const c of cycles) {
    const shaped = {
      _id: c._id, crop: c.crop, variety: c.variety, acres: c.acres, season: c.season,
      status: c.status, plantedOn: c.plantedOn, expectedHarvest: c.expectedHarvest,
      fodderFor: c.fodderFor || '',
      daysGrowing: c.plantedOn ? Math.max(0, Math.round((now - new Date(c.plantedOn)) / 86400000)) : null,
      harvested: c.yield && c.yield.quantity
        ? { quantity: c.yield.quantity, unit: c.yield.unit, on: c.yield.harvestedOn } : null,
      next: shapeNext(c._id),
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
// CHAT — farmer ↔ buyer (src/chat.js). Real-time over socket.io, and ALWAYS
// available over REST so a phone that lost its socket can still read and send.
// ══════════════════════════════════════════════════════════════════════════════

/** Open (or continue) the thread with a farm. Customer-initiated, from the shop. */
api.post('/conversations', auth.requireAuth('customer'), wrap(async (req, res) => {
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
// M-PESA CALLBACK — Safaricom posts here. NOT under /api/farmline auth: Daraja has
// no bearer token, and the only thing that protects this route is that it can only
// settle a pending entry whose CheckoutRequestID it already knows.
// ══════════════════════════════════════════════════════════════════════════════
api.post('/mpesa/callback', wrap(async (req, res) => {
  const parsed = mpesa.parseCallback(req.body);
  if (!parsed.checkoutRequestId) return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

  const out = await money.settleByCheckout(parsed.checkoutRequestId, parsed);
  console.log(`[farmline] mpesa callback ${parsed.checkoutRequestId}: ${parsed.status}`
    + `${parsed.receipt ? ' ' + parsed.receipt : ''}${out.matched ? '' : ' (no matching ledger entry)'}`);

  // Daraja only needs a 200 with this envelope; it retries on anything else.
  return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
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
      total: order.total, how: order.how, slot: order.slot, addr: order.addr,
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
    farm: projection.publicFarm(farm),   // ALLOWLIST ONLY
    availability,
    records,
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
  console.log(`  dbName=${config.dbName}  auth=${auth.authArmed ? 'ARMED' : 'OPEN (set AUTH_SECRET)'}  money=${config.moneyMode}  mpesa=${money.mpesaConfigured() ? 'configured' : 'not armed'}`);
  console.log(`  chat=${io ? 'socket.io at /socket-farmline/ (+ REST)' : 'REST only (socket.io not installed)'}  env=${config.envName}`);
  migrateLegacyIndexes().catch((e) => console.warn('[farmline] index migration error:', e.message));
});
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => {
    if (io) io.close();
    server.close(() => { conn.close().finally(() => process.exit(0)); });
  });
}

module.exports = app;
