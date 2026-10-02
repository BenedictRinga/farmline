// src/money.js — THE ONE PLACE MONEY MOVES. (AGENTS.md rule 2.)
//
// Two modes, one shape. Nothing outside this file may know which is in use.
//
//   virtual  — ZU (Zyppar Units, 1 ZU ≈ $0.01). The demo/training mode. Orders
//              settle against ZU balances held in the ledger. No real money, so a
//              farmer can practise selling — and their customers can order —
//              without a single shilling changing hands.
//   mpesa    — real money. And CRUCIALLY: farmline never custodies it. The STK
//              push goes to the FARM'S OWN paybill/till, and farmline records the
//              reference. No float, no escrow, no e-money licence exposure.
//
// Why virtual is a first-class mode and not a toy: it lets a hobby farmer run the
// whole commercial ladder — order, deliver, get paid, review — before real money
// is on the line. That is exactly the "from hobby to full-time" path this product
// exists to serve, and it is why the toggle is per-farm and reversible at any time.
const config = require('./config');
const { Ledger } = require('./models');

const MODES = ['virtual', 'mpesa'];

/** The mode for this farm: its own setting wins, else the deployment default. */
function modeFor(farm) {
  const m = String(farm?.moneyMode || config.moneyMode || 'virtual');
  return MODES.includes(m) ? m : 'virtual';
}

/** KES → ZU at the configured rate. Rounded to 2dp; ZU is not a currency you split. */
function quote(amountKES) {
  const kes = Math.max(0, Number(amountKES) || 0);
  const zu = Math.round(kes * config.zuPerKes * 100) / 100;
  return { kes, zu, rate: config.zuPerKes, mode: 'virtual' };
}

/** mpesaConfigured() — is the real rail wired up at all? */
function mpesaConfigured() {
  const m = config.mpesa;
  return !!(m.consumerKey && m.consumerSecret && m.shortcode && m.passkey);
}

/**
 * Balances are DERIVED from the ledger, never stored as a mutable counter.
 * A stored balance that disagrees with its own history is how money bugs start.
 */
async function balance({ ownerType, ownerId, mode = 'virtual' }) {
  const match = { mode };
  if (ownerType === 'farm') match.farmId = ownerId;
  else match.customerId = ownerId;
  const rows = await Ledger.aggregate([
    { $match: match },
    { $group: { _id: '$direction', total: { $sum: mode === 'virtual' ? '$amountZU' : '$amountKES' } } },
  ]);
  let inSum = 0, outSum = 0;
  for (const r of rows) {
    if (r._id === 'in') inSum = r.total || 0;
    if (r._id === 'out') outSum = r.total || 0;
  }
  return Math.round((inSum - outSum) * 100) / 100;
}

/**
 * CHARGE. One entry point for both modes.
 *
 * Returns { ok, mode, status, ref, message } — and never throws for a payment
 * that simply cannot proceed (an unconfigured rail is an honest 501-shaped
 * answer, the same posture LoopKeeper takes with its payment gateways).
 *
 * Post-success only: the caller records the money AFTER the thing being paid for
 * has actually been produced. See AGENTS.md / the ZU rule "gate on success, never
 * on routes".
 */
async function charge({ farm, customer, order, amountKES, mode, phone }) {
  const useMode = MODES.includes(mode) ? mode : modeFor(farm);
  const kes = Math.max(0, Number(amountKES) || 0);
  if (!order || !kes) return { ok: false, mode: useMode, status: 'failed', message: 'nothing to charge' };

  // ── VIRTUAL (ZU) ────────────────────────────────────────────────────────────
  if (useMode === 'virtual') {
    const { zu } = quote(kes);
    const bal = customer ? await balance({ ownerType: 'customer', ownerId: customer._id, mode: 'virtual' }) : Infinity;
    if (bal < zu) {
      return {
        ok: false, mode: 'virtual', status: 'failed', needed: zu, available: bal,
        message: `Not enough ZU (needs ${zu}, has ${bal}). Top up in the Zyo/ZU sheet.`,
      };
    }
    const ref = 'ZU-' + String(order.ref || '').slice(-6);
    // Two entries, always: money leaves the buyer and arrives at the farm.
    await Ledger.create([
      { farmId: farm._id, orderId: order._id, customerId: customer?._id || null, mode: 'virtual',
        direction: 'out', amountKES: kes, amountZU: zu, ref, status: 'settled', note: 'order paid (ZU)' },
      { farmId: farm._id, orderId: order._id, customerId: customer?._id || null, mode: 'virtual',
        direction: 'in', amountKES: kes, amountZU: zu, ref, status: 'settled', note: 'order paid (ZU)' },
    ]);
    return { ok: true, mode: 'virtual', status: 'paid', ref, zu, message: `Paid ${zu} ZU` };
  }

  // ── MPESA (real) ────────────────────────────────────────────────────────────
  // Money goes to the FARM, not to farmline.
  const payTo = farm?.mpesa?.paybill || farm?.mpesa?.till || '';
  if (!mpesaConfigured()) {
    return {
      ok: false, mode: 'mpesa', status: 'pending',
      message: 'M-Pesa is not connected on this server yet. Pay the farm directly and log it, or switch this farm to ZU mode.',
    };
  }
  if (!payTo) {
    return {
      ok: false, mode: 'mpesa', status: 'failed',
      message: 'This farm has no paybill or till number set. Add one in Settings before taking M-Pesa.',
    };
  }
  if (!phone) {
    return { ok: false, mode: 'mpesa', status: 'failed', message: 'A phone number is needed for the M-Pesa request.' };
  }

  // The real Daraja call lives here. Scaffold: it is deliberately NOT faked.
  // A fake success on a money rail is the single most dangerous thing this file
  // could do, so an unwired rail returns an honest pending state instead.
  try {
    const ref = 'MP-' + String(order.ref || '').slice(-6);
    await Ledger.create({
      farmId: farm._id, orderId: order._id, customerId: customer?._id || null, mode: 'mpesa',
      direction: 'in', amountKES: kes, amountZU: 0, ref, status: 'pending',
      note: `STK push to ${payTo} (not yet transmitted)`,
    });
    return {
      ok: false, mode: 'mpesa', status: 'pending', ref,
      message: 'M-Pesa request recorded but not yet transmitted — the Daraja credentials are not armed on this deployment.',
    };
  } catch (e) {
    return { ok: false, mode: 'mpesa', status: 'failed', message: 'M-Pesa request failed: ' + (e?.message || 'unknown') };
  }
}

/** Confirm an M-Pesa payment from the Daraja callback (or the farmer's own entry). */
async function settle(ref, { mpesaCode = '' } = {}) {
  const r = await Ledger.updateOne({ ref, mode: 'mpesa' }, { $set: { status: 'settled', note: mpesaCode ? 'M-Pesa ' + mpesaCode : 'settled' } });
  return { ok: r.modifiedCount > 0 };
}

/** Give a new customer a starting ZU credit so the virtual mode is usable at once. */
async function grantStartingZU({ farm, customer, zu = 500, note = 'starting credit (ZU demo)' }) {
  await Ledger.create({
    farmId: farm?._id || null, customerId: customer._id, mode: 'virtual',
    direction: 'in', amountKES: 0, amountZU: zu, ref: 'ZU-START', status: 'settled', note,
  });
  return zu;
}

module.exports = {
  MODES, modeFor, quote, mpesaConfigured,
  balance, charge, settle, grantStartingZU,
};
