// scripts/seed-demo-farm.cjs — KIMANI FARMS, the living demo (the founder,
// 2026-10-08: "people need to SEE"). A fully seeded fictional farm that runs
// the whole ladder: plots, crop cycles with real materialised schedules,
// animal groups with individuals and records, an active milk hold, the shop
// front, orders, and chat threads with fictional customers.
//
// Run ON THE DROPLET (appuser):
//   sudo -u appuser node scripts/seed-demo-farm.cjs
// Idempotent: an existing demo farm (slug kimani-farms) is replaced whole.
const path = require('path');
process.chdir(path.join(__dirname, '..'));
const mongoose = require('mongoose');
const config = require('../src/config');
const auth = require('../src/auth');
const schedule = require('../src/schedule');
const protocols = require('../src/protocols');

const day = (n) => new Date(Date.now() + n * 86400000);
const DEMO_SLUG = 'kimani-farms';

(async () => {
  await mongoose.connect(config.mongoUri, { dbName: config.dbName });
  const { Farm, Member, Plot, CropCycle, AnimalGroup, Animal, ScheduledEvent, Log, Hold,
          Sellable, Order, Ledger, Customer, Conversation, Message, PriceObservation } = require('../src/models');

  // ── replace any existing demo ───────────────────────────────────────────────
  const old = await Farm.findOne({ slug: DEMO_SLUG }).lean();
  if (old) {
    const fid = old._id;
    await Promise.all([
      Member.deleteMany({ farmId: fid }), Plot.deleteMany({ farmId: fid }),
      CropCycle.deleteMany({ farmId: fid }), AnimalGroup.deleteMany({ farmId: fid }),
      Animal.deleteMany({ farmId: fid }), ScheduledEvent.deleteMany({ farmId: fid }),
      Log.deleteMany({ farmId: fid }), Hold.deleteMany({ farmId: fid }),
      Sellable.deleteMany({ farmId: fid }), Order.deleteMany({ farmId: fid }),
      Ledger.deleteMany({ farmId: fid }), Conversation.deleteMany({ farmId: fid }),
      PriceObservation.deleteMany({ farmId: fid }),
    ]);
    const oldConvos = await Conversation.find({ farmId: fid }).distinct('_id');
    await Message.deleteMany({ conversationId: { $in: oldConvos } });
    await Farm.deleteOne({ _id: fid });
    // The DEMO CUSTOMERS are global (customers are not farm-scoped) — the demo
    // phones are reserved for the fiction, so they go with the farm.
    await Customer.deleteMany({ phone: { $in: ['0700000008', '0700000007'] } });
    console.log('  previous demo replaced');
  }

  // THE DEMO'S FACE: kimanifarms.jpg ships IN the bundle
  // (farmline-app/src/assets/images/), so the farm doc carries the RELATIVE
  // path — every img binding in the app resolves it, and no base64 bloats
  // the reads. The seed finds it beside the app checkout on the droplet.
  let photo = '';
  try {
    const dir = require('path').join(__dirname, '..', '..', 'farmline-app', 'src', 'assets', 'images');
    for (const name of ['kimanifarms.jpg', 'kimani.jpg']) {
      if (require('fs').existsSync(require('path').join(dir, name))) {
        photo = 'assets/images/' + name;
        console.log('  photo: ' + name + ' — the demo farm wears it (bundle path)');
        break;
      }
    }
  } catch { /* no photo yet — the demo still works */ }

  // ── the farm ────────────────────────────────────────────────────────────────
  const farm = await Farm.create({
    name: 'Kimani Farms', slug: DEMO_SLUG, area: 'Limuru, Kiambu', county: 'Kiambu',
    story: 'Three acres by the river: five dairy cows, a small goat herd and two hundred laying hens. The maize feeds the cows; the napier feeds the cows; the cows feed the family. Every crate of eggs and every litre of milk is sold here on farmline — walk the whole farm, then make your own.',
    verifiedFarm: true, rung: 4, rungAcceptedAt: day(-120),
    visionTier: 'advanced', // the demo shows the full ladder — including AI Vision
    zuBalance: 0,
    requiredIncome: { offFarmMonthly: 8000, householdMonthly: 32000, profile: [38000,36000,34000,42000,40000,38000,46000,44000,40000,38000,42000,60000], safetyMarginPct: 15 },
    terms: { pickupFree: true, deliveryFee: 150, deliveryRadiusKm: 8, substitutionPolicy: 'If a tray is short, I bring the fresh one the same evening.', cancellable: true },
    slots: { pickup: ['today 17:00-19:00', 'tomorrow 07:00-08:00'], delivery: ['tomorrow 09:00-11:00', 'saturday 10:00-12:00'] },
    trust: { withdrawalAdherence: 1, vaccinationsCurrent: true, responseRate: 0.95, fulfilmentRate: 0.97, ordersFulfilled: 34 },
    confidence: { grade: 'high', daysOfHistory: 64, categorisedPct: 0.98, lastLoggedAt: day(-1) },
    isDemo: true,
    photo,
  });
  console.log('  farm:', farm.name, farm._id);

  const { salt, hash } = auth.hashPin('1234');
  const member = await Member.create({ farmId: farm._id, phone: '0700000009', name: 'Peter Kimani', role: 'owner', pinSalt: salt, pinHash: hash, active: true });

  // ── the land ────────────────────────────────────────────────────────────────
  const riverField = await Plot.create({ farmId: farm._id, name: 'River Field', acres: 2.5, soil: 'loam', water: 'river pump', notes: 'The main field — flat, never floods.' });
  const hillside = await Plot.create({ farmId: farm._id, name: 'Hillside', acres: 1.8, soil: 'red clay', water: 'rainfed' });
  const yard = await Plot.create({ farmId: farm._id, name: 'Poultry Yard', acres: 0.5, soil: 'settled', water: 'tap' });

  // ── the crops (schedules materialised exactly as the real route does) ───────
  const crops = [
    { plot: riverField, crop: 'maize', variety: 'H614', acres: 2.0, planted: -45, season: 'long rains' },
    { plot: riverField, crop: 'napier', variety: 'Bana', acres: 0.5, planted: -300, fodderFor: 'dairy' },
    { plot: hillside, crop: 'kale', variety: 'Sukuma wiki', acres: 0.3, planted: -20 },
    { plot: hillside, crop: 'tomatoes', variety: 'Anna F1', acres: 0.2, planted: -12 },
    { plot: hillside, crop: 'avocado', variety: 'Hass', acres: 1.0, planted: -400 },
  ];
  let eventsTotal = 0;
  for (const c of crops) {
    const cycle = await CropCycle.create({
      farmId: farm._id, plotId: c.plot._id, crop: c.crop, variety: c.variety, acres: c.acres,
      season: c.season || '', plantedOn: day(c.planted), fodderFor: c.fodderFor || '', status: 'growing',
    });
    const built = await schedule.materialise({
      farmId: farm._id, subjectType: 'cropcycle', subjectId: cycle._id,
      subjectLabel: c.crop, species: c.crop, anchor: day(c.planted),
    });
    eventsTotal += built.created;
    console.log(`  crop ${c.crop}: ${built.created} events`);
  }

  // ── the herds ───────────────────────────────────────────────────────────────
  const herdDefs = [
    { species: 'cattle', label: 'the dairy cows', count: 5, productionKind: 'milk' },
    { species: 'goats', label: 'the goats', count: 8, productionKind: 'none' },
    { species: 'layers', label: 'the laying hens', count: 200, productionKind: 'eggs' },
  ];
  const groups = {};
  for (const g of herdDefs) {
    const group = await AnimalGroup.create({ farmId: farm._id, ...g, active: true });
    const built = await schedule.materialise({
      farmId: farm._id, subjectType: 'group', subjectId: group._id,
      subjectLabel: g.label, species: g.species,
    });
    groups[g.species] = group;
    eventsTotal += built.created;
    console.log(`  herd ${g.species}: ${built.created} events`);
  }

  // ── individuals (the tap-and-see-the-whole-story promise) ───────────────────
  const browny = await Animal.create({ farmId: farm._id, groupId: groups.cattle._id, name: 'Browny', tag: 'K-01', species: 'cattle', sex: 'female', bornOn: day(-1200), weightKg: 420, status: 'alive' });
  await Animal.create({ farmId: farm._id, groupId: groups.cattle._id, name: 'Pesa', tag: 'K-02', species: 'cattle', sex: 'female', bornOn: day(-900), weightKg: 380, status: 'alive' });
  await Animal.create({ farmId: farm._id, groupId: groups.cattle._id, name: 'Njeri', tag: 'K-03', species: 'cattle', sex: 'female', bornOn: day(-600), weightKg: 350, status: 'forSale', salePrice: 95000 });
  await Animal.create({ farmId: farm._id, groupId: groups.goats._id, name: 'Chui', tag: 'G-01', species: 'goats', sex: 'male', bornOn: day(-500), weightKg: 55, status: 'alive' });

  // ── a week of records (the projection reads these) ─────────────────────────
  const logs = [];
  for (let d = 6; d >= 0; d--) {
    logs.push({ farmId: farm._id, kind: 'milk', at: day(-d), subjectType: 'group', subjectId: groups.cattle._id, subjectLabel: 'the dairy cows', product: 'milk', quantity: 19 + (d % 3), unit: 'litre' });
    logs.push({ farmId: farm._id, kind: 'eggs', at: day(-d), subjectType: 'group', subjectId: groups.layers._id, subjectLabel: 'the laying hens', product: 'eggs', quantity: 15 - (d % 2), unit: 'tray' });
  }
  logs.push({ farmId: farm._id, kind: 'treatment', at: day(-2), subjectType: 'group', subjectId: groups.cattle._id, subjectLabel: 'the dairy cows', product: 'penstrep', quantity: 1, unit: 'dose', note: 'mastitis watch — the whole herd treated as a precaution' });
  logs.push({ farmId: farm._id, kind: 'weight', at: day(-10), subjectType: 'animal', subjectId: browny._id, subjectLabel: 'Browny', product: 'weight', quantity: 420, unit: 'kg' });
  logs.push({ farmId: farm._id, kind: 'harvest', at: day(-3), subjectType: 'cropcycle', subjectId: null, subjectLabel: 'kale', product: 'kale', quantity: 40, unit: 'bunch' });
  logs.push({ farmId: farm._id, kind: 'purchase', at: day(-5), product: 'layers mash', quantity: 5, unit: 'bag', amountKES: 11500, counterparty: 'Unga House' });
  await Log.insertMany(logs);

  // ── the live milk hold (the withdrawal machine, fed by the treatment) ───────
  await Hold.create({
    farmId: farm._id, subjectType: 'group', subjectId: groups.cattle._id,
    subjectLabel: 'the dairy cows', product: 'penstrep', affects: ['milk'], days: 3,
    startedAt: day(-2), until: day(1), active: true,
  });

  // ── the shop front ──────────────────────────────────────────────────────────
  await Sellable.create([
    { farmId: farm._id, product: 'milk', label: 'Fresh milk', labelSw: 'Maziwa', unit: 'litre', unitSw: 'lita', price: 70, source: { kind: 'production', product: 'milk', windowDays: 1 }, affects: ['milk'], enabled: true },
    { farmId: farm._id, product: 'eggs', label: 'Eggs — a tray of 30', labelSw: 'Mayai — trey 30', unit: 'tray', unitSw: 'trey', price: 420, source: { kind: 'production', product: 'eggs', windowDays: 2 }, affects: ['eggs'], enabled: true },
    { farmId: farm._id, product: 'kale', label: 'Sukuma wiki', labelSw: 'Sukuma wiki', unit: 'bunch', unitSw: 'kichwa', price: 25, source: { kind: 'harvest', product: 'kale', windowDays: 3 }, enabled: true },
    { farmId: farm._id, product: 'avocado', label: 'Avocados — a crate', labelSw: 'Machungwa ya pecha — kasha', unit: 'crate', unitSw: 'kasha', price: 1500, source: { kind: 'none' }, enabled: true },
  ]);

  // ── the buyers ──────────────────────────────────────────────────────────────
  const wanjiku = await Customer.create({ phone: '0700000008', name: 'Wanjiku Store', ordersCount: 12 });
  const njeri = await Customer.create({ phone: '0700000007', name: 'Mama Njeri', ordersCount: 3 });

  // ── the orders (one mid-flight, one fresh) ──────────────────────────────────
  const order1 = await Order.create({
    farmId: farm._id, customerId: wanjiku._id, ref: 'FL-KIMANI-0001',
    lines: [{ product: 'milk', label: 'Fresh milk', unit: 'litre', qty: 10, price: 70, sum: 700 },
            { product: 'eggs', label: 'Eggs — a tray of 30', unit: 'tray', qty: 2, price: 420, sum: 840 }],
    subtotal: 1540, deliveryFee: 150, total: 1690, how: 'delivery', slot: 'tomorrow 09:00-11:00',
    addr: 'Wanjiku Store, Limuru town', stage: 3,
    stageHistory: [{ stage: 1, at: day(-1) }, { stage: 2, at: day(-1) }, { stage: 3, at: day(0) }],
    payment: { mode: 'virtual', status: 'paid', ref: 'ZU-DEMO-0001', paidAt: day(-1) },
  });
  const order2 = await Order.create({
    farmId: farm._id, customerId: njeri._id, ref: 'FL-KIMANI-0002',
    lines: [{ product: 'kale', label: 'Sukuma wiki', unit: 'bunch', qty: 20, price: 25, sum: 500 }],
    subtotal: 500, deliveryFee: 0, total: 500, how: 'pickup', slot: 'today 17:00-19:00',
    stage: 1, stageHistory: [{ stage: 1, at: day(0) }],
    payment: { mode: 'virtual', status: 'unpaid' },
  });
  await Ledger.create({ farmId: farm._id, orderId: order1._id, customerId: wanjiku._id, mode: 'virtual', direction: 'in', amountKES: 1690, ref: 'ZU-DEMO-0001', status: 'settled', settledAt: day(-1) });

  // ── the threads (real words, a record like any real thread) ─────────────────
  const conv1 = await Conversation.create({
    farmId: farm._id, customerId: wanjiku._id, orderId: order1._id,
    farmLabel: 'Kimani Farms', customerLabel: 'Wanjiku Store',
    lastMessageAt: day(0, 9), lastMessageText: 'Great — see you at 9.',
    farmerReadAt: day(0, 9), customerReadAt: day(0, 9),
  });
  const conv2 = await Conversation.create({
    farmId: farm._id, customerId: njeri._id,
    farmLabel: 'Kimani Farms', customerLabel: 'Mama Njeri',
    lastMessageAt: day(0, 11), lastMessageText: 'Do you deliver to Kikuyu on Saturdays?',
    farmerReadAt: day(-1), customerReadAt: day(0, 11), // unread on the farmer's side
  });
  const msg = (conv, fromType, body, hoursAgo) => ({
    conversationId: conv._id, fromType,
    fromId: fromType === 'farmer' ? member._id : (conv === conv1 ? wanjiku._id : njeri._id),
    fromLabel: fromType === 'farmer' ? 'Peter Kimani' : (conv === conv1 ? 'Wanjiku Store' : 'Mama Njeri'),
    body, at: new Date(Date.now() - hoursAgo * 3600000),
  });
  await Message.insertMany([
    msg(conv1, 'customer', 'Good morning! Can I get 10 litres and 2 trays for tomorrow morning?', 20),
    msg(conv1, 'farmer', 'Yes — delivery at 9 to the store, as usual.', 18),
    msg(conv1, 'customer', 'Perfect. M-Pesa sent.', 10),
    msg(conv1, 'farmer', 'Received, asante. See you at 9.', 9),
    msg(conv2, 'customer', 'Habari. Are the eggs from today?', 6),
    msg(conv2, 'farmer', 'Fresh this morning — 15 trays were collected today.', 5),
    msg(conv2, 'customer', 'Do you deliver to Kikuyu on Saturdays?', 3),
  ]);

  // ── market observations (Rung 3) ────────────────────────────────────────────
  await PriceObservation.create([
    { farmId: farm._id, product: 'milk', unit: 'litre', price: 65, market: 'Limuru Brook', source: 'market', observedAt: day(-2) },
    { farmId: farm._id, product: 'eggs', unit: 'tray', price: 405, market: 'Limuru wholesale', source: 'market', observedAt: day(-2) },
    { farmId: farm._id, product: 'maize', unit: 'bag', price: 4100, market: 'Baraka market', source: 'amis', observedAt: day(-4) },
  ]);

  console.log(`  events materialised: ${eventsTotal}`);
  console.log(`  ✓ KIMANI FARMS is seeded — the demo login is POST /api/farmline/auth/demo`);
  console.log(`    farmId: ${farm._id}`);
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error('SEED FAIL', e.message); process.exit(1); });
