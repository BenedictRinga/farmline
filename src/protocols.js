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

  // ── ANNUAL FIELD & GARDEN CROPS (the founder's full shamba line, 2026-10-06).
  // Convention: `anchor` = the day the cycle STARTS (seedbed sowing or direct
  // planting — the date the farmer enters). Nursery steps count FORWARD from
  // that day (kale's transplant at +21, not −30). Annual crops carry STAGE
  // steps only: intervals advance on completions and would re-arm past harvest.
  // The perennials below may use intervals — their cycles never end.
  potatoes: [
    { id: 'potatoes.landprep', name: 'Kulima', en: 'Land preparation', trigger: { type: 'stage', daysAfter: -14, anchor: 'planting' }, windowDays: 7, costEstimate: 5000 },
    { id: 'potatoes.plant',    name: 'Kupanda (mbegu hai)', en: 'Planting (certified seed)', trigger: { type: 'stage', daysAfter: 0, anchor: 'planting' }, windowDays: 5, costEstimate: 8000,
      note: 'Certified seed is the difference between 8 and 20 bags — sickness rides in on seed.' },
    { id: 'potatoes.earth',    name: 'Kutandika', en: 'Earthing up', trigger: { type: 'stage', daysAfter: 28, anchor: 'planting' }, windowDays: 7, costEstimate: 2500 },
    { id: 'potatoes.blight',   name: 'Kunyunyiza ukulima', en: 'Late blight spray', trigger: { type: 'stage', daysAfter: 40, anchor: 'planting' }, windowDays: 21, costEstimate: 2200,
      note: 'Scout weekly from week 5. Late blight can level the whole shamba in one wet spell.' },
    { id: 'potatoes.harvest',  name: 'Kuvuna', en: 'Harvest', trigger: { type: 'stage', daysAfter: 100, anchor: 'planting' }, windowDays: 21, costEstimate: 4000 },
  ],
  tomatoes: [
    { id: 'tomatoes.sow',        name: 'Kupanda mbegu (tele)', en: 'Sow seedbed', trigger: { type: 'stage', daysAfter: 0, anchor: 'planting' }, windowDays: 3, costEstimate: 800 },
    { id: 'tomatoes.transplant', name: 'Kupandikiza', en: 'Transplant', trigger: { type: 'stage', daysAfter: 25, anchor: 'planting' }, windowDays: 7, costEstimate: 1500 },
    { id: 'tomatoes.stake',      name: 'Kuwekea vitongoji', en: 'Staking', trigger: { type: 'stage', daysAfter: 40, anchor: 'planting' }, windowDays: 10, costEstimate: 2500 },
    { id: 'tomatoes.weed',       name: 'Kupalilia', en: 'Weeding', trigger: { type: 'stage', daysAfter: 35, anchor: 'planting' }, windowDays: 7, costEstimate: 1500 },
    { id: 'tomatoes.dress',      name: 'Mbolea ya CAN', en: 'Side-dress with CAN', trigger: { type: 'stage', daysAfter: 45, anchor: 'planting' }, windowDays: 10, costEstimate: 2500 },
    { id: 'tomatoes.spray',      name: 'Kunyunyiza dawa', en: 'Pest & disease spray', trigger: { type: 'stage', daysAfter: 50, anchor: 'planting' }, windowDays: 30, costEstimate: 2000,
      note: 'Scout twice weekly. Tuta absoluta and blight end seasons early.' },
    { id: 'tomatoes.harvest',    name: 'Kuvuna', en: 'Harvest begins', trigger: { type: 'stage', daysAfter: 80, anchor: 'planting' }, windowDays: 35, costEstimate: 3000,
      note: 'The picking runs in rounds for a month or more — sell ripe the day it is picked.' },
  ],
  cabbage: [
    { id: 'cabbage.sow',        name: 'Kupanda mbegu (tele)', en: 'Sow seedbed', trigger: { type: 'stage', daysAfter: 0, anchor: 'planting' }, windowDays: 5, costEstimate: 500 },
    { id: 'cabbage.transplant', name: 'Kupandikiza', en: 'Transplant', trigger: { type: 'stage', daysAfter: 30, anchor: 'planting' }, windowDays: 5, costEstimate: 1200 },
    { id: 'cabbage.dress',      name: 'Mbolea ya CAN', en: 'Top-dress with CAN', trigger: { type: 'stage', daysAfter: 40, anchor: 'planting' }, windowDays: 10, costEstimate: 2000 },
    { id: 'cabbage.weed',       name: 'Kupalilia', en: 'Weeding', trigger: { type: 'stage', daysAfter: 45, anchor: 'planting' }, windowDays: 7, costEstimate: 1200 },
    { id: 'cabbage.spray',      name: 'Kunyunyiza dawa (DBM)', en: 'Diamond-back moth & aphid spray', trigger: { type: 'stage', daysAfter: 45, anchor: 'planting' }, windowDays: 30, costEstimate: 1500,
      note: 'DBM eats the head from under. Scout the undersides of the leaves.' },
    { id: 'cabbage.harvest',    name: 'Kuvuna', en: 'Harvest (heads)', trigger: { type: 'stage', daysAfter: 70, anchor: 'planting' }, windowDays: 28, costEstimate: 2000 },
  ],
  onion: [
    { id: 'onion.sow',        name: 'Kupanda mbegu (tele)', en: 'Sow seedbed', trigger: { type: 'stage', daysAfter: 0, anchor: 'planting' }, windowDays: 5, costEstimate: 800 },
    { id: 'onion.transplant', name: 'Kupandikiza', en: 'Transplant', trigger: { type: 'stage', daysAfter: 35, anchor: 'planting' }, windowDays: 7, costEstimate: 1500 },
    { id: 'onion.weed',       name: 'Kupalilia', en: 'Weeding', trigger: { type: 'stage', daysAfter: 45, anchor: 'planting' }, windowDays: 10, costEstimate: 1500,
      note: 'Onions lose to weeds faster than almost any crop — thin, shallow, and often.' },
    { id: 'onion.dress',      name: 'Mbolea ya NPK', en: 'Top-dress (NPK)', trigger: { type: 'stage', daysAfter: 50, anchor: 'planting' }, windowDays: 10, costEstimate: 2500 },
    { id: 'onion.spray',      name: 'Kunyunyiza dawa', en: 'Purple blotch & thrips spray', trigger: { type: 'stage', daysAfter: 55, anchor: 'planting' }, windowDays: 30, costEstimate: 1800 },
    { id: 'onion.harvest',    name: 'Kuvuna na kuachia', en: 'Harvest & cure', trigger: { type: 'stage', daysAfter: 105, anchor: 'planting' }, windowDays: 14, costEstimate: 2500,
      note: 'Cure in shade 10–14 days — the cured bulb stores twice as long.' },
  ],
  carrot: [
    { id: 'carrot.sow',     name: 'Kupanda mbegu', en: 'Sow', trigger: { type: 'stage', daysAfter: 0, anchor: 'planting' }, windowDays: 5, costEstimate: 600 },
    { id: 'carrot.thin',    name: 'Kuchimbia wachache', en: 'Thinning', trigger: { type: 'stage', daysAfter: 25, anchor: 'planting' }, windowDays: 10, costEstimate: 800 },
    { id: 'carrot.weed',    name: 'Kupalilia', en: 'Weeding', trigger: { type: 'stage', daysAfter: 30, anchor: 'planting' }, windowDays: 10, costEstimate: 800 },
    { id: 'carrot.dress',   name: 'Mbolea ya juu', en: 'Top-dress', trigger: { type: 'stage', daysAfter: 35, anchor: 'planting' }, windowDays: 10, costEstimate: 1500 },
    { id: 'carrot.harvest', name: 'Kuvuna', en: 'Harvest', trigger: { type: 'stage', daysAfter: 90, anchor: 'planting' }, windowDays: 21, costEstimate: 1500 },
  ],
  spinach: [
    { id: 'spinach.sow',        name: 'Kupanda mbegu (tele)', en: 'Sow seedbed', trigger: { type: 'stage', daysAfter: 0, anchor: 'planting' }, windowDays: 5, costEstimate: 300 },
    { id: 'spinach.transplant', name: 'Kupandikiza', en: 'Transplant', trigger: { type: 'stage', daysAfter: 21, anchor: 'planting' }, windowDays: 7, costEstimate: 800 },
    { id: 'spinach.dress',      name: 'Mbolea ya samadi', en: 'Top-dress (manure/CAN)', trigger: { type: 'stage', daysAfter: 30, anchor: 'planting' }, windowDays: 10, costEstimate: 1000,
      note: 'Feed it every two or three weeks — the leaf is only as good as the last feeding.' },
    { id: 'spinach.pick',       name: 'Kuvuna majani', en: 'Leaf harvest begins', trigger: { type: 'stage', daysAfter: 45, anchor: 'planting' }, windowDays: 45, costEstimate: 800,
      note: 'Pick every 10–14 days; the crop produces for months on that rhythm.' },
  ],
  sweetpotato: [
    { id: 'sweetpotato.landprep', name: 'Kulima na kutandika', en: 'Land prep & mounding', trigger: { type: 'stage', daysAfter: -10, anchor: 'planting' }, windowDays: 7, costEstimate: 3000 },
    { id: 'sweetpotato.plant',    name: 'Kupanda (makende)', en: 'Plant vine cuttings', trigger: { type: 'stage', daysAfter: 0, anchor: 'planting' }, windowDays: 5, costEstimate: 1500 },
    { id: 'sweetpotato.weed',     name: 'Kupalilia', en: 'Weeding', trigger: { type: 'stage', daysAfter: 25, anchor: 'planting' }, windowDays: 10, costEstimate: 1500 },
    { id: 'sweetpotato.lift',     name: 'Kuinua mizizi', en: 'Lift the vines', trigger: { type: 'stage', daysAfter: 45, anchor: 'planting' }, windowDays: 14, costEstimate: 0,
      note: 'Lift and re-bury the runners at the mounds — roots form where vines touch soil.' },
    { id: 'sweetpotato.harvest',  name: 'Kuvuna', en: 'Harvest (roots)', trigger: { type: 'stage', daysAfter: 105, anchor: 'planting' }, windowDays: 21, costEstimate: 3000 },
  ],
  cassava: [
    { id: 'cassava.landprep', name: 'Kulima', en: 'Land preparation', trigger: { type: 'stage', daysAfter: -14, anchor: 'planting' }, windowDays: 10, costEstimate: 4000 },
    { id: 'cassava.plant',    name: 'Kupanda (makati)', en: 'Plant cuttings', trigger: { type: 'stage', daysAfter: 0, anchor: 'planting' }, windowDays: 7, costEstimate: 1500,
      note: 'Healthy 25cm cuttings, three nodes up. Disease rides in on cuttings too.' },
    { id: 'cassava.gap',      name: 'Kujaza pengo', en: 'Gapping (fill misses)', trigger: { type: 'stage', daysAfter: 21, anchor: 'planting' }, windowDays: 10, costEstimate: 500 },
    { id: 'cassava.weed',     name: 'Kupalilia', en: 'Weeding', trigger: { type: 'stage', daysAfter: 45, anchor: 'planting' }, windowDays: 14, costEstimate: 2000 },
    { id: 'cassava.harvest',  name: 'Kuvuna', en: 'Harvest (roots)', trigger: { type: 'stage', daysAfter: 360, anchor: 'planting' }, windowDays: 60, costEstimate: 5000,
      note: '10–12 months for the table kinds; field cassava waits 15 if the price is patient.' },
  ],
  peas: [
    { id: 'peas.landprep', name: 'Kulima', en: 'Land preparation', trigger: { type: 'stage', daysAfter: -10, anchor: 'planting' }, windowDays: 7, costEstimate: 2500 },
    { id: 'peas.plant',    name: 'Kupanda (minji)', en: 'Planting', trigger: { type: 'stage', daysAfter: 0, anchor: 'planting' }, windowDays: 5, costEstimate: 2500 },
    { id: 'peas.stake',    name: 'Kuwekea vitongoji', en: 'Staking (climbers)', trigger: { type: 'stage', daysAfter: 25, anchor: 'planting' }, windowDays: 10, costEstimate: 2000 },
    { id: 'peas.weed',     name: 'Kupalilia', en: 'Weeding', trigger: { type: 'stage', daysAfter: 25, anchor: 'planting' }, windowDays: 10, costEstimate: 1500 },
    { id: 'peas.spray',    name: 'Kunyunyiza dawa (afiidi)', en: 'Aphid & thrips spray', trigger: { type: 'stage', daysAfter: 35, anchor: 'planting' }, windowDays: 14, costEstimate: 1200 },
    { id: 'peas.harvest',  name: 'Kuvuna (makoa)', en: 'Harvest (pods)', trigger: { type: 'stage', daysAfter: 65, anchor: 'planting' }, windowDays: 30, costEstimate: 2000 },
  ],
  groundnut: [
    { id: 'groundnut.landprep', name: 'Kulima', en: 'Land preparation', trigger: { type: 'stage', daysAfter: -10, anchor: 'planting' }, windowDays: 7, costEstimate: 2500 },
    { id: 'groundnut.plant',    name: 'Kupanda (karanga)', en: 'Planting', trigger: { type: 'stage', daysAfter: 0, anchor: 'planting' }, windowDays: 5, costEstimate: 2500 },
    { id: 'groundnut.weed',     name: 'Kupalilia', en: 'Weeding', trigger: { type: 'stage', daysAfter: 21, anchor: 'planting' }, windowDays: 10, costEstimate: 1500 },
    { id: 'groundnut.gypsum',   name: 'Gypsum (muda wa mifuko)', en: 'Gypsum at pegging', trigger: { type: 'stage', daysAfter: 45, anchor: 'planting' }, windowDays: 10, costEstimate: 1800,
      note: 'The pegs drill into the ground to make their pods — calcium at that exact moment fills them.' },
    { id: 'groundnut.scout',    name: 'Kufuatilia rosette', en: 'Rosette & aphid scout', trigger: { type: 'stage', daysAfter: 30, anchor: 'planting' }, windowDays: 30, costEstimate: 1000 },
    { id: 'groundnut.harvest',  name: 'Kuvuna', en: 'Harvest', trigger: { type: 'stage', daysAfter: 100, anchor: 'planting' }, windowDays: 14, costEstimate: 3000,
      note: 'Do not leave pods in wet soil — aflatoxin starts in the field, not the store.' },
  ],
  cowpea: [
    { id: 'cowpea.landprep', name: 'Kulima', en: 'Land preparation', trigger: { type: 'stage', daysAfter: -10, anchor: 'planting' }, windowDays: 7, costEstimate: 2000 },
    { id: 'cowpea.plant',    name: 'Kupanda (kunde)', en: 'Planting', trigger: { type: 'stage', daysAfter: 0, anchor: 'planting' }, windowDays: 5, costEstimate: 1800 },
    { id: 'cowpea.weed',     name: 'Kupalilia', en: 'Weeding', trigger: { type: 'stage', daysAfter: 21, anchor: 'planting' }, windowDays: 10, costEstimate: 1500 },
    { id: 'cowpea.spray',    name: 'Kunyunyiza dawa (afiidi/thrips)', en: 'Aphid & thrips spray', trigger: { type: 'stage', daysAfter: 35, anchor: 'planting' }, windowDays: 14, costEstimate: 1200 },
    { id: 'cowpea.harvest',  name: 'Kuvuna', en: 'Harvest', trigger: { type: 'stage', daysAfter: 75, anchor: 'planting' }, windowDays: 14, costEstimate: 2000 },
  ],
  sorghum: [
    { id: 'sorghum.landprep', name: 'Kulima', en: 'Land preparation', trigger: { type: 'stage', daysAfter: -14, anchor: 'planting' }, windowDays: 10, costEstimate: 3000 },
    { id: 'sorghum.plant',    name: 'Kupanda (mtama)', en: 'Planting', trigger: { type: 'stage', daysAfter: 0, anchor: 'planting' }, windowDays: 5, costEstimate: 1500 },
    { id: 'sorghum.thin',     name: 'Kuchimbia wachache', en: 'Thinning', trigger: { type: 'stage', daysAfter: 21, anchor: 'planting' }, windowDays: 7, costEstimate: 500 },
    { id: 'sorghum.dress',    name: 'Mbolea ya CAN', en: 'Top-dress with CAN', trigger: { type: 'stage', daysAfter: 35, anchor: 'planting' }, windowDays: 10, costEstimate: 2000 },
    { id: 'sorghum.birds',    name: 'Kuvua ndege', en: 'Bird scaring', trigger: { type: 'stage', daysAfter: 80, anchor: 'planting' }, windowDays: 30, costEstimate: 2000,
      note: 'From milk stage the birds decide the yield — post someone, every day, no exceptions.' },
    { id: 'sorghum.harvest',  name: 'Kuvuna', en: 'Harvest', trigger: { type: 'stage', daysAfter: 120, anchor: 'planting' }, windowDays: 21, costEstimate: 2500 },
  ],
  millet: [
    { id: 'millet.landprep', name: 'Kulima', en: 'Land preparation', trigger: { type: 'stage', daysAfter: -10, anchor: 'planting' }, windowDays: 7, costEstimate: 2500 },
    { id: 'millet.plant',    name: 'Kupanda (mawele)', en: 'Planting', trigger: { type: 'stage', daysAfter: 0, anchor: 'planting' }, windowDays: 5, costEstimate: 1200 },
    { id: 'millet.thin',     name: 'Kuchimbia wachache', en: 'Thinning', trigger: { type: 'stage', daysAfter: 14, anchor: 'planting' }, windowDays: 7, costEstimate: 500 },
    { id: 'millet.dress',    name: 'Mbolea ya juu', en: 'Top-dress', trigger: { type: 'stage', daysAfter: 30, anchor: 'planting' }, windowDays: 10, costEstimate: 1500 },
    { id: 'millet.harvest',  name: 'Kuvuna', en: 'Harvest', trigger: { type: 'stage', daysAfter: 90, anchor: 'planting' }, windowDays: 21, costEstimate: 2000 },
  ],
  wheat: [
    { id: 'wheat.landprep', name: 'Kulima', en: 'Land preparation', trigger: { type: 'stage', daysAfter: -14, anchor: 'planting' }, windowDays: 10, costEstimate: 4500 },
    { id: 'wheat.plant',    name: 'Kupanda (seeder)', en: 'Planting (drilled)', trigger: { type: 'stage', daysAfter: 0, anchor: 'planting' }, windowDays: 5, costEstimate: 4000 },
    { id: 'wheat.weed',     name: 'Kupalilia au dawa ya magugu', en: 'Weed control', trigger: { type: 'stage', daysAfter: 25, anchor: 'planting' }, windowDays: 10, costEstimate: 2200 },
    { id: 'wheat.dress',    name: 'Mbolea ya CAN', en: 'Top-dress with CAN', trigger: { type: 'stage', daysAfter: 30, anchor: 'planting' }, windowDays: 10, costEstimate: 3000 },
    { id: 'wheat.rust',     name: 'Kufuatilia (mharadini)', en: 'Rust scout & spray', trigger: { type: 'stage', daysAfter: 40, anchor: 'planting' }, windowDays: 40, costEstimate: 2500,
      note: 'Yellow rust moves through wet spells in days — scout the flag leaf weekly.' },
    { id: 'wheat.harvest',  name: 'Kuvuna', en: 'Harvest', trigger: { type: 'stage', daysAfter: 130, anchor: 'planting' }, windowDays: 14, costEstimate: 5000 },
  ],
  sugarcane: [
    { id: 'sugarcane.landprep', name: 'Kulima na fukwe', en: 'Land prep & furrows', trigger: { type: 'stage', daysAfter: -21, anchor: 'planting' }, windowDays: 14, costEstimate: 18000 },
    { id: 'sugarcane.plant',    name: 'Kupanda (makati)', en: 'Plant setts', trigger: { type: 'stage', daysAfter: 0, anchor: 'planting' }, windowDays: 10, costEstimate: 12000 },
    { id: 'sugarcane.weed1',    name: 'Kupalilia (1)', en: 'First weeding', trigger: { type: 'stage', daysAfter: 30, anchor: 'planting' }, windowDays: 10, costEstimate: 3500 },
    { id: 'sugarcane.dress1',   name: 'Mbolea ya N (1)', en: 'Nitrogen top-dress (1)', trigger: { type: 'stage', daysAfter: 45, anchor: 'planting' }, windowDays: 14, costEstimate: 5000 },
    { id: 'sugarcane.dress2',   name: 'Mbolea ya N (2)', en: 'Nitrogen top-dress (2)', trigger: { type: 'stage', daysAfter: 90, anchor: 'planting' }, windowDays: 14, costEstimate: 5000 },
    { id: 'sugarcane.harvest',  name: 'Kuvuna', en: 'Harvest', trigger: { type: 'stage', daysAfter: 400, anchor: 'planting' }, windowDays: 60, costEstimate: 15000,
      note: '16–18 months for the plant crop. After cutting the stump sprouts the ratoon — feed it and the next cycle is cheaper.' },
  ],

  // ── PERENNIALS (orchard & plantation — intervals are safe here: the cycle
  // never ends). First harvests are STAGE events anchored at planting; the
  // picking rounds that follow live in the note, not in interval machinery.
  avocado: [
    { id: 'avocado.hole',    name: 'Kuchimba shimo na mbolea', en: 'Hole prep & manure', trigger: { type: 'stage', daysAfter: -21, anchor: 'planting' }, windowDays: 10, costEstimate: 800,
      note: 'A 2×2×2ft pit with a wheelbarrow of manure is the tree\u2019s first meal — dig it before the tree arrives.' },
    { id: 'avocado.plant',   name: 'Kupanda / kupandikiza', en: 'Planting / grafting', trigger: { type: 'stage', daysAfter: 0, anchor: 'planting' }, windowDays: 5, costEstimate: 400 },
    { id: 'avocado.mulch',   name: 'Majani na maji', en: 'Mulch & watering', trigger: { type: 'interval', days: 60, from: 'last' }, windowDays: 14, costEstimate: 200,
      note: 'Avocado roots stay shallow — mulch holds their water; the dry season takes young trees.' },
    { id: 'avocado.dress',   name: 'Mbolea ya NPK', en: 'Fertiliser (young tree)', trigger: { type: 'interval', days: 90, from: 'last' }, windowDays: 14, costEstimate: 500 },
    { id: 'avocado.scout',   name: 'Kufuatilia (viwavi, mizizi)', en: 'Pest scout (thrips, root rot)', trigger: { type: 'interval', days: 60, from: 'last' }, windowDays: 14, costEstimate: 300 },
    { id: 'avocado.prune',   name: 'Kupunguza matawi', en: 'Pruning & training', trigger: { type: 'interval', days: 180, from: 'last' }, windowDays: 30, costEstimate: 300 },
    { id: 'avocado.harvest', name: 'Kuvuna mara ya kwanza', en: 'First commercial harvest', trigger: { type: 'stage', daysAfter: 1095, anchor: 'planting' }, windowDays: 60, costEstimate: 0,
      note: 'Grafted trees fruit at about year three. That patience IS the investment — sell Hass from year four.' },
  ],
  banana: [
    { id: 'banana.hole',     name: 'Kuchimba shimo na mbolea', en: 'Hole prep & manure', trigger: { type: 'stage', daysAfter: -21, anchor: 'planting' }, windowDays: 10, costEstimate: 600 },
    { id: 'banana.plant',    name: 'Kupanda (viche vya tishu/vichache)', en: 'Planting (tissue culture / suckers)', trigger: { type: 'stage', daysAfter: 0, anchor: 'planting' }, windowDays: 5, costEstimate: 600 },
    { id: 'banana.desucker', name: 'Kutoa vichache', en: 'Desuckering', trigger: { type: 'interval', days: 45, from: 'last' }, windowDays: 14, costEstimate: 200,
      note: 'Keep three stems per stool — mother, daughter, granddaughter. More stems, thinner bunches.' },
    { id: 'banana.dress',    name: 'Mbolea ya NPK', en: 'Fertiliser (NPK)', trigger: { type: 'interval', days: 60, from: 'last' }, windowDays: 14, costEstimate: 600 },
    { id: 'banana.prop',     name: 'Kuweka miango na kufuta', en: 'Propping & debudding', trigger: { type: 'interval', days: 90, from: 'last' }, windowDays: 21, costEstimate: 300,
      note: 'Prop the bunch side before the wind chooses for you; remove the male bud so the fingers fill.' },
    { id: 'banana.scout',    name: 'Kufuatilia (vdeve, BXW)', en: 'Weevil & BXW scout', trigger: { type: 'interval', days: 45, from: 'last' }, windowDays: 14, costEstimate: 200,
      note: 'Bacterial wilt rides on tools and the male bud — clean tools, remove male flowers early.' },
    { id: 'banana.harvest',  name: 'Kuvuna mkungu', en: 'First bunch harvest', trigger: { type: 'stage', daysAfter: 330, anchor: 'planting' }, windowDays: 60, costEstimate: 0,
      note: 'Bunches from 9–12 months; every stool then cycles its own rounds — cut at three-quarter full.' },
  ],
  mango: [
    { id: 'mango.hole',    name: 'Kuchimba shimo na mbolea', en: 'Hole prep & manure', trigger: { type: 'stage', daysAfter: -21, anchor: 'planting' }, windowDays: 10, costEstimate: 800 },
    { id: 'mango.plant',   name: 'Kupandikiza / kupanda', en: 'Grafting / planting', trigger: { type: 'stage', daysAfter: 0, anchor: 'planting' }, windowDays: 5, costEstimate: 400 },
    { id: 'mango.water',   name: 'Maji na majani', en: 'Watering & mulching', trigger: { type: 'interval', days: 60, from: 'last' }, windowDays: 14, costEstimate: 200 },
    { id: 'mango.dress',   name: 'Mbolea ya NPK', en: 'Fertiliser (young tree)', trigger: { type: 'interval', days: 90, from: 'last' }, windowDays: 14, costEstimate: 500 },
    { id: 'mango.prune',   name: 'Kupunguza matawi', en: 'Pruning', trigger: { type: 'interval', days: 365, from: 'last' }, windowDays: 30, costEstimate: 400,
      note: 'One shape worth more than any spray: open centre, no crossing branches, light reaching every fruit.' },
    { id: 'mango.scout',   name: 'Kufuatilia (anthracnose, nzi)', en: 'Anthracnose & fruit-fly scout', trigger: { type: 'interval', days: 60, from: 'last' }, windowDays: 14, costEstimate: 400 },
    { id: 'mango.harvest', name: 'Kuvuna mara ya kwanza', en: 'First commercial harvest', trigger: { type: 'stage', daysAfter: 1095, anchor: 'planting' }, windowDays: 60, costEstimate: 0 },
  ],
  coffee: [
    { id: 'coffee.hole',   name: 'Kuchimba shimo', en: 'Hole preparation', trigger: { type: 'stage', daysAfter: -30, anchor: 'planting' }, windowDays: 14, costEstimate: 600 },
    { id: 'coffee.plant',  name: 'Kupanda', en: 'Planting', trigger: { type: 'stage', daysAfter: 0, anchor: 'planting' }, windowDays: 7, costEstimate: 300 },
    { id: 'coffee.mulch',  name: 'Majani', en: 'Mulching', trigger: { type: 'interval', days: 180, from: 'last' }, windowDays: 21, costEstimate: 300 },
    { id: 'coffee.dress',  name: 'Mbolea (NPK/CAN)', en: 'Fertiliser (NPK/CAN)', trigger: { type: 'interval', days: 120, from: 'last' }, windowDays: 14, costEstimate: 900 },
    { id: 'coffee.spray',  name: 'Kunyunyiza (CBD, mharadini)', en: 'CBD & leaf rust spray', trigger: { type: 'interval', days: 60, from: 'last' }, windowDays: 14, costEstimate: 800,
      note: 'Coffee berry disease ends seasons that looked promising — the spray round is the crop.' },
    { id: 'coffee.prune',  name: 'Kupunguza na kutoa vichache', en: 'Pruning & desuckering', trigger: { type: 'interval', days: 365, from: 'last' }, windowDays: 30, costEstimate: 600 },
    { id: 'coffee.pick',   name: 'Kuvuna cherry za nyekundu', en: 'Picking (ripe cherries)', trigger: { type: 'stage', daysAfter: 730, anchor: 'planting' }, windowDays: 30, costEstimate: 0,
      note: 'First crop at about year two. Then rounds every 2–3 weeks — pick ONLY the red cherry; a green one poisons the batch.' },
  ],
  tea: [
    { id: 'tea.landprep', name: 'Kulima na mashimo', en: 'Land prep & pitting', trigger: { type: 'stage', daysAfter: -21, anchor: 'planting' }, windowDays: 14, costEstimate: 9000 },
    { id: 'tea.plant',    name: 'Kupanda (miche)', en: 'Planting (seedlings)', trigger: { type: 'stage', daysAfter: 0, anchor: 'planting' }, windowDays: 10, costEstimate: 6000 },
    { id: 'tea.mulch',    name: 'Majani', en: 'Mulching', trigger: { type: 'stage', daysAfter: 21, anchor: 'planting' }, windowDays: 14, costEstimate: 1500 },
    { id: 'tea.dress',    name: 'Mbolea ya NPK', en: 'Fertiliser (NPK)', trigger: { type: 'interval', days: 90, from: 'last' }, windowDays: 14, costEstimate: 2500 },
    { id: 'tea.prune',    name: 'Kupunguza', en: 'Pruning', trigger: { type: 'interval', days: 365, from: 'last' }, windowDays: 30, costEstimate: 2000,
      note: 'The plucking table only stays level if the prune comes on time — a late prune lowers every future round.' },
    { id: 'tea.pick',     name: 'Kuvuna majani mawili na foli', en: 'Plucking (two and a bud)', trigger: { type: 'stage', daysAfter: 900, anchor: 'planting' }, windowDays: 60, costEstimate: 0,
      note: 'First pluck at about 2½–3 years. The round is then every 10–14 days — two leaves and a bud, always.' },
  ],
  passion: [
    { id: 'passion.hole',    name: 'Kuchimba shimo na mbolea', en: 'Hole prep & manure', trigger: { type: 'stage', daysAfter: -21, anchor: 'planting' }, windowDays: 10, costEstimate: 600 },
    { id: 'passion.plant',   name: 'Kupanda (miche)', en: 'Planting (seedlings)', trigger: { type: 'stage', daysAfter: 0, anchor: 'planting' }, windowDays: 5, costEstimate: 300 },
    { id: 'passion.trellis', name: 'Kuwekea nguzo na waya', en: 'Trellising', trigger: { type: 'stage', daysAfter: 30, anchor: 'planting' }, windowDays: 14, costEstimate: 4000 },
    { id: 'passion.train',   name: 'Kuongoza na kupunguza', en: 'Training & pruning', trigger: { type: 'interval', days: 60, from: 'last' }, windowDays: 14, costEstimate: 400 },
    { id: 'passion.dress',   name: 'Mbolea (NPK/CAN)', en: 'Fertiliser (NPK/CAN)', trigger: { type: 'interval', days: 90, from: 'last' }, windowDays: 14, costEstimate: 700 },
    { id: 'passion.scout',   name: 'Kufuatilia (woodiness)', en: 'Disease scout (woodiness virus)', trigger: { type: 'interval', days: 60, from: 'last' }, windowDays: 14, costEstimate: 300,
      note: 'Woodiness virus has no cure — pull infected vines whole, and control the aphids that carry it.' },
    { id: 'passion.harvest', name: 'Kuvuna mara ya kwanza', en: 'First harvest', trigger: { type: 'stage', daysAfter: 300, anchor: 'planting' }, windowDays: 60, costEstimate: 0,
      note: 'Grafted passion drops its first fruit at 8–10 months, then rounds every few days in season.' },
  ],
  papaya: [
    { id: 'papaya.hole',    name: 'Kuchimba shimo na mbolea', en: 'Hole prep & manure', trigger: { type: 'stage', daysAfter: -21, anchor: 'planting' }, windowDays: 10, costEstimate: 300 },
    { id: 'papaya.plant',   name: 'Kupanda (miche)', en: 'Planting (seedlings)', trigger: { type: 'stage', daysAfter: 0, anchor: 'planting' }, windowDays: 5, costEstimate: 200 },
    { id: 'papaya.thin',    name: 'Kutoa dume', en: 'Thinning (remove male trees)', trigger: { type: 'stage', daysAfter: 60, anchor: 'planting' }, windowDays: 14, costEstimate: 0,
      note: 'One male per ten females is enough. The males make pollen, not fruit — and they take the water.' },
    { id: 'papaya.dress',   name: 'Mbolea (NPK/samadi)', en: 'Fertiliser (NPK/manure)', trigger: { type: 'interval', days: 60, from: 'last' }, windowDays: 14, costEstimate: 400 },
    { id: 'papaya.harvest', name: 'Kuvuna mara ya kwanza', en: 'First harvest', trigger: { type: 'stage', daysAfter: 270, anchor: 'planting' }, windowDays: 90, costEstimate: 0,
      note: 'Fruit from 9–10 months, then almost weekly for years — the fastest orchard money there is.' },
  ],
  pineapple: [
    { id: 'pineapple.landprep', name: 'Kulima', en: 'Land preparation', trigger: { type: 'stage', daysAfter: -14, anchor: 'planting' }, windowDays: 10, costEstimate: 4000 },
    { id: 'pineapple.plant',    name: 'Kupanda (vichache)', en: 'Planting (slips/suckers)', trigger: { type: 'stage', daysAfter: 0, anchor: 'planting' }, windowDays: 10, costEstimate: 5000 },
    { id: 'pineapple.weed',     name: 'Kupalilia', en: 'Weeding', trigger: { type: 'stage', daysAfter: 30, anchor: 'planting' }, windowDays: 14, costEstimate: 2000 },
    { id: 'pineapple.dress',    name: 'Mbolea (NPK)', en: 'Fertiliser (NPK)', trigger: { type: 'interval', days: 60, from: 'last' }, windowDays: 14, costEstimate: 1500 },
    { id: 'pineapple.harvest',  name: 'Kuvuna', en: 'Harvest', trigger: { type: 'stage', daysAfter: 540, anchor: 'planting' }, windowDays: 60, costEstimate: 3000,
      note: 'The slip crop fruits at about 18 months; the ratoon that follows is a bonus, not the plan.' },
  ],

  // ── MORE ANIMAL GROUPS — the species gate on POST /farm/:farmId/groups
  // REJECTS a species with no protocol, so these four unlock four picker
  // lines that are hard-blocked today.
  sheep: [
    { id: 'sheep.spray',   name: 'Kuua kupe', en: 'Spray / dip', trigger: { type: 'interval', days: 7, from: 'last', alternate: { dry: 14 } }, windowDays: 1, costEstimate: 20 },
    { id: 'sheep.deworm',  name: 'Dawa ya minyoo', en: 'Deworming', trigger: { type: 'interval', days: 90, from: 'last' }, windowDays: 14, requires: 'trained', costEstimate: 120, doseBasis: 'weight', withdrawal: { milkDays: 3, meatDays: 14 } },
    { id: 'sheep.ppr',     name: 'Chanjo ya PPR', en: 'PPR vaccination', trigger: { type: 'interval', days: 365, from: 'last' }, windowDays: 30, requires: 'vet', costEstimate: 60 },
    { id: 'sheep.et',      name: 'Chanjo ya enterotoxaemia', en: 'Enterotoxaemia (5-in-1) vaccination', trigger: { type: 'interval', days: 365, from: 'last' }, windowDays: 30, requires: 'vet', costEstimate: 80,
      note: 'The sudden-death disease of fattening sheep — the vaccine is cheap insurance against the most expensive loss.' },
    { id: 'sheep.hoof',    name: 'Kukata kwato', en: 'Hoof trimming', trigger: { type: 'interval', days: 180, from: 'last' }, windowDays: 30, costEstimate: 50 },
    { id: 'sheep.weigh',   name: 'Kupima uzito', en: 'Weigh', trigger: { type: 'interval', days: 30, from: 'last' }, windowDays: 10, costEstimate: 0 },
    { id: 'sheep.lambing', name: 'Kuzaa', en: 'Lambing', trigger: { type: 'stage', daysAfter: 150, anchor: 'service' }, windowDays: 10, costEstimate: 0 },
    { id: 'sheep.wean',    name: 'Kuwatenganisha', en: 'Weaning', trigger: { type: 'stage', daysAfter: 90, anchor: 'birth' }, windowDays: 14, costEstimate: 0 },
  ],
  rabbits: [
    { id: 'rabbits.deworm',   name: 'Dawa ya minyoo', en: 'Deworming', trigger: { type: 'interval', days: 90, from: 'last' }, windowDays: 14, costEstimate: 50 },
    { id: 'rabbits.coccidia', name: 'Kutibu coccidia', en: 'Coccidiosis treatment', trigger: { type: 'interval', days: 90, from: 'last' }, windowDays: 14, costEstimate: 80,
      note: 'Wet hutches raise coccidia — dry floors do more than any drug.' },
    { id: 'rabbits.nestbox',  name: 'Kuweka sanduku la kutagaa', en: 'Nest box in', trigger: { type: 'stage', daysAfter: 27, anchor: 'service' }, windowDays: 2, costEstimate: 0,
      note: 'Day 27 after serving, box in — three days before the litter arrives, never later.' },
    { id: 'rabbits.kindling', name: 'Kujifungua', en: 'Kindling', trigger: { type: 'stage', daysAfter: 31, anchor: 'service' }, windowDays: 3, costEstimate: 0,
      note: 'Gestation is 31 days to the hour almost — check her at dawn and leave the nest alone.' },
    { id: 'rabbits.wean',     name: 'Kuwatenganisha', en: 'Weaning', trigger: { type: 'stage', daysAfter: 56, anchor: 'birth' }, windowDays: 7, costEstimate: 0,
      note: 'Eight weeks off the doe; the doe re-serves the day they leave.' },
  ],
  bees: [
    { id: 'bees.inspect', name: 'Kukagua kwa nundu', en: 'Hive inspection', trigger: { type: 'interval', days: 21, from: 'last' }, windowDays: 5, costEstimate: 0,
      note: 'Every three weeks: queen laying, brood pattern, stores, space. Open the hive on a warm, calm day, briefly.' },
    { id: 'bees.feed',    name: 'Kulisha (ukame)', en: 'Feeding (dry season)', trigger: { type: 'interval', days: 60, from: 'last' }, windowDays: 21, costEstimate: 300,
      note: 'Sugar syrup only when the forage fails — a fed hive is a colony; a starving one is a memory.' },
    { id: 'bees.harvest', name: 'Kuvuna asali', en: 'Honey harvest', trigger: { type: 'interval', days: 120, from: 'last' }, windowDays: 30, costEstimate: 0,
      note: 'Take only capped honey, and leave the brood box its stores — the bees live on what you do not take.' },
  ],
  fish: [
    { id: 'fish.sample',  name: 'Kupima uzito (sampuli)', en: 'Sampling (weigh)', trigger: { type: 'interval', days: 30, from: 'last' }, windowDays: 5, costEstimate: 0,
      note: 'Cast the net, weigh thirty, do the math — feeding rates and harvest dates both come from this number.' },
    { id: 'fish.water',   name: 'Kukagua maji', en: 'Water quality check', trigger: { type: 'interval', days: 14, from: 'last' }, windowDays: 3, costEstimate: 0,
      note: 'Dawn oxygen is the pond\u2019s weakest hour — water that turns suddenly clear is about to flip.' },
    { id: 'fish.harvest', name: 'Kuvuna samaki', en: 'Harvest', trigger: { type: 'stage', daysAfter: 210, anchor: 'stocking' }, windowDays: 45, costEstimate: 0,
      note: 'Tilapia at 6–8 months for the table pond; drain, grade, and restock the same week — empty weeks cost a cycle.' },
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
