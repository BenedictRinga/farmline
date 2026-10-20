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
  photo: { type: String, default: '' },                   // THE FARM'S FACE — one hero photograph (client-downsized JPEG data URL)
  verifiedFarm: { type: Boolean, default: false },

  // ── the ladder (see ladder.js) ──
  rung: { type: Number, default: 0, min: 0, max: 6 },
  rungAcceptedAt: { type: Date, default: null },
  // THE PAID PERIOD (the ZU doctrine, 2026-10-11): a paid rung is bought with ZU
  // for 30 days and then PAUSES — it never auto-bills, because the standing law
  // is "nothing is ever charged silently". The buyer of that period is the farmer
  // himself: ZU unlocks rungs. See src/zu.js for the prices and the packs.
  rungPaidUntil: { type: Date, default: null },
  // THE PROVISIONAL RUNG (the founder's ruling, 2026-10-11: the mid-season door
  // grants "both"). A farmer who walks the mid-season AI estimate gets to FEEL the
  // paid layer for PROVISIONAL_DAYS — but it is labelled provisional in his own UI,
  // is never representable to a buyer as a verified rung, and EXPIRES into the
  // honest path. It is a demonstration, not a purchase: the estimate buys a
  // SCHEDULE, never HISTORY (estimated artifacts are excluded from readiness).
  rungProvisionalUntil: { type: Date, default: null },

  // ── MONEY (rewritten 2026-10-11 — the ZU-only doctrine) ──────────────────────
  // REMOVED and why: `moneyMode` was the virtual/mpesa rail toggle, and `mpesa`
  // held the Daraja credentials used to ask a BUYER's phone to pay a FARMER. Both
  // put Farmline between two third parties, which is the one thing the founder
  // ruled out. The rail is deleted; the doctrine's rule is "whose money" — one
  // direction, into our own account, for our own service.
  //
  // `zuBalance` was a STORED counter that contradicted the derived-balance law
  // (a stored balance that disagrees with its history is how money bugs start).
  // It is no longer written; the balance is derived from the Ledger on every read.
  zuBalance: { type: Number, default: 0 },      // VESTIGIAL — do not write; use money.balance()
  // THE FARMER'S OWN PAYMENT WORDS, for HIS buyers. Free text he writes himself
  // (paybill / till / bank / Airtel Money / "cash at pickup"). Farmline stores it
  // and shows it. Farmline NEVER reads it to initiate, verify or settle anything —
  // that is the whole delineation, and this string is deliberately not structured
  // so that no code can mistake it for an instruction.
  payTo: { type: String, default: '', maxlength: 600 },

  // ── THE AI-VISION TIER (the founder, 2026-10-07: "provide for expansion for
  // AI to 'see' the farm through the device camera — compute, count, label,
  // identify, measure — under advanced subscription packages"). The field is
  // the ENTITLEMENT, not the feature: ops/subscription sets it server-side;
  // the farmer cannot edit it through the profile route. 'none' today; when
  // the vision compute lands (a later ladder), 'advanced' unlocks it.
  visionTier: { type: String, enum: ['none', 'advanced'], default: 'none' },

  // RULING 1 (the founder, 2026-10-12): the tier is a STANDALONE SERVICE with a
  // FREE MONTHLY ALLOCATION — these two carry the meter (the EAT month key +
  // the used count; see src/index.js visionAllowanceState). The tier itself
  // NEVER moves the effective rung — ladder.effectiveRung never reads it.
  visionUsedThisMonth: { type: Number, default: 0 },
  visionMonthKey: { type: String, default: '' },

  // THE LIVING DEMO (the founder, 2026-10-08: "people need to SEE"): exactly
  // one farm carries isDemo:true — the demo login route issues a REAL farmer
  // token for it (no secrets on the wire; the farm holds only fictional data
  // and can be re-seeded whole at any time).
  isDemo: { type: Boolean, default: false, index: true },

  // THE CONDITIONAL SEED's stamp (2026-10-15, the boot-latency lesson): the
  // demo seed skips boots while this revision matches AND seedAt is fresh —
  // restarts (watch heals, deploys) no longer re-storm mongod with the
  // whole-farm replacement. Bump SEED_REV in scripts/seed-demo-farm.cjs when
  // the fiction changes; the next boot reseeds.
  seedRev: { type: String, default: '' },
  seedAt: { type: Date },

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
  // REVERSAL. Archiving hides a holding without destroying it, so "undo" is a real
  // undo: the id, the planting date and the links to its own logs all survive. A
  // destroy-and-recreate undo would lose all three, and would leave the farmer's
  // history pointing at a row that no longer exists.
  //
  // Nothing is ever hard-deleted by the app. Reversal is reversible.
  archivedAt: { type: Date, default: null },
  farmId: { type: Schema.Types.ObjectId, ref: 'Farm', required: true, index: true },
  name: { type: String, required: true },       // 'Plot B'
  acres: { type: Number, default: 0 },
  soil: { type: String, default: '' },
  water: { type: String, default: '' },
  notes: { type: String, default: '' },
  // THE MEETING (2026-10-13, the appraisal's fix A): the keep's idempotency —
  // a retried apply (a partial failure, a second tap) dedupes on this key
  // instead of duplicating the holding. The log route's own pattern, extended.
  clientId: { type: String, index: true },
}, { timestamps: true });

