// src/money.js — THE ZU LEDGER. The ONE place Farmline's own unit moves.
//
// THE DOCTRINE (2026-10-11 — the authority is D:\TODOs\farmline-zu-doctrine-20261011.md):
//   Farmline sells ONE thing — ZU — and ZU unlocks the paid rungs.
//   Money moves ONE WAY: user → Farmline. Always into our own account. Always
//   for our own service. Farmline is never between a farmer and a buyer.
//
// WHAT THIS FILE USED TO BE, AND WHY IT IS NOT THAT ANY MORE:
//   It carried two modes — 'virtual' (ZU moving between a CUSTOMER and a FARM)
//   and 'mpesa' (a real-money STK push asking a buyer's phone to pay a farmer's
//   paybill, settled by a public callback). Both moved money BETWEEN two third
//   parties. That is the whole thing the founder ruled out: too complex,
//   multi-jurisdictional, and it puts Farmline's name on somebody else's
//   transaction. The mpesa rail, its outbound module, its callback and its
//   secret are DELETED, not patched — and with them the entire class of finding
//   the audit raised against that callback (A1, N1, N2). The code that carried
//   the exposure no longer exists.
//
// WHAT IS LEFT is a receivable book with three verbs:
//   balance()  — what a farm has, DERIVED from settled rows (never a counter)
//   award()    — credit ZU, once the operator has confirmed the money arrived
//   spend()    — draw ZU down, for a paid rung
//
// THE ONE LESSON KEPT FROM THE OLD FILE (it was right, and it stays): only
// SETTLED rows are money. A claim that has merely been filed credits nothing.

const { Ledger } = require('./models');
const zu = require('./zu');

// The ledger's MODE label for ZU. The enum predates the doctrine and still reads
// 'virtual'; renaming a stored enum buys a migration and nothing else, so the
// label is kept and documented: 'virtual' IS ZU everywhere in this codebase.
const ZU_MODE = 'virtual';

/** Aggregation does not cast strings to ObjectId — route every id through this,
 *  or the $match silently finds nothing, which reads as "no balance". */
function toId(v) {
  const mongoose = require('mongoose');
  return mongoose.Types.ObjectId.isValid(String(v)) ? new mongoose.Types.ObjectId(String(v)) : v;
}

/**
 * A farm's ZU balance. DERIVED from the ledger on every read — a stored balance
 * that disagrees with its own history is how money bugs start.
 */
async function balance({ farmId }) {
  const rows = await Ledger.aggregate([
    { $match: { farmId: toId(farmId), mode: ZU_MODE, status: 'settled' } },
    { $group: { _id: '$direction', total: { $sum: '$amountZU' } } },
  ]);
  let inSum = 0, outSum = 0;
  for (const r of rows) {
    if (r._id === 'in') inSum = r.total || 0;
    if (r._id === 'out') outSum = r.total || 0;
  }
  return Math.round((inSum - outSum) * 100) / 100;
}

/**
 * AWARD — credit ZU. Called only when the operator has CONFIRMED that the money
 * arrived (the /zu/claims/:id/confirm route). A filed claim credits nothing; that
 * separation between a claim and a fact is the whole point of the door.
 */
async function award({ farmId, amountZU, ref = '', note = '' }) {
  const amount = Math.max(0, Number(amountZU) || 0);
  if (!amount) return { ok: false, error: 'nothing to credit' };
  const row = await Ledger.create({
    farmId,
    customerId: null,
    mode: ZU_MODE,
    direction: 'in',
    amountKES: 0,
    amountZU: amount,
    ref: String(ref || '').slice(0, 80),
    status: 'settled',
    note: String(note || 'ZU credited').slice(0, 200),
  });
  return { ok: true, id: row._id, balance: await balance({ farmId }) };
}

/**
 * SPEND — draw ZU down. Refuses honestly when the balance will not cover it; it
 * never goes negative and it never silently part-charges.
 *
 * The CALLER owns the atomicity. In rung activation the farm row is claimed
 * FIRST (one findOneAndUpdate on the not-yet-active state), the spend runs
 * second, and the claim is rolled back if the spend comes up short. That is the
 * A5 lesson applied: a check-then-write on its own can be won twice.
 */
