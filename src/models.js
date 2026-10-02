// src/models.js — every collection, in one file (the rolodex-server convention:
// the data shape should be readable in a single sitting).
//
// THE CENTRAL DESIGN FACT, restated because it governs this whole file:
//   There is NO authored storefront. `Sellable` holds the farmer's PRICE and
//   TERMS for a product; the STOCK is always derived from records (logs,
//   harvests, animals-for-sale) minus withdrawal holds — see projection.js.
//   The farmer never maintains a shop. That is what keeps their workload at zero.
const mongoose = require('mongoose');
const config = require('./config');

const conn = mongoose.createConnection(config.mongoUri, {
  dbName: config.dbName,          // enforced: never the zyppar/rolodex db
  serverSelectionTimeoutMS: 20000,
});
conn.on('error', (e) => console.error('[mongo]', e.message));

const { Schema } = mongoose;

// ── helpers ───────────────────────────────────────────────────────────────────
const money = { type: Number, default: 0, min: 0 };

// ── FARM ──────────────────────────────────────────────────────────────────────
const farmSchema = new Schema({
  name: { type: String, required: true },
  slug: { type: String, required: true, unique: true, index: true },
  area: { type: String, default: '' },          // e.g. 'Limuru, Kiambu'
  county: { type: String, default: '' },
  story: { type: String, default: '' },
  photos: { type: [Schema.Types.Mixed], default: [] },   // from the Photo Kit
  verifiedFarm: { type: Boolean, default: false },

  // ── the ladder (see ladder.js) ──
  rung: { type: Number, default: 0, min: 0, max: 6 },
  rungAcceptedAt: { type: Date, default: null },

  // ── money (AGENTS.md rule 2) ──
  moneyMode: { type: String, enum: ['virtual', 'mpesa'], default: config.moneyMode },
  zuBalance: { type: Number, default: 0 },      // virtual mode only
  mpesa: { paybill: String, till: String, account: String },

  // ── the finish line (spec v1 §3) — required income is a 12-month PROFILE,
  //    not a flat number: school fees and harvests are lumpy. ──
  requiredIncome: {
    offFarmMonthly: money,
    householdMonthly: money,
    profile: { type: [Number], default: [] },   // 12 entries, Jan..Dec
    safetyMarginPct: { type: Number, default: 15 },
  },

  // ── shop terms the farmer writes ──
  terms: {
    pickupFree: { type: Boolean, default: true },
    deliveryFee: money,
    deliveryRadiusKm: { type: Number, default: 6 },
    substitutionPolicy: { type: String, default: '' },
    cancellable: { type: Boolean, default: true },
  },
  slots: {
    pickup: { type: [String], default: [] },
    delivery: { type: [String], default: [] },
  },

  // ── trust signals (derived, cached nightly) ──
  trust: {
    withdrawalAdherence: { type: Number, default: 1 },   // 0..1
    vaccinationsCurrent: { type: Boolean, default: false },
    responseRate: { type: Number, default: 0 },
    fulfilmentRate: { type: Number, default: 0 },
    ordersFulfilled: { type: Number, default: 0 },
  },

  // ── data confidence (gates the VERDICT rung) ──
  confidence: {
    grade: { type: String, enum: ['low', 'medium', 'high'], default: 'low' },
    daysOfHistory: { type: Number, default: 0 },
    categorisedPct: { type: Number, default: 0 },
    lastLoggedAt: { type: Date, default: null },
  },
}, { timestamps: true });

// ── PEOPLE ────────────────────────────────────────────────────────────────────
const memberSchema = new Schema({
  farmId: { type: Schema.Types.ObjectId, ref: 'Farm', required: true, index: true },
  phone: { type: String, required: true, index: true },
  name: { type: String, default: '' },
  role: { type: String, enum: ['owner', 'manager', 'worker', 'vet', 'viewer'], default: 'owner' },
  pinSalt: String,
  pinHash: String,
  active: { type: Boolean, default: true },
}, { timestamps: true });
memberSchema.index({ farmId: 1, phone: 1 }, { unique: true });

