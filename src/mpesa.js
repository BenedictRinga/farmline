// ─────────────────────────────────────────────────────────────────────────────
// M-PESA (Safaricom Daraja) — the real rail.
//
// THE ONE RULE THIS FILE EXISTS TO KEEP: farmline never custodies money. The STK
// push pays the FARM's own shortcode; farmline only asks for the money and records
// the receipt. No float, no escrow, no e-money licence exposure. That is what keeps
// this a marketplace and not a payment institution.
//
// Zyppar gave us nothing to copy here — its payments are Stripe/PayPal in USD for
// topping up ZU. A Kenyan farmer cannot buy ZU, and a Kenyan buyer cannot pay a
// farmer with a card. This is new ground, and it is the piece that turns a shop
// into a livelihood.
//
// WHAT "NOT ARMED" MEANS: with no credentials this module reports itself unarmed and
// the ledger records a PENDING entry that was never transmitted. It must never
// return success it did not get. A fabricated payment confirmation on a money rail
// is the most damaging bug this codebase could ship — worse than an outage, because
// it is silent and it is about somebody's income.
//
// Shop: https://developer.safaricom.co.ke (Daraja). Sandbox and production differ
// only by base URL; `MPESA_ENV` selects it.
const config = require('./config');

const BASE = {
  sandbox: 'https://sandbox.safaricom.co.ke',
  production: 'https://api.safaricom.co.ke',
};

/**
 * Kenyan phone numbers arrive in every shape a person can type them:
 *   0712345678 · +254712345678 · 254712345678 · 712345678 · 07 12 345 678
 * Daraja accepts exactly one: 2547XXXXXXXX (or 2541XXXXXXXX). Sending anything else
 * returns a 400 that reads like a server fault, so it is normalised here once.
 */
function normalizePhone(input) {
  const digits = String(input || '').replace(/[^\d]/g, '');
  if (!digits) return null;
  let n = digits;
  if (n.startsWith('254')) n = n.slice(3);
  else if (n.startsWith('0')) n = n.slice(1);
  if (!/^[17]\d{8}$/.test(n)) return null;      // 7XXXXXXXX or 1XXXXXXXX (9 digits)
  return '254' + n;
}

/** Daraja wants YYYYMMDDHHmmss in East Africa Time, not UTC. */
function darajaTimestamp(d = new Date()) {
  const eat = new Date(d.getTime() + 3 * 3600 * 1000);   // UTC+3
  const p = (x) => String(x).padStart(2, '0');
  return `${eat.getUTCFullYear()}${p(eat.getUTCMonth() + 1)}${p(eat.getUTCDate())}`
    + `${p(eat.getUTCHours())}${p(eat.getUTCMinutes())}${p(eat.getUTCSeconds())}`;
}

/** base64(shortcode + passkey + timestamp) — the STK password, per spec. */
function stkPassword(shortcode, passkey, timestamp) {
  return Buffer.from(String(shortcode) + String(passkey) + String(timestamp)).toString('base64');
}

/**
 * Credentials for a specific farm.
 *
 * A farm may carry its OWN Daraja credentials, and that is the model to prefer:
 * money settles into the farmer's paybill, under the farmer's own agreement with
 * Safaricom. The deployment-level credentials are a fallback for development and
 * for farms onboarded onto a platform shortcode.
 *
 * Returns null when nothing usable is configured — callers must handle that as
 * "unarmed", never as "assume it worked".
 */
function credentialsFor(farm) {
  const own = farm?.mpesa || {};
  const pick = (a, b) => (a && String(a).trim() ? String(a).trim() : b);
  const cred = {
    consumerKey: pick(own.consumerKey, config.mpesa.consumerKey),
    consumerSecret: pick(own.consumerSecret, config.mpesa.consumerSecret),
    // The shortcode that receives the money.
    shortcode: pick(own.paybill || own.till || own.shortcode, config.mpesa.shortcode),
    passkey: pick(own.passkey, config.mpesa.passkey),
    env: pick(own.env, config.mpesa.env) || 'sandbox',
    // A TILL takes "Buy Goods"; a PAYBILL takes "Pay Bill". Sending the wrong one
    // fails with an unhelpful error, so it is derived rather than guessed.
    type: (own.till && !own.paybill) ? 'till' : 'paybill',
  };
  const armed = !!(cred.consumerKey && cred.consumerSecret && cred.shortcode && cred.passkey);
  return armed ? cred : null;
}

function baseUrl(env) { return BASE[env === 'production' ? 'production' : 'sandbox']; }

// ── OAuth ─────────────────────────────────────────────────────────────────────
// Daraja tokens live ~1 hour. Cached per credential-set: a fresh OAuth round trip
// on every STK push would add a second to every checkout and get rate-limited.
const tokenCache = new Map();   // key -> { token, expiresAt }

