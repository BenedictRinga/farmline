// src/stages.js — THE MID-SEASON DOOR's pure core (the founder's brief, 2026-10-09:
// "there is an assumption that farmer starts with commencement of crop season, but what
// if not? How do we transit whatever stage crop season is at, into the use of Farmline
// right away").
//
// WHAT LIVES HERE (and why it is pure): the stage table and the back-calculation.
// One question — "When did this crop start?" — three doors. Door 1 (the primary)
// lets the farmer pick how the crop LOOKS today; this module derives those looks from
// the crop's OWN cycle data (the protocol steps in src/protocols.js — nothing
// invented), then back-calculates the planting date from where the picked look sits
// in the cycle. Door 2 (the photograph) resolves through resolveStage(); Door 3
// (start from today) never touches this math — the past is simply never written.
//
// PURE DOMAIN LOGIC, NO HTTP COUPLING (the repo rule) — every input is data, every
// output is data, and `now` is always a parameter so the edges are unit-testable
// (test/integration.js § midseason exercises the first stage, the last stage, a
// wide band's refinement positions, and the unknown-species/unknown-stage refusals).
//
// THE HONESTY SHAPE, up front:
//   · The band boundaries ARE the crop's own protocol day-offsets. The look-words
//     (knee-high, flowering…) are generic growth phases placed by FRACTION OF CYCLE —
//     the crop's own harvest day is the ruler, never an invented calendar.
//   · The back-calculated planting date is an ESTIMATE by construction; every surface
//     that shows it says so (the cycle carries plantedOnEstimated, the events it puts
//     in the past carry status 'estimated' and are confirmation-due, and a dismissed
//     estimate leaves zero trace — the routes in src/index.js enforce all three).
//   · A crop with no stage table (the free-text "Other" crops) gets null from every
//     function here, and the caller degrades to Door 3 with an honest note — never a
//     dead end.

const { PROTOCOLS } = require('./protocols');

const DAY = 86400000;

// ── the class each crop grows in ─────────────────────────────────────────────
// The class decides which LOOK-words the picker offers. 27 crops, seven classes —
// every protocol'd crop is covered; the unit test asserts the coverage so a new
// crop protocol can never silently fall out of the door.
const CROP_CLASS = {
  cereal: ['maize', 'sorghum', 'millet', 'wheat', 'sugarcane'],
  legume: ['beans', 'peas', 'cowpea', 'groundnut'],
  leafy: ['kale', 'spinach'],
  fruitveg: ['tomatoes', 'cabbage', 'onion'],
  root: ['potatoes', 'sweetpotato', 'cassava', 'carrot'],
  tree: ['avocado', 'banana', 'mango', 'coffee', 'tea', 'passion', 'papaya', 'pineapple'],
  grass: ['napier'],
};

// ── the LOOK phases, placed by FRACTION OF CYCLE ─────────────────────────────
// Each entry is [phaseKey, threshold]: a band whose midpoint sits before the
// threshold fraction of the crop's own planting→harvest span wears that look.
// The LAST band is always the harvest window and wears FINAL_KEY.
const PHASES = {
  cereal: [['sprouting', 0.15], ['earlyGrowth', 0.3], ['kneeHigh', 0.45], ['tall', 0.6], ['flowering', 0.72], ['grainFill', 0.9]],
  legume: [['sprouting', 0.15], ['earlyGrowth', 0.3], ['vegetative', 0.5], ['flowering', 0.65], ['podding', 0.85]],
  leafy: [['sprouting', 0.3], ['transplant', 0.45], ['vegetative', 0.78]],
  fruitveg: [['sprouting', 0.2], ['transplant', 0.35], ['vegetative', 0.55], ['flowering', 0.7], ['fruiting', 0.9]],
  root: [['sprouting', 0.15], ['earlyGrowth', 0.3], ['vegetative', 0.55], ['tuberForming', 0.88]],
  tree: [['youngTree', 0.35], ['establishing', 0.75], ['growing', 0.95]],
  grass: [['sprouting', 0.3], ['establishing', 0.8]],
};
const FINAL_KEY = { grass: 'readyToCut' };   // every other class ends at 'harvestReady'

// A band at least this wide (days) offers the refinement — "about how long into
// this stage?" — so the estimate tightens without ever leaving the band.
const WIDE_BAND_DAYS = 28;

function classOf(species) {
  for (const [cls, list] of Object.entries(CROP_CLASS)) {
    if (list.includes(species)) return cls;
  }
  return null;
}

/** The crop's own planting-anchored day offsets, sorted, unique, ≥ 0. */
function cycleDays(species) {
  const days = new Set();
  for (const p of PROTOCOLS[species] || []) {
    const t = p.trigger || {};
    if (t.type === 'stage' && t.anchor === 'planting' && Number.isFinite(t.daysAfter) && t.daysAfter >= 0) {
      days.add(t.daysAfter);
    }
  }
  return [...days].sort((a, b) => a - b);
}

/**
 * THE STAGE TABLE for one crop — derived from its own cycle data, or null when
 * the crop carries no planting-anchored schedule (the honest degrade to Door 3).
 * bands: [{ key, from, to, wide }] — `from` inclusive, `to` exclusive.
 */