const customerSchema = new Schema({
  phone: { type: String, required: true, unique: true, index: true },
  name: { type: String, default: '' },
  // Customers are rated too (spec v4 §5.5): for perishable produce a no-show at
  // pick-up is a direct loss to the farmer.
  rating: { sum: { type: Number, default: 0 }, count: { type: Number, default: 0 } },
  noShows: { type: Number, default: 0 },
  ordersCount: { type: Number, default: 0 },
}, { timestamps: true });

// ── LAND & CROPS (first-class, not a plugin) ──────────────────────────────────
const plotSchema = new Schema({
  farmId: { type: Schema.Types.ObjectId, ref: 'Farm', required: true, index: true },
  name: { type: String, required: true },       // 'Plot B'
  acres: { type: Number, default: 0 },
  soil: { type: String, default: '' },
  water: { type: String, default: '' },
  notes: { type: String, default: '' },
}, { timestamps: true });

const cropCycleSchema = new Schema({
  farmId: { type: Schema.Types.ObjectId, ref: 'Farm', required: true, index: true },
  plotId: { type: Schema.Types.ObjectId, ref: 'Plot', index: true },
  crop: { type: String, required: true },       // maize, beans, napier, kale…
  variety: { type: String, default: '' },
  acres: { type: Number, default: 0 },
  season: { type: String, default: '' },        // 'long rains 2026'
  plantedOn: { type: Date, default: null },
  expectedHarvest: { type: Date, default: null },
  intercropWith: { type: String, default: '' },
  fodderFor: { type: String, default: '' },     // 'dairy' when the crop feeds stock
  status: { type: String, enum: ['planned', 'growing', 'harvested', 'failed'], default: 'planned' },
  yield: { quantity: Number, unit: String, harvestedOn: Date },
}, { timestamps: true });

// ── ANIMALS ───────────────────────────────────────────────────────────────────
const animalGroupSchema = new Schema({
  farmId: { type: Schema.Types.ObjectId, ref: 'Farm', required: true, index: true },
  species: { type: String, required: true },    // cattle | goats | sheep | layers | broilers | pigs | bees
  label: { type: String, default: '' },         // 'the dairy cows'
  count: { type: Number, default: 0 },
  productionKind: { type: String, default: '' },// milk | eggs | none
  active: { type: Boolean, default: true },
}, { timestamps: true });

const animalSchema = new Schema({
  farmId: { type: Schema.Types.ObjectId, ref: 'Farm', required: true, index: true },
  groupId: { type: Schema.Types.ObjectId, ref: 'AnimalGroup', index: true },
  name: { type: String, default: '' },          // 'Browny'
  tag: { type: String, default: '' },
  species: { type: String, required: true },
  sex: { type: String, default: '' },
  bornOn: { type: Date, default: null },
  weightKg: { type: Number, default: 0 },
  status: { type: String, enum: ['alive', 'sold', 'dead', 'forSale'], default: 'alive' },
  salePrice: money,
  photo: { type: String, default: '' },
}, { timestamps: true });