const cropCycleSchema = new Schema({
  // REVERSAL. Archiving hides a holding without destroying it, so "undo" is a real
  // undo: the id, the planting date and the links to its own logs all survive. A
  // destroy-and-recreate undo would lose all three, and would leave the farmer's
  // history pointing at a row that no longer exists.
  //
  // Nothing is ever hard-deleted by the app. Reversal is reversible.
  archivedAt: { type: Date, default: null },
  farmId: { type: Schema.Types.ObjectId, ref: 'Farm', required: true, index: true },
  plotId: { type: Schema.Types.ObjectId, ref: 'Plot', index: true },
  crop: { type: String, required: true },       // maize, beans, napier, kale…
  variety: { type: String, default: '' },
  acres: { type: Number, default: 0 },
  season: { type: String, default: '' },        // 'long rains 2026'
  plantedOn: { type: Date, default: null },
  // THE MID-SEASON DOOR (2026-10-09). Two additive fields, one honesty flag:
  //   plantedOnEstimated — the date was BACK-CALCULATED from the crop's current
  //     stage (Door 1) and is an estimate by construction; every surface that
  //     shows it says so.
  //   cycleStartOn — Door 3 ("just start from today"): the farmer could not place
  //     the crop in time, so plantedOn stays NULL (nothing is invented) and only
  //     the REMAINING schedule is anchored here. daysGrowing stays unknown and
  //     the UI says so.
  plantedOnEstimated: { type: Boolean, default: false },
  cycleStartOn: { type: Date, default: null },
  expectedHarvest: { type: Date, default: null },
  intercropWith: { type: String, default: '' },
  fodderFor: { type: String, default: '' },     // 'dairy' when the crop feeds stock
  status: { type: String, enum: ['planned', 'growing', 'harvested', 'failed'], default: 'planned' },
  yield: { quantity: Number, unit: String, harvestedOn: Date },
  // THE MEETING (2026-10-13, the appraisal's fix A): the keep's idempotency key.
  clientId: { type: String, index: true },
}, { timestamps: true });

// ── ANIMALS ───────────────────────────────────────────────────────────────────
const animalGroupSchema = new Schema({
  // REVERSAL. Archiving hides a holding without destroying it, so "undo" is a real
  // undo: the id, the planting date and the links to its own logs all survive. A
  // destroy-and-recreate undo would lose all three, and would leave the farmer's
  // history pointing at a row that no longer exists.
  //
  // Nothing is ever hard-deleted by the app. Reversal is reversible.
  archivedAt: { type: Date, default: null },
  farmId: { type: Schema.Types.ObjectId, ref: 'Farm', required: true, index: true },
  species: { type: String, required: true },    // cattle | goats | sheep | layers | broilers | pigs | bees
  label: { type: String, default: '' },         // 'the dairy cows'
  count: { type: Number, default: 0 },
  productionKind: { type: String, default: '' },// milk | eggs | honey | fish | meat | '' — the log kind the group's yield feeds; '' = unset (never a stamped 'none')
  active: { type: Boolean, default: true },
  // THE MEETING (2026-10-13, the appraisal's fix A): the keep's idempotency key.
  clientId: { type: String, index: true },
}, { timestamps: true });

