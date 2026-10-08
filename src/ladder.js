// src/ladder.js — THE LADDER.
//
// Seven rungs. Three are FREE and form the foundation — the farmer's actual work.
// Four are PAID and form the commercial ladder.
//
// ┌── FOUNDATION (free, forever) ─────────────────────────────────────────────┐
// │ 0 FARM     What do I do today?                                            │
// │ 1 RECORD   What actually happened?                                        │
// │ 2 SHARPEN  What's working, what isn't?                                    │
// ├── THE COMMERCIAL LADDER (4 layers, paid) ─────────────────────────────────┤
// │ 3 VERDICT  Can this pay me?              KES   300/mo                     │
// │ 4 PLAN     How do I get there?           KES   700/mo                     │
// │ 5 OPERATE  Run it without standing in it KES 1,500/mo                     │
// │ 6 COMMERCE Scale and finance it          KES 3,000+/mo                    │
// └───────────────────────────────────────────────────────────────────────────┘
//
// Two rules this file exists to enforce:
//
//  A) THE FREE RUNGS MUST BE GENUINELY GOOD. A hobby farmer can live on rungs 0–2
//     forever and never pay. That is not a leak — it is the distribution model.
//     If the free tier is a teaser, the product dies by word of mouth.
//
//  B) FARM LINE DECIDES READINESS; THE FARMER DECIDES ACCEPTANCE. Readiness is
//     computed from the farm's own data. Nothing is ever charged silently, and a
//     farm that stops providing data is DOWNGRADED, not billed.
const { term } = require('./vocab');