// ── THE SCHEDULE (the heart of the product — spec v3 §4) ──────────────────────
// Events are MATERIALISED from protocol templates, never hand-entered. The farmer
// sees a work list; the engine sees triggers.
const scheduledEventSchema = new Schema({
  farmId: { type: Schema.Types.ObjectId, ref: 'Farm', required: true, index: true },
  subjectType: { type: String, enum: ['animal', 'group', 'plot', 'cropcycle'], required: true },
  subjectId: { type: Schema.Types.ObjectId, default: null },
  subjectLabel: { type: String, default: '' },  // denormalised for the work list
  intervention: { type: String, required: true }, // 'deworming' | 'spray' | 'top-dress' | …
  dueOn: { type: Date, required: true, index: true },
  windowDays: { type: Number, default: 7 },     // tolerance — never "overdue by an hour"
  status: { type: String, enum: ['due', 'done', 'skipped', 'carried'], default: 'due' },
  // BASELINE: an interval protocol with no known history. We do not know when the
  // farmer last sprayed or dewormed, so the honest move is to surface it once and
  // ask — not to invent a due date, and not to bury it 14 days out. These render
  // in their own "confirm these" bucket, separate from the day's real work.
  baseline: { type: Boolean, default: false },
  doseBasis: { type: String, default: '' },
  costEstimate: money,
  // The compliance payload: what this event, once done, holds back from sale.
  withdrawal: { milkDays: { type: Number, default: 0 }, meatDays: { type: Number, default: 0 } },
  doneAt: { type: Date, default: null },
  doneBy: { type: Schema.Types.ObjectId, ref: 'Member', default: null },
  productUsed: { type: String, default: '' },
}, { timestamps: true });
scheduledEventSchema.index({ farmId: 1, dueOn: 1, status: 1 });

// ── THE LOG (one-tap capture; the source of every derived number) ─────────────
const logSchema = new Schema({
  farmId: { type: Schema.Types.ObjectId, ref: 'Farm', required: true, index: true },
  kind: {
    type: String, required: true, index: true,
    enum: ['milk', 'eggs', 'weight', 'treatment', 'spray', 'harvest', 'sale', 'purchase',
           'feed', 'mortality', 'birth', 'service', 'water', 'note'],
  },
  at: { type: Date, default: Date.now, index: true },
  byMemberId: { type: Schema.Types.ObjectId, ref: 'Member', default: null },

  subjectType: { type: String, default: '' },
  subjectId: { type: Schema.Types.ObjectId, default: null },
  subjectLabel: { type: String, default: '' },

  product: { type: String, default: '' },       // 'milk' | 'eggs' | 'goat' | 'maize'
  quantity: { type: Number, default: 0 },
  unit: { type: String, default: '' },          // litre | tray | head | cob | bunch | kg | bag

  amountKES: money,                             // for sale | purchase
  buyer: { type: String, default: '' },
  counterparty: { type: String, default: '' },

  note: { type: String, default: '' },
  scheduledEventId: { type: Schema.Types.ObjectId, ref: 'ScheduledEvent', default: null },

  // Offline-first: the client mints these, so a replayed batch is idempotent.
  clientId: { type: String, default: '', index: true },
  deviceAt: { type: Date, default: null },
}, { timestamps: true });
logSchema.index({ farmId: 1, clientId: 1 }, { unique: true, sparse: true });

// ── THE HOLD (withdrawal). --alert on screen is spent on this and nothing else ─
const holdSchema = new Schema({
  farmId: { type: Schema.Types.ObjectId, ref: 'Farm', required: true, index: true },
  subjectType: { type: String, default: 'animal' },
  subjectId: { type: Schema.Types.ObjectId, default: null },
  subjectLabel: { type: String, default: '' },
  product: { type: String, default: '' },       // the product that was administered
  affects: { type: [String], default: [] },     // ['milk'] | ['meat'] | ['eggs']
  days: { type: Number, default: 0 },
  startedAt: { type: Date, default: Date.now },
  until: { type: Date, required: true, index: true },
  active: { type: Boolean, default: true, index: true },
  viaEventId: { type: Schema.Types.ObjectId, ref: 'ScheduledEvent', default: null },
}, { timestamps: true });