plotSchema.index({ farmId: 1, archivedAt: 1 });
cropCycleSchema.index({ farmId: 1, archivedAt: 1 });
animalGroupSchema.index({ farmId: 1, archivedAt: 1 });

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
  status: { type: String, enum: ['due', 'done', 'skipped', 'carried', 'estimated'], default: 'due' },
  // BASELINE: an interval protocol with no known history. We do not know when the
  // farmer last sprayed or dewormed, so the honest move is to surface it once and
  // ask — not to invent a due date, and not to bury it 14 days out. These render
  // in their own "confirm these" bucket, separate from the day's real work.
  baseline: { type: Boolean, default: false },
  // ESTIMATED (the mid-season door, 2026-10-09): a past-dated event created from a
  // BACK-CALCULATED planting date. It is a question — "already done?" — never a
  // record. Confirm writes the record through the normal completion path; dismiss
  // deletes the event and leaves zero trace. An estimated event never appears as
  // the subject's "next due" and never enters the work list by status alone.
  estimated: { type: Boolean, default: false },
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
           'feed', 'mortality', 'birth', 'service', 'water', 'note',
           'honey', 'fish', 'live-sale'],
    // THE MEAT/HONEY/FISH SPEC (the founder's ruling baked in, 2026-10-13):
    // 'honey' and 'fish' are the new recording surfaces (additive — every
    // existing consumer untouched); 'live-sale' is the SALE of a whole live
    // animal — a DIFFERENT event from a butchered yield, honestly labeled,
    // never conflated. The shelf derives from all of it exactly as milk/eggs do.
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
  // ── THE HONESTY FLAG (the founder's ruling, 2026-10-11) ──────────────────────
  // `estimated` marks a log farmline BACK-CALCULATED rather than the farmer
  // witnessing it — the mid-season door writes these when it turns a photo into a
  // plausible history. They are real value to the farmer (a schedule to work to)
  // and they MUST NOT count toward readiness, or he could manufacture three weeks
  // of history in an afternoon and buy the VERDICT badge on fiction. Readiness
  // counts `estimated: false` only. See farmFacts() in src/index.js.
  estimated: { type: Boolean, default: false, index: true },
  scheduledEventId: { type: Schema.Types.ObjectId, ref: 'ScheduledEvent', default: null },

  // OFFLINE-FIRST: the client mints these, so a replayed batch is idempotent.
  //
  // THE DEFAULT MUST BE ABSENT, NOT ''. This was `default: ''` and it crashed the
  // server: the index below is `sparse`, and sparse skips documents where the field
  // is MISSING — an empty string is a present value, so the second Log ever written
  // without a clientId collided on `farmId_1_clientId_1` with `clientId: ""`.
  // That killed the process on the second "mark done" of the day, which is the
  // primary action of the whole product. Normalised at every creation site too
  // (see `normaliseClientId`), because a database that already has the old index
  // will not be fixed by a schema change alone.
  clientId: { type: String, index: true },
  deviceAt: { type: Date, default: null },
}, { timestamps: true });
// PARTIAL, not sparse. 'sparse' omits MISSING fields only — a document with
// clientId: null is still indexed, so the second log written without a clientId
// collided on this index and returned 500. That is the primary action of the app:
// marking a job done. This expression covers only real, non-empty string clientIds,
// which is exactly what offline idempotency is about.
logSchema.index(
  { farmId: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string', $gt: '' } } },
);

// REVERSAL (Layer 2, 2026-10-04 — "entries reversible in situ"). A RECORD is
// archived, never destroyed: the same law as the holdings. The projection sums
// logs FRESH on every read, so an archived log stops counting the moment
// archivedAt is set — the shelf recovers without a recompute job. Restoring puts
// the SAME _id back, which is what makes an undo a real undo.
logSchema.add({ archivedAt: { type: Date, default: null } });

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
  // The RECORD that opened this hold — the second creation path (a treatment
  // logged directly, not through the schedule) has no event, so reversal needs
  // the log link too. Both paths stamp one of the two; reversal follows whichever
  // exists. Without it, undoing a mistaken treatment would leave the milk held
  // for a treatment that did not happen.
  viaLogId: { type: Schema.Types.ObjectId, ref: 'Log', default: null, index: true },
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
  // THE FARMER'S OWN CLAIM, not ours (the ZU doctrine, 2026-10-11): Farmline no
  // longer runs a rail between this buyer and this farmer, so Farmline has no
  // business asserting whether money moved. `mode` is 'direct' — the buyer paid
  // the farmer on the farmer's own terms (his payTo text) — and the status is the
  // farmer's word about his own business. The honest sentence is "the farmer says
  // it is paid", never "farmline says it is paid". `stage` (0..5) remains the
  // operational truth of the order.
  payment: {
    mode: { type: String, enum: ['virtual', 'mpesa', 'direct'], default: 'direct' },
    status: { type: String, enum: ['unpaid', 'pending', 'paid', 'failed'], default: 'unpaid' },
    ref: { type: String, default: '' },
    paidAt: { type: Date, default: null },
  },
}, { timestamps: true });

