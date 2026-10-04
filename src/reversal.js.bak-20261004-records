// REVERSAL — one pattern, applied to every kind of holding.
//
// WHY THIS FILE EXISTS AS ONE MODULE. The founder asked for "template reversal": the
// ability to undo an input, or all of them, applied CONSISTENTLY. Three entity types with
// three different behaviours would be worse than none — a farmer would have to learn
// which things can be undone and which cannot, and the answer would change per screen.
//
// So every holding behaves identically:
//
//   edit(kind, farmId, id, patch)   correct a mistake (a mistyped count, a wrong date)
//   reverse(kind, farmId, id)       undo it — ARCHIVED, not destroyed
//   restore(kind, farmId, id)       put it back, exactly as it was
//   reversed(kind, farmId)          what is currently undone, so it can be recovered
//
// THREE THINGS THAT MUST BE TRUE, and are why this is not just a delete endpoint:
//
// 1. REVERSAL IS REVERSIBLE. Archiving, never destroying. A hard delete would lose the
//    id, the planting date, and the link from every past log — so "undo" would recreate
//    something that looks right and is subtly a different object.
//
// 2. THE SCHEDULE FOLLOWS. Reversing a holding cancels its FUTURE events. Otherwise the
//    farm keeps being told to spray a herd that no longer exists, and the work list
//    fills with ghosts. PAST events are left alone: they are the record of what actually
//    happened, and erasing them would be editing history.
//
// 3. A PLOT WITH CROPS IN IT IS NOT SILENTLY EMPTIED. Removing a plot that has crops
//    would orphan them — they would vanish from the screen (they are shown under a plot)
//    while still existing. That is data loss by interface. It is refused, with the
//    reason, and the farmer decides what to do about the crops first.
const { Plot, CropCycle, AnimalGroup, ScheduledEvent } = require('./models');
const schedule = require('./schedule');

/** The three kinds, and what makes each one itself. */
const KINDS = {
  groups: {
    model: () => AnimalGroup,
    subjectType: 'group',
    noun: 'animal group',
    /** Editable fields. Anything else in a patch is ignored, not trusted. */
    fields: { label: 'string', count: 'number', productionKind: 'string', species: 'string' },
    speciesOf: (doc) => doc.species,
    labelOf: (doc) => doc.label || doc.species,
  },
  plots: {
    model: () => Plot,
    noun: 'plot',
    fields: { name: 'string', acres: 'number', soil: 'string', water: 'string', notes: 'string' },
    labelOf: (doc) => doc.name,
  },
  crops: {
    model: () => CropCycle,
    subjectType: 'cropcycle',
    noun: 'crop',
    fields: {
      crop: 'string', variety: 'string', acres: 'number', season: 'string',
      plantedOn: 'date', fodderFor: 'string', status: 'string',
    },
    speciesOf: (doc) => doc.crop,
    labelOf: (doc) => doc.crop,
  },
};

function kindOf(kind) {
  const k = KINDS[kind];
  if (!k) throw Object.assign(new Error(`unknown kind: ${kind}`), { status: 400 });
  return k;
}

/** Coerce a patch to the declared fields only. Never trust the shape that arrives. */
function clean(kind, patch) {
  const out = {};
  for (const [name, type] of Object.entries(kind.fields)) {
    if (!(name in (patch || {}))) continue;
    const v = patch[name];
    if (type === 'number') {
      const n = Number(v);
      if (!Number.isFinite(n)) throw Object.assign(new Error(`${name} must be a number`), { status: 400 });
      out[name] = n;
    } else if (type === 'date') {
      out[name] = v ? new Date(v) : null;
    } else {
      out[name] = v == null ? '' : String(v).trim();
    }
  }
  return out;
}

/**
 * Cancel FUTURE scheduled work for a subject. Past events are history and stay.
 * Returns how many were cancelled, so the UI can say what actually happened.
 */
async function cancelFuture(farmId, subjectType, subjectId, now = new Date()) {
  const r = await ScheduledEvent.updateMany(
    { farmId, subjectType, subjectId, status: { $in: ['due', 'carried'] }, dueOn: { $gte: now } },
    { $set: { status: 'skipped' } },
  );
  return r.modifiedCount || 0;
}

/** Fill the future back in. materialise() is idempotent per subject+protocol. */
async function rematerialise(farmId, kind, doc, now = new Date()) {
  if (!kind.subjectType) return 0;
  const built = await schedule.materialise({
    farmId, subjectType: kind.subjectType, subjectId: doc._id,
    subjectLabel: kind.labelOf(doc), species: kind.speciesOf(doc),
    anchor: doc.plantedOn || now,
  });
  return (built && built.created) || 0;
}