const RUNGS = [
  {
    rung: 0, id: 'farm', free: true, priceKES: 0,
    name: { sw: 'SHAMBA', en: 'FARM' },
    question: { sw: 'Nifanye nini leo?', en: 'What do I do today?' },
    // What the farmer GIVES — the data contract.
    gives: {
      sw: ['Weka plots, wanyama na mazao', 'Rekodi kwa sekunde 20 kwa siku', 'Hakuna ruhusa inahitajika'],
      en: ['Set up plots, animals and crops', 'Log in about 20 seconds a day', 'No permissions needed at all'],
    },
    // What the farmer GETS.
    gets: {
      sw: ['Orodha ya kazi ya leo', 'Ratiba ya dawa, minyoo na kuua kupe', 'Vikumbusho vya kupanda na kuvuna'],
      en: ["Today\'s work list", 'Spray, deworming and vaccination schedule', 'Planting and harvest reminders'],
    },
    // THE AI LADDER (the founder, 2026-10-08: the Tiers 1-3 services live in
    // the rungs — users and investors aspire, the build follows the ladder).
    ai: {
      sw: ['Uliza farmline chochote kuhusu rekodi zako — kwa maneno rahisi', 'Taarifa ya mwezi kutoka farmline: shamba lako linasema nini'],
      en: ['Ask farmline anything about your own records — in plain words', 'A monthly note from farmline: what your farm is telling you'],
    },
    commitment: { sw: 'Sekunde 20 kwa siku', en: '20 seconds a day' },
  },
  {
    rung: 1, id: 'record', free: true, priceKES: 0,
    name: { sw: 'KUMBUKUMBU', en: 'RECORD' },
    question: { sw: 'Nini kilitokea kweli?', en: 'What actually happened?' },
    gives: {
      sw: ['Endelea kurekodi', 'Rekodi mauzo kwa sentensi moja'],
      en: ['Keep logging', 'Record a sale in one sentence'],
    },
    gets: {
      sw: ['Historia ya maziwa, mayai, mavuno', 'Muhtasari wa mwezi kwa lugha rahisi'],
      en: ['Milk, egg and harvest history', 'A plain-language month summary'],
    },
    // THE AI LADDER (the founder, 2026-10-08: the Tiers 1-3 services live in
    // the rungs — users and investors aspire, the build follows the ladder).
    ai: {
      sw: ['Rekodi zako zinazungumzwa — sauti zinakuwa mabano', 'Namba za shamba zinaelezwa, si kuonyeshwa tu'],
      en: ['Your records, spoken back to you — voice notes become entries', 'The farm\'s numbers explained, never just shown'],
    },
    commitment: { sw: 'Dakika 10 kwa wiki inatosha', en: '10 minutes a week is enough' },
  },
  {
    rung: 2, id: 'sharpen', free: true, priceKES: 0,
    name: { sw: 'BAINISHA', en: 'SHARPEN' },
    question: { sw: 'Kipi kinafaa, kipi hakifai?', en: "What's working, what isn't?" },
    gets: {
      sw: ['Kinachobaki kwa kila lita, tray na gunia', 'Mlinganisho wa ekari: mahindi vs napier'],
      en: ["What\'s left from each litre, tray and bag", 'The acre question: maize vs napier'],
    },
    gives: {
      sw: ['Rekodi gharama kwa maneno rahisi ("nilinunua mbolea 6,000")'],
      en: ['Record a cost in plain words ("bought fertiliser 6,000")'],
    },
    // THE AI LADDER (the founder, 2026-10-08: the Tiers 1-3 services live in
    // the rungs — users and investors aspire, the build follows the ladder).
    ai: {
      sw: ['Swali la ekari linajibiwa na data yako mwenyewe', 'Kilichofanya kazi na kisichofanya — linasomwa kwenye rekodi zako, si kutabiriwa'],
      en: ['The acre question answered by your own data', 'What worked and what didn\'t — read from your records, not guessed'],
    },
    commitment: { sw: 'Dakika 15 kwa wiki', en: '15 minutes a week' },
  },

  // ── THE COMMERCIAL LADDER — 4 layers ────────────────────────────────────────
  {
    rung: 3, id: 'verdict', free: false, priceKES: 300, layer: 1,
    name: { sw: 'JIBU', en: 'VERDICT' },
    question: { sw: 'Je, shamba linaweza kunilipa?', en: 'Can this pay me?' },
    gets: {
      sw: ['Nafasi kati ya mapato unayohitaji na faida ya shamba', 'Kipimo cha muda wa fedha zako', 'Orodha ya hatua zilizopangwa kwa KES'],
      en: ['The gap between what you need and what the farm makes', 'How many months of expenses your farm cash covers', 'Ranked actions, each with a KES figure'],
    },
    gives: {
      sw: ['Kipato unachohitaji (mshahara + bajeti)', 'Msimu wote wa miezi 12 (pamoja na karo)', 'Kurekodi mara kwa mara', 'Dakika 15 kwa mwezi kupitia'],
      en: ['The income you need (salary + household budget)', 'A 12-month profile (school fees included)', 'Keeping the record going', '15 minutes a month to review'],
    },
    // THE AI LADDER (the founder, 2026-10-08: the Tiers 1-3 services live in
    // the rungs — users and investors aspire, the build follows the ladder).
    ai: {
      sw: ['Rekodi za kila siku kwa sauti — maziwa, mayai na mavuno, unazungumza si kuandika', 'AI Vision: piga pua mnyama mgonjwa au zao linaloharibika, upate ushauri wa afisa wa ugawaji', 'Barua ya wiki kutoka kwa akili ya farmline: shamba lako linasema nini', 'Piga pua risiti au slipi ya coop — inakuwa rekodi'],
      en: ['Your daily records by voice — milk, eggs and harvest, spoken not typed', 'AI Vision: photograph a sick animal or a troubled crop, get the extension officer\'s read', 'A weekly letter from farmline\'s intelligence: what your farm is telling you', 'Photograph a receipt or a coop slip — it becomes a record'],
    },
    commitment: { sw: 'Dakika 15 kwa mwezi', en: '15 minutes a month' },
    requires: { confidence: 'medium' },
  },
  {
    rung: 4, id: 'plan', free: false, priceKES: 700, layer: 2,
    name: { sw: 'MPANGO', en: 'PLAN' },
    question: { sw: 'Nifanyeje kufika huko?', en: 'How do I get there?' },
    gets: {
      sw: ['Mpango wa mtaji na muda wa kurudi', 'Ushauri wa wapi kuweka ekari, mifugo na pesa', 'Mwaka wako utaendaje — mwezi kwa mwezi', 'Tahadhari za bei'],
      en: ['A capital plan with payback times', 'Where to put your acre, your animals and your money', 'How the year will go, month by month', 'Market price alerts'],
    },
    gives: {
      sw: ['Gharama za vitu unavyotaka kununua', 'Ekari na msimu wa kila shamba', 'Kupanga vs yaliyotokea'],
      en: ['Costs of what you plan to buy', 'Acres and seasons for each plot', 'Plan versus what actually happened'],
    },
    // THE AI LADDER (the founder, 2026-10-08: the Tiers 1-3 services live in
    // the rungs — users and investors aspire, the build follows the ladder).
    ai: {
      sw: ['Taarifa ya kila siku ya AI: kilichotokea, kimaanisha nini, nifanye nini', 'Uchunguzi wa kundi kwa pua — idadi ikilinganishwa na rekodi zako', 'Bei za soko za eneo lako, zikisomwa dhidi ya mavuno yako', 'Rekodi za sausi bila kikomo'],
      en: ['The daily AI brief: what happened, what it means, what to do', 'Herd audits by photo — the count checked against your records', 'Market prices for your area, read against your harvest', 'Voice records without a cap'],
    },
    commitment: { sw: 'Dakika 20 kwa mwezi', en: '20 minutes a month' },
    requires: { confidence: 'high' },
  },
  {
    rung: 5, id: 'operate', free: false, priceKES: 1500, layer: 3,
    name: { sw: 'ENDESHA', en: 'OPERATE' },
    question: { sw: 'Nifanyeje bila mimi kuwepo kila siku?', en: 'How do I run it without standing in it?' },
    gets: {
      sw: ['Kila mnyama kwa jina lake', 'Kazi kwa wafanyakazi, na kufuatilia', 'Dashibodi ya mbali', 'Rekodi za mifugo na afya'],
      en: ['Every animal by name', 'Tasks assigned to workers, with follow-up', 'A dashboard you can read from anywhere', 'Herd and health records'],
    },
    gives: {
      sw: ['Wafanyakazi na majukumu yao', 'Kuweka kazi kila siku'],
      en: ['Your workers and their roles', 'Assigning the day\'s work'],
    },
    // THE AI LADDER (the founder, 2026-10-08: the Tiers 1-3 services live in
    // the rungs — users and investors aspire, the build follows the ladder).
    ai: {
      sw: ['Afisa wa ugawaji wa AI mfukoni mwako — anajua historia ya shamba lako', 'Ratiba zinazotambua hali ya hewa: mvua ikisomwa dhidi ya mpango wako', 'Kasi ya kipekee kwa kila pua na kila swali'],
      en: ['The AI extension officer in your pocket — it knows your farm\'s history', 'Weather-aware schedules: the rain read against your plan', 'Priority compute for every photo and every question'],
    },
    commitment: { sw: 'Kila siku', en: 'Daily' },
  },
  {
    rung: 6, id: 'commerce', free: false, priceKES: 3000, layer: 4,
    name: { sw: 'BIASHARA', en: 'COMMERCE' },
    question: { sw: 'Nikue na nipate mkopo vipi?', en: 'How do I scale and finance it?' },
    gets: {
      sw: ['Kifurushi cha benki/SACCO', 'Alama ya kukopesheka', 'Shamba kadhaa pamoja', 'Wanunuzi na mikataba'],
      en: ['A bank/SACCO pack', 'A credit-readiness score', 'Several farms together', 'Buyers and contracts'],
    },
    gives: {
      sw: ['Rekodi kamili za fedha', 'Nyaraka na mikataba'],
      en: ['Complete financial records', 'Documents and contracts'],
    },
    // THE AI LADDER (the founder, 2026-10-08: the Tiers 1-3 services live in
    // the rungs — users and investors aspire, the build follows the ladder).
    ai: {
      sw: ['Duka linalozungumza: maswali ya wanaunuzi yanajibiwa kutoka kwa data halisi ya shamba lako', 'Mtandao wa tahadhari ya mapema: wadudu na magonjwa yaliyoonekana karibi nawe, wewe ndiye kwanza kujua', 'Wa kwanza kwenye kila akili mpya inayotoka farmline'],
      en: ['A shop that talks: buyers\' questions answered from your farm\'s real data', 'The early-warning network: pests and diseases seen near you, flagged to you first', 'First in line for every new intelligence farmline ships'],
    },
    commitment: { sw: 'Kuendelea', en: 'Continuous' },
  },
];

