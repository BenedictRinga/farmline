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
const mpesa = require('./mpesa');

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

/** mpesaConfigured() — is the real rail wired up at all, on THIS deployment? */
function mpesaConfigured() {
  const m = config.mpesa;
  return !!(m.consumerKey && m.consumerSecret && m.shortcode && m.passkey);
}

/**
 * Is the rail armed for THIS FARM? A farm may carry its own Daraja credentials, and
 * that is the model to prefer: money must settle into the farmer's own paybill under
 * the farmer's own agreement with Safaricom, not into ours. The deployment-level
 * credentials are the fallback for dev and for farms on a platform shortcode.
 */
function mpesaArmedFor(farm) {
  return !!mpesa.credentialsFor(farm);
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
  // Money goes to the FARM, never to farmline. That is the whole design.
  const cred = mpesa.credentialsFor(farm);
  const payTo = farm?.mpesa?.paybill || farm?.mpesa?.till || '';
  if (!cred) {
    return {
      ok: false, mode: 'mpesa', status: 'pending',
      message: 'M-Pesa is not connected on this server yet. Pay the farm directly and log it, or switch this farm to ZU mode.',
    };
  }
  if (!payTo && !cred.shortcode) {
    return {
      ok: false, mode: 'mpesa', status: 'failed',
      message: 'This farm has no paybill or till number set. Add one in Settings before taking M-Pesa.',
    };
  }
  if (!phone) {
    return { ok: false, mode: 'mpesa', status: 'failed', message: 'A phone number is needed for the M-Pesa request.' };
  }

  // The reference the buyer's phone shows, and the only handle we have until the
  // callback arrives. Short and recognisable on an M-Pesa SMS.
  const localRef = 'FL-' + String(order.ref || '').slice(-6);
  const callbackUrl = `${config.publicUrl}/api/farmline/mpesa/callback`;

  try {
    const push = await mpesa.stkPush({
      cred, phone, amountKES: kes,
      accountRef: localRef, description: 'farmline', callbackUrl,
    });

    if (!push.ok) {
      // Daraja refused outright. Record the attempt so the farmer can see it
      // happened, then hand back the honest reason.
      await Ledger.create({
        farmId: farm._id, orderId: order._id, customerId: customer?._id || null, mode: 'mpesa',
        direction: 'in', amountKES: kes, amountZU: 0, ref: localRef, status: 'failed',
        note: `STK push refused: ${push.message}`,
      });
      return { ok: false, mode: 'mpesa', status: 'failed', ref: localRef, message: push.message };
    }

    // PENDING, and that word is doing real work. The buyer has been asked; they have
    // not paid. Only the callback settles this. Reporting 'paid' here would have a
    // farmer hand over milk for money that never moved.
    await Ledger.create({
      farmId: farm._id, orderId: order._id, customerId: customer?._id || null, mode: 'mpesa',
      direction: 'in', amountKES: kes, amountZU: 0,
      ref: localRef,
      // The callback arrives keyed on CheckoutRequestID, not on our order ref.
      checkoutRequestId: push.checkoutRequestId,
      status: 'pending',
      note: `STK push sent to ${push.checkoutRequestId ? push.checkoutRequestId.slice(-8) : cred.shortcode} — awaiting the buyer's PIN`,
    });

    return {
      ok: true, mode: 'mpesa', status: 'pending', ref: localRef,
      checkoutRequestId: push.checkoutRequestId,
      message: push.message || 'Check the phone and enter the M-Pesa PIN.',
    };
  } catch (e) {
    return { ok: false, mode: 'mpesa', status: 'failed', message: 'M-Pesa request failed: ' + (e?.message || 'unknown') };
  }
}

/**
 * Settle a payment from the Daraja callback.
 *
 * Matched on CheckoutRequestID — a receipt number does not exist yet at push time,
 * and matching on anything else risks settling the wrong order.
 */
async function settleByCheckout(checkoutRequestId, parsed) {
  const r = await Ledger.updateOne(
    { mode: 'mpesa', checkoutRequestId: String(checkoutRequestId) },
    {
      $set: {
        status: parsed.status === 'settled' ? 'settled' : 'failed',
        mpesaReceipt: parsed.receipt || '',
        note: parsed.status === 'settled'
          ? `M-Pesa ${parsed.receipt} · KES ${parsed.amount}`
          : `M-Pesa failed: ${parsed.message}`,
        ...(parsed.status === 'settled' ? { settledAt: new Date() } : {}),
      },
    },
  );
  return { ok: r.matchedCount > 0, matched: r.matchedCount };
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
  MODES, modeFor, quote, mpesaConfigured, mpesaArmedFor,
  balance, charge, settle, settleByCheckout, grantStartingZU,
};