function stageTable(species) {
  const cls = classOf(species);
  if (!cls) return null;
  const days = cycleDays(species);
  if (days.length < 1) return null;

  const harvestDay = days[days.length - 1];
  const windows = new Map();
  for (const p of PROTOCOLS[species] || []) {
    const t = p.trigger || {};
    if (t.type === 'stage' && t.anchor === 'planting' && Number.isFinite(t.daysAfter)) {
      windows.set(t.daysAfter, p.windowDays || 7);
    }
  }

  const bands = [];
  for (let i = 0; i < days.length; i++) {
    const from = days[i];
    // The final band is the harvest window itself, plus a week of grace: the crop
    // stands in the field, ready. Every earlier band runs to the next event.
    const to = i < days.length - 1
      ? days[i + 1]
      : from + (windows.get(from) || 14) + 7;
    const mid = (from + to) / 2;
    const f = harvestDay > 0 ? mid / harvestDay : 1;
    let key;
    if (i === days.length - 1) {
      key = FINAL_KEY[cls] || 'harvestReady';
    } else {
      const phases = PHASES[cls] || PHASES.cereal;
      key = phases[phases.length - 1][0];
      for (const [k, threshold] of phases) {
        if (f < threshold) { key = k; break; }
      }
    }
    bands.push({ key, from, to, wide: to - from >= WIDE_BAND_DAYS });
  }
  return { species, cls, bands, harvestDay };
}

/** Every crop the door can serve, keyed by species. */
function stageTableAll() {
  const out = {};
  for (const species of Object.keys(PROTOCOLS)) {
    const t = stageTable(species);
    if (t) out[species] = { bands: t.bands, harvestDay: t.harvestDay };
  }
  return out;
}

/** The day-offset a pick resolves to: 'early' | 'mid' | 'late' inside the band. */
function bandOffset(band, within) {
  const w = band.to - band.from;
  const frac = within === 'early' ? 0.25 : within === 'late' ? 0.75 : 0.5;
  return Math.max(0, Math.round(band.from + w * frac));
}

/**
 * THE BACK-CALCULATION (Door 1's engine) — stage + crop → planting date.
 * Pure: `now` is a parameter. Returns null on an unknown crop or stage (the
 * caller degrades honestly to Door 3 — never a dead end, never a guess).
 */
function backCalculate(species, stageKey, within = 'mid', now = new Date()) {
  const table = stageTable(species);
  if (!table) return null;
  const band = table.bands.find((b) => b.key === stageKey) || null;
  if (!band) return null;
  const offsetDays = bandOffset(band, within);
  const plantedOn = new Date(new Date(now).getTime() - offsetDays * DAY);
  return {
    species, stageKey, within, band,
    offsetDays,
    plantedOn,
    weeksAgo: Math.round((offsetDays / 7) * 10) / 10,
  };
}

/**
 * WHERE DOES A DAY COUNT SIT? (Door 2's bridge) — the vision model estimates
 * "about 4 weeks from planting"; this finds the band that count falls in, so the
 * photo's proposal lands as a pre-picked row in Door 1's list. Clamped: a count
 * beyond the last band resolves into it (the crop is ready; nobody is "past" it).
 */
function resolveStage(species, daysFromPlanting, now = new Date()) {
  const table = stageTable(species);
  if (!table) return null;
  const d = Math.max(0, Number(daysFromPlanting) || 0);
  for (const b of table.bands) {
    if (d >= b.from && d < b.to) return b;
  }
  return table.bands[table.bands.length - 1] || null;
}

/**
 * THE PREVIEW (read-only — nothing writes without the confirm tap): what a
 * mid-season entry WOULD materialise, split by the honesty law. The past steps
 * are the confirmation-due estimates; the future ones land on real dates; the
 * interval steps (perennial care) become baseline questions exactly as they do
 * on the classic path.
 */
function previewFor(species, plantedOn, now = new Date()) {
  const t = new Date(plantedOn);
  if (!Number.isFinite(t.getTime())) return null;
  const estimatedPast = [];
  const upcoming = [];
  let baselines = 0;
  for (const p of PROTOCOLS[species] || []) {
    const tr = p.trigger || {};
    if (tr.type === 'stage' && tr.anchor === 'planting' && Number.isFinite(tr.daysAfter)) {
      const dueOn = new Date(t.getTime() + tr.daysAfter * DAY);
      (dueOn < new Date(now) ? estimatedPast : upcoming)
        .push({ intervention: p.id, en: p.en, dueOn, windowDays: p.windowDays || 7 });
    } else if (tr.type === 'interval') {
      baselines += 1;
    }
  }
  estimatedPast.sort((a, b) => a.dueOn - b.dueOn);
  upcoming.sort((a, b) => a.dueOn - b.dueOn);
  return { species, plantedOn: t, estimatedPast, upcoming, baselines };
}

module.exports = {
  CROP_CLASS, PHASES, FINAL_KEY, WIDE_BAND_DAYS,
  classOf, cycleDays, stageTable, stageTableAll,
  bandOffset, backCalculate, resolveStage, previewFor,
};