// src/schedule.js — THE SCHEDULE ENGINE. The heart of the product.
//
// A farm does not need a to-do list; it needs a GENERATED protocol. This module
// turns protocol templates into concrete, dated work, and turns completed work
// back into records, holds and the next occurrence.
//
// The loop:
//   protocols + subject  →  ScheduledEvent[]   (the farmer's work list)
//   complete(event)      →  Log + Hold + next ScheduledEvent
//
// The Hold is the part that earns its keep: completing a deworming event
// AUTOMATICALLY suppresses milk from sale until the withdrawal clears. Nobody has
// to remember it, which is the only reason it will actually happen.
const { ScheduledEvent, Log, Hold, Animal, AnimalGroup, CropCycle, Plot } = require('./models');
const { forSpecies } = require('./protocols');

const DAY = 86400000;

function addDays(date, n) { return new Date(new Date(date).getTime() + n * DAY); }

/**
 * Materialise the schedule for a subject from its species protocols.
 * `anchor` is the date the clock starts from (birth, planting, or now).
 * Idempotent per (subject, protocol): re-running will not duplicate a pending event.
 */
async function materialise({ farmId, subjectType, subjectId, subjectLabel, species, anchor = new Date(), fromLast = {} }) {
  const protos = forSpecies(species);
  const created = [];

  for (const p of protos) {
    const t = p.trigger || {};
    let dueOn = null;
    let isBaseline = false;

    if (t.type === 'age') {
      dueOn = addDays(anchor, t.weeks * 7);
      // Already past? Skip — an adult animal does not need its week-1 vaccine.
      if (dueOn.getTime() < Date.now() - 30 * DAY) continue;
    } else if (t.type === 'stage') {
      dueOn = addDays(anchor, t.daysAfter);
    } else if (t.type === 'interval') {
      const last = fromLast[p.id] || null;
      if (last) {
        dueOn = addDays(last, t.days);
      } else {
        // NO KNOWN HISTORY. Do not invent a date and do not bury it two weeks out.
        // Surface it once, now, flagged as a baseline to confirm — that is the
        // honest answer, and establishing the baseline IS the first day's work.
        dueOn = new Date(anchor);
        isBaseline = true;
      }
    } else if (t.type === 'season') {
      dueOn = addDays(new Date(), 7);
    }
    if (!dueOn || Number.isNaN(dueOn.getTime())) continue;

    const exists = await ScheduledEvent.findOne({
      farmId, subjectType, subjectId, intervention: p.id, status: { $in: ['due', 'carried'] },
    }).lean();
    if (exists) continue;

    created.push({
      farmId, subjectType, subjectId, subjectLabel,
      intervention: p.id,
      dueOn,
      windowDays: p.windowDays || 7,
      doseBasis: p.doseBasis || '',
      costEstimate: p.costEstimate || 0,
      withdrawal: p.withdrawal || { milkDays: 0, meatDays: 0 },
      status: 'due',
      baseline: isBaseline,
    });
  }

  if (created.length) await ScheduledEvent.insertMany(created);
  return { created: created.length };
}

/**
 * TODAY — the farmer's work list.
 * Anything not done by end of day is quietly CARRIED FORWARD, never nagged.
 * (Spec v3: "nothing is nagged.")
 */
async function today(farmId, { horizonDays = 7 } = {}) {
  const now = new Date();
  const earlier = new Date(now.getTime() - 30 * DAY);   // carry from the last month, not forever
  const horizon = new Date(now.getTime() + horizonDays * DAY);

  // Carry forward anything overdue and still open.
  await ScheduledEvent.updateMany(
    { farmId, status: 'due', dueOn: { $lt: now, $gte: earlier } },
    { $set: { status: 'carried' } },
  );
  // Abandon anything open for longer than a month — a stale list is worse than none.
  await ScheduledEvent.updateMany(
    { farmId, status: { $in: ['due', 'carried'] }, dueOn: { $lt: earlier } },
    { $set: { status: 'skipped' } },
  );

  const open = await ScheduledEvent.find({
    farmId, status: { $in: ['due', 'carried'] }, dueOn: { $lte: horizon },
  }).sort({ dueOn: 1 }).lean();

  const dueToday = [];
  const thisWeek = [];
  const baseline = [];
  for (const e of open) {
    const overdueDays = Math.floor((now - new Date(e.dueOn)) / DAY);
    const row = { ...e, overdueDays: overdueDays > 0 ? overdueDays : 0 };
    // A baseline event is a QUESTION ("when did you last do this?"), not a
    // command. It gets its own bucket so a new farm is not greeted by eleven
    // simultaneous demands — which would read as a chore list, not a farm.
    if (e.baseline) baseline.push(row);
    else if (overdueDays > 0 || new Date(e.dueOn).toDateString() === now.toDateString()) dueToday.push(row);
    else thisWeek.push(row);
  }
  return { dueToday, thisWeek, baseline, counts: { today: dueToday.length, week: thisWeek.length, baseline: baseline.length } };
}

/** A protocol id → its template, so completion knows the withdrawal. */
function findProtocol(species, intervention) {
  return forSpecies(species).find((p) => p.id === intervention) || null;
}

/**
 * COMPLETE — the one-tap that does five things at once:
 *   1. marks the event done
 *   2. writes a Log (the record)
 *   3. opens a Hold if the protocol carries a withdrawal  ← the compliance step
 *   4. schedules the next occurrence for interval protocols
 *   5. stamps the farm's confidence clock
 */