async function accessToken(cred) {
  const key = cred.consumerKey + ':' + cred.env;
  const hit = tokenCache.get(key);
  if (hit && hit.expiresAt > Date.now() + 30_000) return hit.token;

  const basic = Buffer.from(`${cred.consumerKey}:${cred.consumerSecret}`).toString('base64');
  const r = await fetch(`${baseUrl(cred.env)}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: 'Basic ' + basic },
    // A BOUNDED HANDSHAKE (the audit's robustness fix, 2026-10-08): a hung
    // Daraja call used to hang the buyer's checkout indefinitely — the vision
    // route has a timeout and the money path did not. OAuth answers in under
    // a second when it answers at all.
    signal: AbortSignal.timeout(10_000),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok || !j?.access_token) {
    throw new Error(`Daraja OAuth failed (${r.status}): ${j?.errorMessage || j?.error || 'no token'}`);
  }
  const ttl = Number(j.expires_in) || 3599;
  tokenCache.set(key, { token: j.access_token, expiresAt: Date.now() + ttl * 1000 });
  return j.access_token;
}

/**
 * STK PUSH — ask the buyer's phone to pay the farm.
 *
 * Returns { ok, status, ref, message, ... }. `status` is one of:
 *   'pending'  — the request reached Daraja and the buyer must now enter their PIN.
 *                THIS IS NOT SUCCESS. Only the callback settles a payment.
 *   'failed'   — Daraja rejected the request outright; `message` says why.
 *
 * The distinction matters: a farmer who sees "paid" when the buyer never entered
 * their PIN will hand over milk they were never paid for.
 */
async function stkPush({ cred, phone, amountKES, accountRef = '', description = '', callbackUrl }) {
  const msisdn = normalizePhone(phone);
  if (!msisdn) return { ok: false, status: 'failed', message: 'That does not look like a Kenyan phone number (07… or +2547…).' };

  const amount = Math.round(Number(amountKES) || 0);
  if (!(amount >= 1)) return { ok: false, status: 'failed', message: 'M-Pesa cannot charge less than KES 1.' };

  const ts = darajaTimestamp();
  const body = {
    BusinessShortCode: cred.shortcode,
    Password: stkPassword(cred.shortcode, cred.passkey, ts),
    Timestamp: ts,
    TransactionType: cred.type === 'till' ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
    Amount: amount,
    PartyA: msisdn,
    PartyB: cred.shortcode,
    PhoneNumber: msisdn,
    CallBackURL: callbackUrl,
    AccountReference: String(accountRef || 'farmline').slice(0, 12),
    TransactionDesc: String(description || 'farmline order').slice(0, 13),
  };

  const token = await accessToken(cred);
  const r = await fetch(`${baseUrl(cred.env)}/mpesa/stkpush/v1/processrequest`, {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    // THE SAME BOUND (the audit's robustness fix, 2026-10-08): the buyer waits
    // on this call — a hung push must not hang the checkout. The vision route
    // has a timeout; the money path now has one too.
    signal: AbortSignal.timeout(30_000),
  });
  const j = await r.json().catch(() => null);

  if (!r.ok || j?.ResponseCode !== '0') {
    return {
      ok: false, status: 'failed',
      message: j?.errorMessage || j?.ResponseDescription || `Daraja rejected the request (${r.status})`,
      raw: j,
    };
  }
  return {
    ok: true, status: 'pending',
    // CheckoutRequestID is the handle the callback arrives with — this is what a
    // pending ledger entry is keyed on, NOT a receipt we do not have yet.
    checkoutRequestId: j.CheckoutRequestID,
    merchantRequestId: j.MerchantRequestID,
    message: j.CustomerMessage || 'Check your phone and enter your M-Pesa PIN.',
  };
}

/**
 * Parse a Daraja STK callback into one honest shape.
 *
 * Daraja sends ResultCode 0 for success; anything else is a failure and carries a
 * ResultDesc (1032 = the buyer cancelled, 1 = insufficient funds, 2001 = wrong PIN).
 * Those distinctions get surfaced, because "you cancelled" and "you had no money"
 * deserve different words to the person who did it.
 */
function parseCallback(payload) {
  const stk = payload?.Body?.stkCallback;
  if (!stk) return { ok: false, status: 'failed', message: 'malformed callback' };

  const common = {
    checkoutRequestId: stk.CheckoutRequestID,
    merchantRequestId: stk.MerchantRequestID,
    resultCode: Number(stk.ResultCode),
    resultDesc: stk.ResultDesc || '',
  };

  if (Number(stk.ResultCode) !== 0) {
    const say = {
      1032: 'The buyer cancelled the M-Pesa request.',
      1: 'Not enough money in the M-Pesa account.',
      2001: 'Wrong M-Pesa PIN.',
      1037: 'The buyer did not respond (phone off or no signal).',
      1025: 'M-Pesa is busy — try again.',
    }[Number(stk.ResultCode)];
    return { ...common, ok: false, status: 'failed', message: say || stk.ResultDesc || 'M-Pesa request failed' };
  }

  const items = stk.CallbackMetadata?.Item || [];
  const val = (name) => items.find((i) => i.Name === name)?.Value;
  return {
    ...common,
    ok: true,
    status: 'settled',
    receipt: val('MpesaReceiptNumber') || '',
    amount: Number(val('Amount') || 0),
    phone: String(val('PhoneNumber') || ''),
    paidAt: val('TransactionDate') ? String(val('TransactionDate')) : '',
  };
}

module.exports = {
  credentialsFor, normalizePhone, darajaTimestamp, stkPassword,
  accessToken, stkPush, parseCallback, baseUrl,
  configuredEnvs: () => ({ sandbox: true, production: true }),
};
