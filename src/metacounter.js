// src/metacounter.js — THE TINY COUNTERS THAT MUST OUTLIVE A RESTART
// (Task 3, the founder: "For demo, yes we review. But automate that review to
// trigger alarm at CommandCenter once it reaches a threshold").
//
// The demo vision spend is REAL MONEY (every visitor's photo attempt on the
// advanced-tier demo farm is a billed model call), and a review that lives in
// memory dies with the process. These counters live in the DB (`metacounters`),
// keyed by day — `vision-demo` counts the demo farm's successful model calls
// today; the /health payload and /meta/vision-spend expose it, and the zyppar
// CommandCenter's Farmline Wire alarms at the threshold.
//
// HONEST RACE POSTURE: two concurrent bumps can both read n and write n+1 — a
// lost increment in a demo-counter race harms an alarm by one call and is
// accepted (the comment says so; a stopwatch is not a ledger).
const { MetaCounter } = require('./models');

const DAY_MS = 86400000;

/** The UTC day key the counters are keyed by (the same day everywhere). */
function todayKey(at = new Date()) {
  return new Date(at.getTime() + DAY_MS / 2).toISOString().slice(0, 10);
}

/** +1 on the counter for `key` today; returns the new count. */
async function bump(key, at = new Date()) {
  const day = todayKey(at);
  const rec = await MetaCounter.findOne({ key }).lean();
  if (!rec || rec.day !== day) {
    await MetaCounter.updateOne({ key }, { $set: { day, count: 1 } }, { upsert: true });
    return 1;
  }
  const next = (rec.count || 0) + 1;
  await MetaCounter.updateOne({ key }, { $set: { count: next } });
  return next;
}

/** The count for `key` today (0 when the counter is resting or on an older day). */
async function count(key, at = new Date()) {
  const day = todayKey(at);
  const rec = await MetaCounter.findOne({ key }).lean();
  return rec && rec.day === day ? (rec.count || 0) : 0;
}

module.exports = { todayKey, bump, count };