async function complete({ farm, eventId, byMemberId = null, productUsed = '', speciesHint = '' }) {
  const ev = await ScheduledEvent.findOne({ _id: eventId, farmId: farm._id });
  if (!ev) return { ok: false, error: 'not found' };

  const species = speciesHint || guessSpecies(ev.subjectLabel) || '';
  const proto = findProtocol(species, ev.intervention);

  ev.status = 'done';
  ev.doneAt = new Date();
  ev.doneBy = byMemberId;
  ev.productUsed = productUsed || (proto?.en || ev.intervention);
  await ev.save();

  // 2. the record
  const log = await Log.create({
    farmId: farm._id,
    kind: ev.intervention.includes('spray') ? 'spray'
        : ev.intervention.includes('deworm') ? 'treatment'
        : ev.intervention.includes('vacc') || ev.intervention.includes('newcastle')
        || ev.intervention.includes('fmd') || ev.intervention.includes('lsd')
        || ev.intervention.includes('ppr') || ev.intervention.includes('ccpp') ? 'treatment'
        : 'note',
    at: new Date(),
    byMemberId,
    subjectType: ev.subjectType,
    subjectId: ev.subjectId,
    subjectLabel: ev.subjectLabel,
    product: productUsed || ev.intervention,
    note: `from the schedule: ${proto?.en || ev.intervention}`,
    scheduledEventId: ev._id,
  });

  // 3. the hold — the compliance payload.
  // ONE HOLD PER AFFECTED PRODUCT, because the windows genuinely differ: after a
  // dewormer the milk clears in 3 days but the meat does not clear for 14. A
  // single "14 day" hold would either block milk that is already safe or, worse,
  // release meat that is not. Per-product is the only honest shape.
  const w = ev.withdrawal || {};
  const windows = [
    ['milk', w.milkDays || 0],
    ['meat', w.meatDays || 0],
    ['eggs', w.eggDays || 0],
    ['wool', w.woolDays || 0],
  ].filter(([, d]) => d > 0);

  const holds = [];
  for (const [affected, d] of windows) {
    holds.push(await Hold.create({
      farmId: farm._id,
      subjectType: ev.subjectType,
      subjectId: ev.subjectId,
      subjectLabel: ev.subjectLabel,
      product: productUsed || ev.intervention,
      affects: [affected],
      days: d,
      startedAt: new Date(),
      until: addDays(new Date(), d),
      active: true,
      viaEventId: ev._id,
    }));
  }
  const hold = holds[0] || null;   // kept for callers that expect one

  // 4. the next occurrence
  let next = null;
  if (proto?.trigger?.type === 'interval') {
    const existing = await ScheduledEvent.findOne({
      farmId: farm._id, subjectType: ev.subjectType, subjectId: ev.subjectId,
      intervention: ev.intervention, status: { $in: ['due', 'carried'] },
    }).lean();
    if (!existing) {
      next = await ScheduledEvent.create({
        farmId: farm._id, subjectType: ev.subjectType, subjectId: ev.subjectId,
        subjectLabel: ev.subjectLabel, intervention: ev.intervention,
        dueOn: addDays(new Date(), proto.trigger.days),
        windowDays: proto.windowDays || 7,
        doseBasis: proto.doseBasis || '',
        costEstimate: proto.costEstimate || 0,
        withdrawal: proto.withdrawal || { milkDays: 0, meatDays: 0 },
        status: 'due',
      });
    }
  }

  // 5. the confidence clock
  farm.confidence = { ...(farm.confidence || {}), lastLoggedAt: new Date() };
  await farm.save();

  return { ok: true, logId: log._id, hold, holds, nextEventId: next?._id || null };
}

/** Best-effort species from a label — the real system carries it on the subject. */
function guessSpecies(label = '') {
  const s = String(label).toLowerCase();
  if (/cow|ng'?ombe|cattle|heifer|bull/.test(s)) return 'cattle';
  if (/goat|mbuzi|sheep|kondoo/.test(s)) return 'goats';
  if (/layer|kuku|chicken/.test(s)) return 'layers';
  if (/broiler/.test(s)) return 'broilers';
  if (/pig|nguruwe/.test(s)) return 'pigs';
  if (/maize|mahindi/.test(s)) return 'maize';
  if (/bean|maharage/.test(s)) return 'beans';
  if (/napier/.test(s)) return 'napier';
  if (/kale|sukuma/.test(s)) return 'kale';
  return '';
}

/** Set up a whole farm's schedule from its plots, groups and crop cycles. */
async function materialiseFarm(farm) {
  let total = 0;
  const groups = await AnimalGroup.find({ farmId: farm._id, active: true }).lean();
  for (const g of groups) {
    const r = await materialise({
      farmId: farm._id, subjectType: 'group', subjectId: g._id,
      subjectLabel: g.label || g.species, species: g.species, anchor: new Date(),
    });
    total += r.created;
  }
  const cycles = await CropCycle.find({ farmId: farm._id, status: { $in: ['planned', 'growing'] } }).lean();
  for (const c of cycles) {
    const r = await materialise({
      farmId: farm._id, subjectType: 'cropcycle', subjectId: c._id,
      subjectLabel: c.crop, species: c.crop, anchor: c.plantedOn || new Date(),
    });
    total += r.created;
  }
  return { created: total };
}

module.exports = { materialise, materialiseFarm, today, complete, findProtocol, guessSpecies };