// ── SELLABLE (price + terms only — NEVER stock) ───────────────────────────────
const sellableSchema = new Schema({
  farmId: { type: Schema.Types.ObjectId, ref: 'Farm', required: true, index: true },
  product: { type: String, required: true },    // 'milk' | 'eggs' | 'goat' | 'maize' | 'kale'
  label: { type: String, default: '' },
  labelSw: { type: String, default: '' },
  icon: { type: String, default: '' },
  unit: { type: String, default: '' },          // litre | tray | head | cob | bunch
  unitSw: { type: String, default: '' },
  price: { type: Number, required: true },
  minQty: { type: Number, default: 1 },
  enabled: { type: Boolean, default: true },
  // Which derived source feeds the stock. Empty ⇒ the item is not projected.
  source: {
    kind: { type: String, enum: ['production', 'harvest', 'animalForSale', 'none'], default: 'none' },
    product: { type: String, default: '' },
    windowDays: { type: Number, default: 1 },   // milk today, eggs last 2 days, etc.
  },
  affects: { type: [String], default: [] },     // which hold types suppress it
}, { timestamps: true });
sellableSchema.index({ farmId: 1, product: 1 }, { unique: true });

// ── THE ORDER (the customer's side; the farmer sees it as work) ───────────────
const orderSchema = new Schema({
  farmId: { type: Schema.Types.ObjectId, ref: 'Farm', required: true, index: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', index: true },
  ref: { type: String, required: true, unique: true, index: true },
  lines: [{
    product: String, label: String, unit: String,
    qty: Number, price: Number, sum: Number,
  }],
  subtotal: money,
  deliveryFee: money,
  total: money,
  how: { type: String, enum: ['pickup', 'delivery'], default: 'pickup' },
  slot: { type: String, default: '' },
  addr: { type: String, default: '' },
  note: { type: String, default: '' },
  stage: { type: Number, default: 1, min: 0, max: 5 },
  stageHistory: [{ stage: Number, at: { type: Date, default: Date.now } }],
  payment: {
    mode: { type: String, enum: ['virtual', 'mpesa'], default: 'virtual' },
    status: { type: String, enum: ['unpaid', 'pending', 'paid', 'failed'], default: 'unpaid' },
    ref: { type: String, default: '' },
    paidAt: { type: Date, default: null },
  },
}, { timestamps: true });

// ── THE LEDGER (mode-agnostic: same shape for ZU and M-Pesa) ──────────────────
const ledgerSchema = new Schema({
  farmId: { type: Schema.Types.ObjectId, ref: 'Farm', required: true, index: true },
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
  mode: { type: String, enum: ['virtual', 'mpesa'], required: true },
  direction: { type: String, enum: ['in', 'out'], required: true },
  amountKES: money,
  amountZU: { type: Number, default: 0 },
  ref: { type: String, default: '' },
  status: { type: String, enum: ['pending', 'settled', 'failed'], default: 'pending' },
  note: { type: String, default: '' },
}, { timestamps: true });

// ── PRICE OBSERVATIONS (market awareness, Rung 3+) ────────────────────────────
const priceSchema = new Schema({
  farmId: { type: Schema.Types.ObjectId, ref: 'Farm', index: true },
  product: { type: String, required: true, index: true },
  unit: { type: String, default: '' },
  price: { type: Number, required: true },
  market: { type: String, default: '' },
  source: { type: String, enum: ['farmer', 'buyer', 'market', 'amis'], default: 'farmer' },
  observedAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

module.exports = {
  conn,
  Farm: conn.model('Farm', farmSchema),
  Member: conn.model('Member', memberSchema),
  Customer: conn.model('Customer', customerSchema),
  Plot: conn.model('Plot', plotSchema),
  CropCycle: conn.model('CropCycle', cropCycleSchema),
  AnimalGroup: conn.model('AnimalGroup', animalGroupSchema),
  Animal: conn.model('Animal', animalSchema),
  ScheduledEvent: conn.model('ScheduledEvent', scheduledEventSchema),
  Log: conn.model('Log', logSchema),
  Hold: conn.model('Hold', holdSchema),
  Sellable: conn.model('Sellable', sellableSchema),
  Order: conn.model('Order', orderSchema),
  Ledger: conn.model('Ledger', ledgerSchema),
  PriceObservation: conn.model('PriceObservation', priceSchema),
};
