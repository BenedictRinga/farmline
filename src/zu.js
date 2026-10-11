// src/zu.js — THE ZU ECONOMY, IN ONE FILE.
//
// THE DOCTRINE (the founder's ruling, 2026-10-11 — see
// D:\TODOs\farmline-zu-doctrine-20261011.md, which is the authority):
//
//   Farmline sells ONE thing — ZU — and ZU unlocks the paid rungs.
//
//   THE RULE BEHIND THE RULE: the test is never which rail, it is WHOSE MONEY.
//   One direction, always into our own account, always for our own service.
//   Farmline is never between a farmer and a buyer, an aggregator or an agency —
//   not for a fee, not for convenience, not temporarily.
//
// WHAT THAT MEANS FOR THIS FILE:
//   · ZU is a prepaid meter for Farmline's OWN features. It is never transferable
//     between accounts, never paid out, never refunded to a third party.
//   · 1 ZU = 1 US cent. The SAME unit Zyppar uses — one vocabulary, one price
//     list, no jurisdictional maths — but a SEPARATE LEDGER WITH NO CONVERSION
//     PATH. The day a ZU bought in one product is spendable in the other,
//     Farmline has rebuilt a payment network by accident.
//   · Prices are expressed in ZU ONLY. No NGN, no KES, no USD price ever reaches
//     a screen or a string. (The KES figures this table was derived from are kept
//     as a comment on the table, for provenance, and for nothing else.)
//   · Money arrives by guidance + claim: we publish OUR collection details, the
//     payer pays us directly, claims it with a reference, and the operator
//     confirms. No provider is required for launch, and no public endpoint that
//     touches money exists. Providers, if ever added, automate the CONFIRMATION
//     step only — never the direction of the money.
//
// THE FOUR RUNG PRICES AND THE FOUR PACK SIZES ARE THE FOUNDER'S NUMBERS.
// They live here, in this one table, so they can be changed without touching a
// line of logic.

const ZU_PER_USD = 100;          // 1 ZU = 1 US cent. The unit. Do not silently move it.
const PERIOD_DAYS = 30;          // a paid rung opens for 30 days, then PAUSES (never auto-bills)

// ── THE FREE DAILY ALLOWANCE — THE REFILL (ported from Zyppar, 2026-10-11) ────
// The founder's ruling: "Port Zyppar's daily allowance." Zyppar's shape
// (usage-tracking.model.ts) is: a FREE DAILY bucket that resets at midnight, then
// paid ZU, and `awardPurchasedZU` credits paid ZU and NEVER refills the free one.
//
// THE ONE FARMLINE DIFFERENCE, and it is deliberate: Zyppar's free bucket is SPENT
// on consumption and does not accumulate. Farmline's allowance ACCUMULATES into the
// ZU balance, because ZU's only job here is to open a paid rung — a bucket that
// cannot accumulate could never reach one, and the allowance would be decoration.
//
// WHAT IT BUYS (the whole point): the impatient farmer gets a LEGITIMATE path to
// the first paid rung that rewards showing up, instead of a shortcut that rewards
// faking. 8 ZU/day reaches VERDICT (240) in 30 days; an active farm gets 12/day and
// reaches it in 20; the Starter pack buys it instantly for $2.49.
//
// It is claimed, not minted silently — one tap a day, the Zyppar `claimTopUp()`
// shape — so the farmer SEES the balance grow, which is the habit we want.
const DAILY_ZU = 8;              // per farm per day (the base allowance)
const DAILY_ZU_ACTIVE = 12;      // for a farm that is actually working (see isActiveFarm)
const ACTIVE_LOGGING_DAYS = 7;   // distinct days logged in the last 30 ⇒ "active"

// ── THE MID-SEASON DOOR (the founder's ruling: "both") ────────────────────────
// BOTH halves, deliberately:
//   · the AI estimate COSTS ZU — he pays for the INSIGHT, which is real value and
//     costs us a real model call;
//   · the door grants a PROVISIONAL rung for PROVISIONAL_DAYS — he gets to FEEL the
//     paid layer, labelled provisional in his own UI, never representable to buyers,
//     and expiring into the honest path (supply the missing real weeks).
// The estimate buys a SCHEDULE. It never buys HISTORY — that is enforced in
// farmFacts (estimated artifacts are excluded from readiness), and it is the line
// that keeps a paid badge from becoming a lie.
const VISION_ZU = 5;             // one answered vision call (a multiple of our cost)
const PROVISIONAL_DAYS = 14;     // how long the mid-season provisional rung stands

/** The day's allowance for a farm. `active` = it has been logging for real. */
function dailyAllowanceFor(active) {
  return active ? DAILY_ZU_ACTIVE : DAILY_ZU;
}

