// src/protocols.js — SEED PROTOCOLS.
//
// The schedule engine materialises events from these. The farmer never configures
// an interval; the protocol already knows. A vet or the county can adapt them.
//
// These are the interventions that actually matter on a Kenyan mixed farm, and the
// WITHDRAWAL days are the compliance payload: once deworming is logged, milk is
// held back automatically. That is the feature no competitor has.
//
// Seed data is a starting point, not law. `editable: true` on every entry.

const DAY = 1;
const WEEK = 7;

/** Trigger shapes understood by the schedule engine. */
const TRIGGERS = {
  interval: (days, from = 'last') => ({ type: 'interval', days, from }),
  age: (weeks) => ({ type: 'age', weeks }),
  stage: (daysAfter, anchor = 'service') => ({ type: 'stage', daysAfter, anchor }),
  season: (onset) => ({ type: 'season', onset }),      // 'rain'
  annual: () => ({ type: 'interval', days: 365, from: 'last' }),
};

const PROTOCOLS = {
  // ── CATTLE (dairy or beef) ──────────────────────────────────────────────────
  cattle: [
    { id: 'cattle.spray',      name: 'Kuua kupe (spray/dip)',  en: 'Tick spray / dip',
      trigger: { type: 'interval', days: 7, from: 'last', alternate: { dry: 14 } },
      windowDays: 1, requires: 'anyPerson', costEstimate: 60,
      withdrawal: { milkDays: 0, meatDays: 0 },
      note: '7 days in the wet season, 14 in the dry. Tick control is the single biggest health cost on most farms.' },
    { id: 'cattle.deworm',     name: 'Dawa ya minyoo', en: 'Deworming',
      trigger: { type: 'interval', days: 90, from: 'last' },
      windowDays: 14, requires: 'trained', costEstimate: 350, doseBasis: 'weight',
      withdrawal: { milkDays: 3, meatDays: 14 },
      note: 'Starts a milk hold. The storefront suppresses milk until it clears.' },
    { id: 'cattle.fmd',        name: 'Chanjo ya FMD', en: 'FMD vaccination',
      trigger: { type: 'interval', days: 365, from: 'last' },
      windowDays: 30, requires: 'vet', costEstimate: 150,
      withdrawal: { milkDays: 0, meatDays: 0 },
      note: 'Annual with a 21-day booster. County campaigns sometimes cover this free.' },
    { id: 'cattle.lsd',        name: 'Chanjo ya LSD', en: 'Lumpy skin disease',
      trigger: { type: 'interval', days: 365, from: 'last' }, windowDays: 30, requires: 'vet', costEstimate: 150 },
    { id: 'cattle.anthrax',    name: 'Chanjo ya anthrax', en: 'Anthrax / blackquarter',
      trigger: { type: 'interval', days: 365, from: 'last' }, windowDays: 60, requires: 'vet', costEstimate: 120 },
    { id: 'cattle.hoof',       name: 'Kukata kwato', en: 'Hoof trimming',
      trigger: { type: 'interval', days: 180, from: 'last' }, windowDays: 30, requires: 'trained', costEstimate: 200 },
    { id: 'cattle.weigh',      name: 'Kupima uzito', en: 'Weigh',
      trigger: { type: 'interval', days: 30, from: 'last' }, windowDays: 10, costEstimate: 0, doseBasis: 'weight' },
    { id: 'cattle.service',    name: 'Kupandisha (AI)', en: 'Serve / AI',
      trigger: { type: 'interval', days: 21, from: 'last', when: 'heatDetected' }, windowDays: 1, requires: 'trained', costEstimate: 1500 },
    { id: 'cattle.pd',         name: 'Kuthibitisha mimba', en: 'Pregnancy diagnosis',
      trigger: { type: 'stage', daysAfter: 50, anchor: 'service' }, windowDays: 10, requires: 'vet', costEstimate: 500 },
    { id: 'cattle.dryoff',     name: 'Kumaliza maziwa', en: 'Dry-off',
      trigger: { type: 'stage', daysAfter: 223, anchor: 'service' }, windowDays: 7, costEstimate: 0 },
    { id: 'cattle.calving',    name: 'Kuzaliwa', en: 'Calving',
      trigger: { type: 'stage', daysAfter: 283, anchor: 'service' }, windowDays: 7, costEstimate: 0 },
  ],

  // ── GOATS & SHEEP ───────────────────────────────────────────────────────────
  goats: [
    { id: 'goats.spray',   name: 'Kuua kupe', en: 'Spray / dip', trigger: { type: 'interval', days: 7, from: 'last', alternate: { dry: 14 } }, windowDays: 1, costEstimate: 20 },
    { id: 'goats.deworm',  name: 'Dawa ya minyoo', en: 'Deworming', trigger: { type: 'interval', days: 90, from: 'last' }, windowDays: 14, requires: 'trained', costEstimate: 120, doseBasis: 'weight', withdrawal: { milkDays: 3, meatDays: 14 } },
    { id: 'goats.ppr',     name: 'Chanjo ya PPR', en: 'PPR vaccination', trigger: { type: 'interval', days: 365, from: 'last' }, windowDays: 30, requires: 'vet', costEstimate: 60 },
    { id: 'goats.ccpp',    name: 'Chanjo ya CCPP', en: 'CCPP vaccination', trigger: { type: 'interval', days: 365, from: 'last' }, windowDays: 30, requires: 'vet', costEstimate: 60 },
    { id: 'goats.hoof',    name: 'Kukata kwato', en: 'Hoof trimming', trigger: { type: 'interval', days: 180, from: 'last' }, windowDays: 30, costEstimate: 50 },
    { id: 'goats.weigh',   name: 'Kupima uzito', en: 'Weigh', trigger: { type: 'interval', days: 30, from: 'last' }, windowDays: 10, costEstimate: 0 },
    { id: 'goats.pd',      name: 'Kuthibitisha mimba', en: 'Pregnancy diagnosis', trigger: { type: 'stage', daysAfter: 60, anchor: 'service' }, windowDays: 10, costEstimate: 200 },
    { id: 'goats.kidding', name: 'Kuzaa', en: 'Kidding / lambing', trigger: { type: 'stage', daysAfter: 150, anchor: 'service' }, windowDays: 10, costEstimate: 0 },
    { id: 'goats.wean',    name: 'Kuwatenganisha', en: 'Weaning', trigger: { type: 'stage', daysAfter: 90, anchor: 'birth' }, windowDays: 14, costEstimate: 0 },
  ],

  // ── LAYERS ──────────────────────────────────────────────────────────────────
  layers: [
    { id: 'layers.newcastle1', name: 'Chanjo Newcastle (wiki 1)', en: 'Newcastle (wk 1)', trigger: { type: 'age', weeks: 1 }, windowDays: 2, requires: 'trained', costEstimate: 3 },
    { id: 'layers.gumboro1',   name: 'Chanjo Gumboro (wiki 2)', en: 'Gumboro (wk 2)', trigger: { type: 'age', weeks: 2 }, windowDays: 2, requires: 'trained', costEstimate: 3 },
    { id: 'layers.newcastle2', name: 'Chanjo Newcastle (wiki 4)', en: 'Newcastle (wk 4)', trigger: { type: 'age', weeks: 4 }, windowDays: 2, requires: 'trained', costEstimate: 3 },
    { id: 'layers.fowlpox',    name: 'Chanjo fowl pox (wiki 6)', en: 'Fowl pox (wk 6)', trigger: { type: 'age', weeks: 6 }, windowDays: 3, requires: 'trained', costEstimate: 3 },
    { id: 'layers.newcastle3', name: 'Chanjo Newcastle (wiki 8)', en: 'Newcastle (wk 8)', trigger: { type: 'age', weeks: 8 }, windowDays: 3, requires: 'trained', costEstimate: 3 },
    { id: 'layers.deworm',     name: 'Dawa ya minyoo', en: 'Deworming', trigger: { type: 'interval', days: 60, from: 'last' }, windowDays: 7, costEstimate: 5, withdrawal: { milkDays: 0, meatDays: 0 } },
    { id: 'layers.mites',      name: 'Kutibu utitiri', en: 'Mite / lice treatment', trigger: { type: 'interval', days: 90, from: 'last' }, windowDays: 14, costEstimate: 4 },
    { id: 'layers.boost',      name: 'Chanjo ya nyongeza', en: 'Newcastle booster', trigger: { type: 'interval', days: 90, from: 'last' }, windowDays: 14, costEstimate: 3 },
  ],

  // ── BROILERS (batch) ────────────────────────────────────────────────────────
  broilers: [
    { id: 'broilers.newcastle_ib', name: 'Chanjo Newcastle+IB (siku 7)', en: 'Newcastle + IB (d7)', trigger: { type: 'age', weeks: 1 }, windowDays: 1, costEstimate: 3 },
    { id: 'broilers.gumboro',      name: 'Chanjo Gumboro (siku 14)', en: 'Gumboro (d14)', trigger: { type: 'age', weeks: 2 }, windowDays: 1, costEstimate: 3 },
    { id: 'broilers.closeout',     name: 'Kufunga batch', en: 'Batch close-out', trigger: { type: 'age', weeks: 6 }, windowDays: 7, costEstimate: 0,
      note: 'Closes the batch and surfaces what it actually made per bird.' },
  ],

  // ── PIGS ────────────────────────────────────────────────────────────────────
  pigs: [
    { id: 'pigs.deworm',    name: 'Dawa ya minyoo', en: 'Deworming', trigger: { type: 'interval', days: 90, from: 'last' }, windowDays: 14, costEstimate: 200, doseBasis: 'weight' },
    { id: 'pigs.mange',     name: 'Kutibu mange', en: 'Mange / lice', trigger: { type: 'interval', days: 90, from: 'last' }, windowDays: 14, costEstimate: 150 },
    { id: 'pigs.farrowing', name: 'Kuzalia', en: 'Farrowing', trigger: { type: 'stage', daysAfter: 114, anchor: 'service' }, windowDays: 5, costEstimate: 0 },
  ],

  // ── CROPS ───────────────────────────────────────────────────────────────────
  // Same engine, two subjects: a crop cycle raises its own schedule.
  maize: [
    { id: 'maize.landprep', name: 'Kulima', en: 'Land preparation', trigger: { type: 'stage', daysAfter: -14, anchor: 'planting' }, windowDays: 7, costEstimate: 4000 },
    { id: 'maize.plant',    name: 'Kupanda', en: 'Planting', trigger: { type: 'stage', daysAfter: 0, anchor: 'planting' }, windowDays: 5, costEstimate: 3000 },
    { id: 'maize.dap',      name: 'Mbolea ya DAP', en: 'DAP at planting', trigger: { type: 'stage', daysAfter: 0, anchor: 'planting' }, windowDays: 5, costEstimate: 3500 },
    { id: 'maize.weed1',    name: 'Kupalilia (1)', en: 'First weeding', trigger: { type: 'stage', daysAfter: 21, anchor: 'planting' }, windowDays: 10, costEstimate: 2500 },
    { id: 'maize.can',      name: 'Mbolea ya CAN (top-dress)', en: 'Top-dress with CAN', trigger: { type: 'stage', daysAfter: 35, anchor: 'planting' }, windowDays: 10, costEstimate: 3000,
      note: 'The most commonly missed step on a Kenyan maize plot, and the cheapest yield win.' },
    { id: 'maize.weed2',    name: 'Kupalilia (2)', en: 'Second weeding', trigger: { type: 'stage', daysAfter: 45, anchor: 'planting' }, windowDays: 12, costEstimate: 2500 },
    { id: 'maize.spray',    name: 'Kunyunyiza dawa', en: 'Pest spray (fall armyworm)', trigger: { type: 'stage', daysAfter: 30, anchor: 'planting' }, windowDays: 14, costEstimate: 1800,
      note: 'Scout from week 3. Fall armyworm can take the whole plot.' },
    { id: 'maize.harvest',  name: 'Kuvuna', en: 'Harvest', trigger: { type: 'stage', daysAfter: 110, anchor: 'planting' }, windowDays: 21, costEstimate: 3000 },
  ],
  beans: [
    { id: 'beans.plant',   name: 'Kupanda', en: 'Planting', trigger: { type: 'stage', daysAfter: 0, anchor: 'planting' }, windowDays: 5 },
    { id: 'beans.weed',    name: 'Kupalilia', en: 'Weeding', trigger: { type: 'stage', daysAfter: 21, anchor: 'planting' }, windowDays: 10 },
    { id: 'beans.harvest', name: 'Kuvuna', en: 'Harvest', trigger: { type: 'stage', daysAfter: 90, anchor: 'planting' }, windowDays: 14 },
  ],
  napier: [
    { id: 'napier.plant',  name: 'Kupanda napier', en: 'Plant napier', trigger: { type: 'stage', daysAfter: 0, anchor: 'planting' }, windowDays: 10 },
    { id: 'napier.cut1',   name: 'Kukata (1)', en: 'First cut', trigger: { type: 'stage', daysAfter: 90, anchor: 'planting' }, windowDays: 14,
      note: 'This is where the acre question is answered: napier fed to the cows versus maize sold at market.' },
    { id: 'napier.recut',  name: 'Kukata tena', en: 'Re-cut', trigger: { type: 'interval', days: 60, from: 'last' }, windowDays: 14 },
  ],
  kale: [
    { id: 'kale.transplant', name: 'Kupandikiza', en: 'Transplant', trigger: { type: 'stage', daysAfter: 21, anchor: 'planting' }, windowDays: 7 },
    { id: 'kale.manure',     name: 'Samadi', en: 'Manure / top-dress', trigger: { type: 'stage', daysAfter: 30, anchor: 'planting' }, windowDays: 14 },
    { id: 'kale.pick',       name: 'Kuvuna majani', en: 'Leaf harvest begins', trigger: { type: 'stage', daysAfter: 60, anchor: 'planting' }, windowDays: 14 },
  ],
};

/** All protocols for a species, with the engine's trigger normalised. */
function forSpecies(species) {
  const key = String(species || '').toLowerCase();
  return (PROTOCOLS[key] || []).map((p) => ({ ...p, editable: true, species: key }));
}

/** Every species the seed knows about. */
function speciesList() { return Object.keys(PROTOCOLS); }

module.exports = { PROTOCOLS, TRIGGERS, forSpecies, speciesList };