/** Correct a mistake. */
async function edit(kindName, farmId, id, patch) {
  const kind = kindOf(kindName);
  const Model = kind.model();
  const doc = await Model.findOne({ _id: id, farmId, archivedAt: null });
  if (!doc) throw Object.assign(new Error(`no such ${kind.noun}`), { status: 404 });

  Object.assign(doc, clean(kind, patch));
  await doc.save();

  // A planting date change moves the whole crop schedule, so the future is rebuilt.
  if (kindName === 'crops' && 'plantedOn' in (patch || {})) {
    await cancelFuture(farmId, kind.subjectType, doc._id);
    await rematerialise(farmId, kind, doc);
  }
  return doc;
}

/** Undo it. Archived, never destroyed. */
async function reverse(kindName, farmId, id) {
  const kind = kindOf(kindName);
  const Model = kind.model();
  const doc = await Model.findOne({ _id: id, farmId, archivedAt: null });
  if (!doc) throw Object.assign(new Error(`no such ${kind.noun}`), { status: 404 });

  // RULE 3: never silently empty a plot.
  if (kindName === 'plots') {
    const crops = await CropCycle.countDocuments({ farmId, plotId: doc._id, archivedAt: null });
    if (crops > 0) {
      throw Object.assign(
        new Error(`this plot still has ${crops} crop${crops === 1 ? '' : 's'} in it. Remove or move them first — removing the plot would hide them from you.`),
        { status: 409 },
      );
    }
  }

  doc.archivedAt = new Date();
  await doc.save();

  // RULE 2: the schedule follows.
  let cancelled = 0;
  if (kind.subjectType) cancelled = await cancelFuture(farmId, kind.subjectType, doc._id);

  return { doc, cancelled };
}

/** Put it back, exactly as it was. */
async function restore(kindName, farmId, id) {
  const kind = kindOf(kindName);
  const Model = kind.model();
  const doc = await Model.findOne({ _id: id, farmId, archivedAt: { $ne: null } });
  if (!doc) throw Object.assign(new Error(`nothing to restore`), { status: 404 });

  // A crop cannot come back into a plot that is itself gone — it would be invisible.
  if (kindName === 'crops' && doc.plotId) {
    const plot = await Plot.findOne({ _id: doc.plotId, farmId, archivedAt: null });
    if (!plot) {
      throw Object.assign(
        new Error('the plot this crop was in has been removed. Restore the plot first.'),
        { status: 409 },
      );
    }
  }

  doc.archivedAt = null;
  await doc.save();
  const added = await rematerialise(farmId, kind, doc);
  return { doc, added };
}

/** What has been undone, so it can be recovered. Newest first. */
async function reversed(farmId, limit = 30) {
  const q = { farmId, archivedAt: { $ne: null } };
  const [groups, plots, crops] = await Promise.all([
    AnimalGroup.find(q).sort({ archivedAt: -1 }).limit(limit).lean(),
    Plot.find(q).sort({ archivedAt: -1 }).limit(limit).lean(),
    CropCycle.find(q).sort({ archivedAt: -1 }).limit(limit).lean(),
  ]);
  const shape = (kind, doc) => ({
    kind, _id: doc._id, at: doc.archivedAt,
    label: KINDS[kind].labelOf(doc),
    detail: kind === 'groups' ? `${doc.count} head`
          : kind === 'crops' ? `${doc.acres || 0} acres`
          : `${doc.acres || 0} acres`,
  });
  return [
    ...groups.map((d) => shape('groups', d)),
    ...plots.map((d) => shape('plots', d)),
    ...crops.map((d) => shape('crops', d)),
  ].sort((a, b) => new Date(b.at) - new Date(a.at)).slice(0, limit);
}

/**
 * ALL DATA — reverse the farm's holdings in one action.
 *
 * The confirmation is the farm's own NAME, typed. A tap-through "are you sure" is not a
 * confirmation for something that empties a farm; naming the thing you are erasing is.
 */
async function reverseAll(farmId, typedName, farmName) {
  const typed = String(typedName || '').trim().toLowerCase();
  const actual = String(farmName || '').trim().toLowerCase();
  if (!typed || typed !== actual) {
    throw Object.assign(
      new Error('type your farm name exactly to confirm — this undoes everything'),
      { status: 400 },
    );
  }

  const now = new Date();
  const counts = {};
  for (const name of ['crops', 'plots', 'groups']) {
    const kind = KINDS[name];
    const Model = kind.model();
    const docs = await Model.find({ farmId, archivedAt: null });
    for (const d of docs) {
      d.archivedAt = now;
      await d.save();
      if (kind.subjectType) await cancelFuture(farmId, kind.subjectType, d._id, new Date(0));
    }
    counts[name] = docs.length;
  }
  return counts;
}

/** Put the whole farm back. */
async function restoreAll(farmId) {
  const counts = {};
  for (const name of ['groups', 'plots', 'crops']) {
    const kind = KINDS[name];
    const Model = kind.model();
    const docs = await Model.find({ farmId, archivedAt: { $ne: null } });
    for (const d of docs) {
      d.archivedAt = null;
      await d.save();
      await rematerialise(farmId, kind, d);
    }
    counts[name] = docs.length;
  }
  return counts;
}

module.exports = { KINDS, edit, reverse, restore, reversed, reverseAll, restoreAll };