// ── THE PAID RUNGS, PRICED IN ZU ──────────────────────────────────────────────
// Rungs 0–2 (FARM, RECORD, SHARPEN) are free forever — that is the distribution
// model, not a leak. Only these four are sold.
//
// Provenance (internal only — never shown to a user, never in copy):
// the ladder carried KES 300 / 700 / 1,500 / 3,000 per month at ~130 KES/USD,
// i.e. ~231 / ~538 / ~1,154 / ~2,308 ZU at 1¢, rounded to clean steps below.
const RUNG_ZU = {
  verdict: 240,     // rung 3 — VERDICT   (was KES 300/mo)
  plan: 550,        // rung 4 — PLAN      (was KES 700/mo)
  operate: 1150,    // rung 5 — OPERATE   (was KES 1,500/mo)
  commerce: 2300,   // rung 6 — COMMERCE  (was KES 3,000+/mo)
};

// ── THE PACKS ─────────────────────────────────────────────────────────────────
// The small first step is the point: the Starter pack reaches rung 3 exactly, so
// a hobby farmer's first purchase buys something real. The per-ZU rate improves
// as the pack grows (the Zyppar ladder shape). Packs never expire.
const PACKS = [
  { id: 'starter',  name: 'Starter',  zu: 250,  usd: 2.49 },
  { id: 'growth',   name: 'Growth',   zu: 600,  usd: 5.49 },
  { id: 'operate',  name: 'Operate',  zu: 1250, usd: 10.99 },
  // 21.49, not 21.99: at 21.99 the per-ZU rate DIPPED below the Operate pack
  // (113.69 vs 113.74 ZU/USD) — the ladder must never be inverted, and the smoke
  // suite asserts it. The larger pack must always be the better rate.
  { id: 'commerce', name: 'Commerce', zu: 2500, usd: 21.49 },
];

/** The ZU price of a rung id, or null when the rung is free / unknown. */
function priceForRung(rungId) {
  const p = RUNG_ZU[String(rungId || '')];
  return Number.isFinite(p) ? p : null;
}

/** The cheapest pack that covers `zu` — what we show when a balance is short. */
function packFor(zu) {
  const want = Math.max(0, Number(zu) || 0);
  return PACKS.find((p) => p.zu >= want) || PACKS[PACKS.length - 1];
}

/** The USD reference for a ZU amount — for the RECEIPT and the operator's eye.
 *  It is never a price we publish or charge in; the unit is the ZU. */
function usdFor(zu) {
  return Math.round(((Number(zu) || 0) / ZU_PER_USD) * 100) / 100;
}

// ── HOW TO PAY US (the operator's own words, from config — ONE place) ─────────
// When this is empty the door is HONESTLY CLOSED: the app says so, and no claim
// can be filed. We never invent account details in code.
function collectionText() {
  const config = require('./config');
  return String(config.envVar('FARMLINE_ZU_COLLECTION', '') || '').trim();
}

function collectionOpen() {
  return collectionText().length > 0;
}

/** The whole public shape the app needs to render the ZU door. */
function publicShape() {
  return {
    perUsd: ZU_PER_USD,
    periodDays: PERIOD_DAYS,
    packs: PACKS.map((p) => ({ ...p })),
    rungPrices: { ...RUNG_ZU },
    collection: collectionText(),
    open: collectionOpen(),
    // THE REFILL: the daily allowance and what an active farm gets instead. The
    // allowance is claimable even while the door is CLOSED — otherwise, before
    // collection details are published, a farmer would have NO way to get ZU at
    // all and the paid rungs would be unreachable by every route. It never is.
    daily: { base: DAILY_ZU, active: DAILY_ZU_ACTIVE, activeLoggingDays: ACTIVE_LOGGING_DAYS },
    // THE MID-SEASON DOOR: the price of one answered vision call, and how long the
    // provisional rung it opens stands.
    visionZu: VISION_ZU,
    provisionalDays: PROVISIONAL_DAYS,
    // RULING 1 (the founder, 2026-10-12): the vision tier is a STANDALONE
    // SERVICE — the free monthly allowance, then the per-use ZU. The mid-season
    // insight keeps its own VISION_ZU price above.
    visionFreeMonthly: Number(require('./config').envVar('FARMLINE_VISION_FREE_MONTHLY', '5')) || 5,
    visionPerUseZU: Number(require('./config').envVar('FARMLINE_VISION_PER_USE_ZU', '2')) || 2,
    note: '1 ZU is one US cent. Packs never expire. Farmline sells only ZU — we never handle money between a farmer and a buyer.',
  };
}

module.exports = {
  ZU_PER_USD,
  PERIOD_DAYS,
  DAILY_ZU,
  DAILY_ZU_ACTIVE,
  ACTIVE_LOGGING_DAYS,
  VISION_ZU,
  PROVISIONAL_DAYS,
  dailyAllowanceFor,
  PACKS,
  RUNG_ZU,
  priceForRung,
  packFor,
  usdFor,
  collectionText,
  collectionOpen,
  publicShape,
};