// ── THE LEDGER — FARMLINE'S OWN RECEIVABLE BOOK (rewritten 2026-10-11) ────────
// One direction, one unit. Rows are ZU credited (the operator confirmed a claim)
// and ZU spent (a paid rung opened). There is no mpesa mode, no CheckoutRequestID
// and no receipt matching any more — those fields existed only to reconcile a
// callback for money moving BETWEEN two third parties, and that callback is
// deleted (see src/money.js for the why). `orderId`/`customerId` stay because
// historical rows carry them; nothing writes them now.
const ledgerSchema = new Schema({
  farmId: { type: Schema.Types.ObjectId, ref: 'Farm', required: true, index: true },
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
  mode: { type: String, enum: ['virtual', 'mpesa'], required: true },   // 'virtual' IS ZU
  direction: { type: String, enum: ['in', 'out'], required: true },
  amountKES: money,
  amountZU: { type: Number, default: 0 },
  ref: { type: String, default: '' },          // the receipt the operator matched
  // THE DAILY ALLOWANCE LOCK (the refill, 2026-10-11). One allowance per farm per
  // day, and the unique index below is the LOCK — not a check-then-write, which can
  // be won twice by two taps racing. Only allowance rows carry it; every other row
  // leaves it absent, which is what the partial filter keys on. (The 'sparse'
  // lesson from Message.clientId applies: sparse skips MISSING fields only, so the
  // default must be absent, and a partialFilterExpression states the intent.)
  dailyKey: { type: String },
  status: { type: String, enum: ['pending', 'settled', 'failed'], default: 'pending' },
  note: { type: String, default: '' },
  settledAt: { type: Date, default: null },
}, { timestamps: true });

// One allowance per farm per day. Two taps in the same second cannot both win.
ledgerSchema.index(
  { farmId: 1, dailyKey: 1 },
  { unique: true, partialFilterExpression: { dailyKey: { $type: 'string' } } },
);

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

// ══════════════════════════════════════════════════════════════════════════════
// CONVERSATIONS — the farmer and the buyer actually talking
// ══════════════════════════════════════════════════════════════════════════════
// LoopKeeper's chat (rolodex-server) is a DEMO ROOM: a room code, no auth, no
// persistence — messages exist only while both browsers are open. That shape is
// wrong here, and the difference matters:
//
//   · A farm↔buyer conversation is about a real order. It must survive a reload, a
//     device change, and a gap of days — a buyer asking "is the milk still held?"
//     needs the answer to still be there tomorrow.
//   · It must be SCOPED. A customer may only reach conversations they are part of;
//     without that, one buyer reads another's thread.
//   · It is a RECORD. If there is ever a dispute about what was agreed, the thread
//     is the evidence. Demo rooms can forget; a marketplace cannot.
//
// So: authenticated participants, persisted messages, one conversation per
// (farm, customer) pair, optionally anchored to the order that started it.
const conversationSchema = new Schema({
  farmId: { type: Schema.Types.ObjectId, ref: 'Farm', required: true, index: true },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', required: true, index: true },
  // The order that opened the thread, when one did. A conversation may predate an
  // order (an enquiry) and outlive it (after-sales).
  orderId: { type: Schema.Types.ObjectId, ref: 'Order', default: null, index: true },
  // Denormalised for list rendering without a populate round-trip.
  farmLabel: { type: String, default: '' },
  customerLabel: { type: String, default: '' },
  lastMessageAt: { type: Date, default: Date.now, index: true },
  lastMessageText: { type: String, default: '' },
  // Read position per side — cheap unread counts without scanning messages.
  farmerReadAt: { type: Date, default: null },
  customerReadAt: { type: Date, default: null },
  closed: { type: Boolean, default: false },
}, { timestamps: true });