async function spend({ farmId, amountZU, ref = '', note = '' }) {
  const amount = Math.max(0, Number(amountZU) || 0);
  if (!amount) return { ok: false, error: 'nothing to charge' };
  const have = await balance({ farmId });
  if (have < amount) {
    return { ok: false, short: Math.round((amount - have) * 100) / 100, have, needed: amount };
  }
  const row = await Ledger.create({
    farmId,
    customerId: null,
    mode: ZU_MODE,
    direction: 'out',
    amountKES: 0,
    amountZU: amount,
    ref: String(ref || '').slice(0, 80),
    status: 'settled',
    note: String(note || 'ZU spent').slice(0, 200),
  });
  return { ok: true, id: row._id, balance: Math.round((have - amount) * 100) / 100 };
}

/** The farm's recent ZU movements — the farmer's own receipt trail. */
async function history({ farmId, limit = 30 }) {
  return Ledger.find({ farmId: toId(farmId), mode: ZU_MODE })
    .sort({ createdAt: -1 })
    .limit(Math.min(Number(limit) || 30, 100))
    .select('direction amountZU ref note status createdAt')
    .lean();
}

/**
 * CLAIM THE DAILY ALLOWANCE (the refill, ported from Zyppar's claimTopUp()).
 *
 * One per farm per day, and the UNIQUE INDEX on { farmId, dailyKey } is the lock —
 * not a check-then-write. Two taps racing in the same second produce one row and
 * one E11000, and the loser is told the truth ("already collected today") instead
 * of being credited twice. That is the A5 lesson again, applied to the refill.
 *
 * `day` must be the DAY KEY the caller computed (his own calendar day), so the
 * reset is a date boundary rather than a rolling 24 hours — a rolling window would
 * let a farmer collect twice within minutes by waiting for the clock to tick.
 */
async function claimDaily({ farmId, amountZU, day, note = '' }) {
  const amount = Math.max(0, Number(amountZU) || 0);
  const key = String(day || '').slice(0, 20);
  if (!amount) return { ok: false, error: 'the allowance is zero — nothing to credit' };
  if (!key) return { ok: false, error: 'the allowance needs a day key' };
  try {
    // ── THE LOCK, GUARANTEED PRESENT (2026-10-14) ─────────────────────────────────
    // The "once a day" promise was resting on a unique index that this server never waits
    // for: Mongoose builds indexes in the background, so on a fresh database — a deploy, a
    // restore, a migration — `create` cannot collide and the allowance pays twice. init()
    // resolves once the indexes are built, and Mongoose memoises it, so this costs nothing
    // after the first call. The guarantee now rests on the index EXISTING.
    await Ledger.init();
    const row = await Ledger.create({
      farmId,
      customerId: null,
      mode: ZU_MODE,
      direction: 'in',
      amountKES: 0,
      amountZU: amount,
      ref: 'ZU-DAILY-' + key,
      status: 'settled',
      note: String(note || 'free daily allowance').slice(0, 200),
      dailyKey: key,
    });
    return { ok: true, id: row._id, credited: amount, balance: await balance({ farmId }) };
  } catch (e) {
    // 11000 = duplicate key = this farm already collected for this day.
    if (e && (e.code === 11000 || e.code === 11001)) {
      return { ok: false, already: true, balance: await balance({ farmId }) };
    }
    throw e;
  }
}

/** Was today's allowance already collected? (a read for the door, never a credit) */
async function dailyClaimed({ farmId, day }) {
  const key = String(day || '').slice(0, 20);
  if (!key) return false;
  const row = await Ledger.findOne({ farmId: toId(farmId), dailyKey: key }).select('_id').lean();
  return !!row;
}

module.exports = {
  ZU_MODE,
  balance,
  award,
  spend,
  claimDaily,
  dailyClaimed,
  history,
  // re-exported so a caller needs one require for the whole economy
  ZU: zu,
};