const FOUNDATION = RUNGS.filter((r) => r.free);
const COMMERCIAL = RUNGS.filter((r) => !r.free);   // the 4 paid layers

function byId(id) { return RUNGS.find((r) => r.id === id) || null; }

/**
 * READINESS — the self-deciding engine.
 *
 * Four inputs, exactly as the spec says: completeness, evidence, signal, relevance.
 * farmline computes whether the NEXT rung is warranted; it never assumes the
 * farmer knows. Returns the current rung, the recommendation, and — this matters
 * most — the specific gaps standing in the way, so the landing screen can be
 * honest rather than salesy.
 */
function readiness(facts = {}) {
  const {
    logs30d = 0, daysOfHistory = 0, sellables = 0, plots = 0,
    animalGroups = 0, cropCycles = 0, treatmentsLogged = 0,
    hasRequiredIncome = false, confidence = 'low',
    orderCount = 0, completedOrders = 0,
  } = facts;

  const gaps = [];
  const dataPresent = logs30d >= 3 && (animalGroups + cropCycles + plots) >= 1;

  // Rung 0 → 1: is the farm set up and are they actually logging?
  if (!dataPresent) gaps.push({ for: 'record', en: 'Keep logging for a few days', sw: 'Endelea kurekodi siku chache' });
  // Rung 1 → 2: is there anything to compare?
  if (sellables < 1) gaps.push({ for: 'sharpen', en: 'Add at least one thing you sell, with its price', sw: 'Ongeza kitu kimoja unachouza, na bei yake' });
  if (daysOfHistory < 21) gaps.push({ for: 'sharpen', en: `${daysOfHistory} days of history — 21 unlocks the comparisons`, sw: `Siku ${daysOfHistory} za kumbukumbu — 21 hufungua ulinganisho` });
  // Rung 2 → 3 (VERDICT): the honesty gate. No verdict on thin data.
  if (confidence === 'low') gaps.push({ for: 'verdict', en: 'Confidence is LOW — the verdict needs MEDIUM (about 30 days)', sw: 'Uhakika ni CHINI — jibu linahitaji KATI (siku ~30)' });
  if (!hasRequiredIncome) gaps.push({ for: 'verdict', en: 'Tell us the income the farm must replace', sw: 'Tuambie kipato ambacho shamba linapaswa kuchukua nafasi yake' });

  // Recommend the highest rung whose gates are all satisfied.
  let recommended = 0;
  const openTo = (rungId) => !gaps.some((g) => g.for === rungId);
  if (dataPresent) recommended = 1;
  if (dataPresent && openTo('sharpen')) recommended = 2;
  if (recommended === 2 && openTo('verdict')) recommended = 3;
  if (recommended === 3 && confidence === 'high' && completedOrders >= 3) recommended = 4;

  return {
    recommended,
    gaps,
    // A farm is never pushed more than one rung ahead of what its data supports.
    reason: buildReason({ recommended, logs30d, daysOfHistory, sellables, confidence, orderCount }),
  };
}