// One thread per farm+buyer. Re-opening from a new order continues the same thread
// rather than fragmenting the history.
conversationSchema.index({ farmId: 1, customerId: 1 }, { unique: true });

const messageSchema = new Schema({
  conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true, index: true },
  fromType: { type: String, enum: ['farmer', 'customer'], required: true },
  fromId: { type: Schema.Types.ObjectId, required: true },
  fromLabel: { type: String, default: '' },
  // NOT `required` anymore (A2 tranche 4): a photo can travel without a caption.
  // The emptiness rule lives in chat.postMessage — a message is text OR photo,
  // never nothing.
  body: { type: String, trim: true, maxlength: 2000, default: '' },
  // THE PHOTO IN THE THREAD (A2 tranche 4, cloned from the farm-photo pattern):
  // a client-downsized JPEG data URL (the client caps itself; the route re-caps).
  photo: { type: String, default: '' },
  at: { type: Date, default: Date.now, index: true },
  // Offline-tolerant: the app may send a message that was composed with no signal.
  // Same idempotency contract as Logs — a replay must not post twice.
  // ABSENT, not '', for the same reason as the log: `sparse` skips MISSING fields,
  // and an empty string is present. This would have crashed the SECOND message in
  // every conversation.
  clientId: { type: String },
  // THE SECOND photo DECLARATION REMOVED (the audit's hygiene, 2026-10-08):
  // messageSchema declared `photo` twice — the later line silently overwrote
  // the earlier one (harmless in Mongoose, but a second place to drift). One
  // declaration above is the field.
  readByFarmer: { type: Boolean, default: false },
  readByCustomer: { type: Boolean, default: false },
}, { timestamps: true });

// PARTIAL for the same reason as the log index above: with the old sparse index the
// SECOND message in any conversation collided on a null clientId.
messageSchema.index(
  { conversationId: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string', $gt: '' } } },
);

/**
 * Drop the LEGACY offline-idempotency indexes so they can be rebuilt correctly.
 *
 * THE BUG THIS MIGRATES AWAY FROM: `{ farmId, clientId }` was declared `sparse: true`,
 * and a sparse index only omits documents where the field is MISSING. Mongoose stored
 * `null` for an unset clientId, and `null` is very much present — so the SECOND log
 * ever written without a clientId collided on `farmId_1_clientId_1` and the server
 * threw a 500. The second "mark done" of the day killed the process. That is the
 * primary action of the entire product.
 *
 * The index now uses a partialFilterExpression, which is precise about what it covers:
 * only real, non-empty clientIds are subject to uniqueness. Everything else is simply
 * not in the index.
 *
 * MongoDB will not change an index in place, so the old one has to be removed. This
 * runs at boot, matches the exact legacy shape, and SAYS SO — a silent index drop
 * would be its own kind of bug. Rebuild is automatic (mongoose autoIndex).
 */
async function migrateLegacyIndexes() {
  const legacy = [
    { collection: 'logs', name: 'farmId_1_clientId_1' },
    { collection: 'messages', name: 'conversationId_1_clientId_1' },
  ];
  for (const { collection, name } of legacy) {
    try {
      const coll = conn.collection(collection);
      const indexes = await coll.indexes().catch(() => []);
      const found = indexes.find((i) => i.name === name);
      if (!found) continue;
      const isSparse = found.sparse === true;
      const hasPartial = !!found.partialFilterExpression;
      if (isSparse && !hasPartial) {
        await coll.dropIndex(name);
        console.log(`[farmline] migrated: dropped the legacy sparse index ${collection}.${name}`);
        console.log('           (it treated null clientIds as duplicates — see migrateLegacyIndexes)');
      }
    } catch (e) {
      // Never block boot on a migration. A failure here means the old index stays and
      // writes may collide — loud, but not fatal, and the log says exactly that.
      console.warn(`[farmline] index migration could not run for ${collection}.${name}: ${e.message}`);
    }
  }
}

// ── FEEDBACK CHAT (the LoopKeeper tester-channel mechanism, farmline-shaped,
// 2026-10-10 — the founder: "Clone the chat feature in LoopKeeper home page and
// place it at header of farmline home (shamba) page, so that it opens and any one
// can give feedback, text or images. Assign them persistent id when they try to
// chat"). ANYONE may write — no tester roster, no auth: the persistent FEEDBACK ID
// is the identity, minted once per device and reused forever. The thread is the
// sender's line to HQ; HQ reads and replies under the admin key.
const feedbackChatSchema = new Schema({
  // THE IDENTITY: server-minted, idempotent per deviceId (a re-request returns the
  // same id — one id per device, forever). The binding is the scope check: a send
  // or a read must present the deviceId the id was minted to.
  feedbackId: { type: String, required: true, unique: true, index: true },
  deviceId: { type: String, required: true, unique: true, index: true },
  // READ RECEIPTS both ways (LoopKeeper server 135): senderReadAt on the sender's
  // own read, hqReadAt on the admin inbox fetch — so the sender can see their
  // report has been picked up.
  senderReadAt: { type: Date, default: null },
  hqReadAt: { type: Date, default: null },
  lastMessageAt: { type: Date, default: Date.now, index: true },
}, { timestamps: true });

// The messages are SEPARATE DOCS, not an embedded array: the thread carries photos
// (data URLs), and one document carrying 80 × 300KB would walk into Mongo's doc
// limit. Same shape as the farm↔buyer Message: text OR text+photo, never nothing.
const feedbackMsgSchema = new Schema({
  threadId: { type: Schema.Types.ObjectId, ref: 'FeedbackChat', required: true, index: true },
  from: { type: String, enum: ['sender', 'hq'], required: true },
  text: { type: String, default: '', maxlength: 2000 },
  photo: { type: String, default: '' },
  at: { type: Date, default: Date.now, index: true },
  // OFFLINE-FIRST idempotency, the Log/Message pattern: the client mints the id, so
  // a replayed send is recognised, never doubled. ABSENT, not '' (the partial index
  // skips missing fields; a '' value would collide on the second send).
  clientId: { type: String, index: true },
}, { timestamps: true });
feedbackMsgSchema.index(
  { threadId: 1, clientId: 1 },
  { unique: true, partialFilterExpression: { clientId: { $type: 'string', $gt: '' } } },
);

// ── META COUNTERS (Task 3, 2026-10-10) — the tiny counters that must outlive a
// restart, keyed by day: `vision-demo` counts the demo farm's successful vision
// model calls today, exposed at /health + /meta/vision-spend and alarmed at the
// threshold by the zyppar CommandCenter's Farmline Wire.
const metaCounterSchema = new Schema({
  key: { type: String, required: true, unique: true, index: true },
  day: { type: String, default: '' },     // the UTC day the count belongs to
  count: { type: Number, default: 0 },
}, { timestamps: true });

// ── RATINGS (Task 6, 2026-10-10 — the founder: "an intuitive ratings bar — Rate
// Farmline, backend persisted, truthful, and live — inside the top section of the
// Feedback chat interface, sticky"): ONE current rating per identity (the FL-
// feedback id from Task 5's mint — the sheet's native identity), the latest wins;
// the history is kept for the trend (capped). The aggregate (count + average) is
// served at the public /meta/rating — the truth law: the real stored average,
// honestly rounded; an unrated world answers count 0 and NO average.
const ratingSchema = new Schema({
  identity: { type: String, required: true, unique: true, index: true },
  value: { type: Number, required: true, min: 1, max: 5 },
  at: { type: Date, default: Date.now },
  history: [{ value: { type: Number, min: 1, max: 5 }, at: { type: Date, default: Date.now } }],
}, { timestamps: true });

// ── THE ZU CLAIM (2026-10-11 — the money doctrine's ONE door) ────────────────
// The doctrine (D:\TODOs\farmline-zu-doctrine-20261011.md): Farmline sells only
// ZU, money moves only user → Farmline, and there is NO payment provider in the
// path — a provider, if ever added, automates confirmation and nothing else.
//
// So a top-up is a CLAIM, then a FACT:
//   · the farmer pays US directly (our published collection details) and files a
//     claim with the reference he was given → status 'claimed' → credits NOTHING;
//   · the operator checks it against our own account and CONFIRMS → the ZU is
//     credited through the ledger and the row keeps the reference as the receipt.
// A claim is a request to be checked. It is never money, and it never becomes
// money without a human on our side saying so.
const zuClaimSchema = new Schema({
  farmId: { type: Schema.Types.ObjectId, ref: 'Farm', required: true, index: true },
  memberId: { type: Schema.Types.ObjectId, ref: 'Member', default: null },
  packId: { type: String, default: '' },
  zu: { type: Number, required: true, min: 1 },       // the ZU being claimed for
  usd: { type: Number, default: 0 },                  // the receipt's USD reference, never a price
  method: { type: String, default: '' },              // free text, the payer's own words
  reference: { type: String, default: '' },           // THE receipt — what we match against
  note: { type: String, default: '', maxlength: 400 },
  status: { type: String, enum: ['claimed', 'confirmed', 'rejected'], default: 'claimed', index: true },
  decidedBy: { type: String, default: '' },
  decidedAt: { type: Date, default: null },
  reason: { type: String, default: '' },              // on reject — the honest why
}, { timestamps: true });
zuClaimSchema.index({ farmId: 1, status: 1 });

// ── THE VISITOR IDENTITY (2026-10-20, the Zyppar guest model, farmline-shaped —
// the founder: "How are we identifying Farmline users — by deviceId or ip? That
// is an architecture we need to normalize, fast"; then: "Look at Zyppar's
// handling of isGuest users and refresh your advice... Do it. Provide for
// migration of current users"): A VISITOR IS A USER. One identity class; isGuest
// marks the registration CADRE, never a quality rank (the charter's law).
//   · deviceId — THE device↔identity binding, unique, the resolution key (the
//     Zyppar shape: body deviceId → the farmline_device cookie → mint fresh).
//   · feedbackId — the FL- id this identity owns (the feedback silo JOINS the
//     identity here — the migration path for every existing install).
//   · memberId / customerId — the conversion links: when the visitor registers
//     (farmer) or mints (customer), the SAME identity flips isGuest:false and
//     gains the account — the visit ledger's history flows into the account's
//     history. IP can never buy this join.
// The visit ledger keys its rows on this id (ip stays as the secondary signal —
// geo, abuse forensics, crawlers — masked at display, as the wire already does).
const identitySchema = new Schema({
  deviceId: { type: String, required: true, unique: true, index: true },
  isGuest: { type: Boolean, default: true },
  feedbackId: { type: String, default: '', index: true },
  memberId: { type: Schema.Types.ObjectId, ref: 'Member', default: null },
  customerId: { type: Schema.Types.ObjectId, ref: 'Customer', default: null },
  locale: { type: String, default: '' },
  tz: { type: String, default: '' },
  countryHint: { type: String, default: '' },
  lastSeenAt: { type: Date, default: Date.now },
  lastSrc: { type: String, default: '', maxlength: 24 },   // the identity's last channel tag
  metadata: { botMint: { type: Boolean, default: false }, crawlerName: { type: String, default: '' } },
}, { timestamps: true });

module.exports = {
  conn,
  migrateLegacyIndexes,
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
  Conversation: conn.model('Conversation', conversationSchema),
  Message: conn.model('Message', messageSchema),
  FeedbackChat: conn.model('FeedbackChat', feedbackChatSchema),
  FeedbackMsg: conn.model('FeedbackMsg', feedbackMsgSchema),
  MetaCounter: conn.model('MetaCounter', metaCounterSchema),
  Rating: conn.model('Rating', ratingSchema),
  ZuClaim: conn.model('ZuClaim', zuClaimSchema),
  VisitorIdentity: conn.model('VisitorIdentity', identitySchema),
};