function buildReason({ recommended, logs30d, daysOfHistory, sellables, confidence, orderCount }) {
  if (recommended <= 0) return { en: 'Start with your farm — plots, animals, crops. That is the whole first rung.', sw: 'Anza na shamba lako — plots, wanyama, mazao. Hiyo ni hatua ya kwanza yote.' };
  const bits = [`${daysOfHistory} days of records`, `${sellables} things you sell`, `confidence ${confidence.toUpperCase()}`];
  if (orderCount) bits.push(`${orderCount} orders through the shop`);
  return {
    en: `Because: ${bits.join(' · ')}.`,
    sw: `Kwa sababu: ${bits.join(' · ')}.`,
  };
}

/**
 * STALENESS / DOWNGRADE SAFETY.
 * If a farm stops recording, the verdict goes STALE rather than wrong — and after
 * 60 days farmline PAUSES the paid rung rather than billing for something the
 * farmer has stopped using. Retention buys more than the extra month's fee.
 */
function staleness(farm, now = Date.now()) {
  const last = farm?.confidence?.lastLoggedAt ? new Date(farm.confidence.lastLoggedAt).getTime() : 0;
  if (!last) return { stale: true, daysSince: null, action: 'none' };
  const daysSince = Math.floor((now - last) / 86400000);
  if (daysSince >= 60) return { stale: true, daysSince, action: 'pause_and_downgrade' };
  if (daysSince >= 45) return { stale: true, daysSince, action: 'warn' };
  return { stale: false, daysSince, action: 'none' };
}

/** The landing screen for a rung — always these blocks, in this order. */
function landing(rungId, lang = 'en') {
  const r = byId(rungId);
  if (!r) return null;
  return {
    rung: r.rung,
    name: r.name[lang],
    question: r.question[lang],
    free: r.free,
    priceKES: r.priceKES,
    priceLabel: r.free ? term('free', lang) : `KES ${r.priceKES.toLocaleString()}/month`,
    whatYouGet: r.gets[lang] || r.gets.en,
    whatYouGive: r.gives[lang] || r.gives.en,
    commitment: r.commitment[lang],
    aiLadder: (r.ai && (r.ai[lang] || r.ai.en)) || [],
    requires: r.requires || null,
  };
}

module.exports = {
  RUNGS, FOUNDATION, COMMERCIAL, byId, readiness, staleness, landing,
};
