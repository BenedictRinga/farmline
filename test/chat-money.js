// test/chat-money.js — the two things this build added: talking, and getting paid.
//
// Chat is tested over BOTH doors (REST and socket) because they are both real paths
// to the same write, and the socket path is the one that can fail invisibly. The
// scoping test matters most: without it, one buyer reads another buyer's thread.
//
// M-Pesa is tested for the things that cannot be allowed to be wrong: phone
// normalisation, callback parsing, and above all that an UNARMED rail never reports
// success. A fabricated payment confirmation is the worst bug this codebase could
// ship — it is silent, and it is about somebody's income.
const ROOT = (process.env.FARMLINE_TEST_BASE || 'http://localhost:4600').replace(/\/$/, '');
const BASE = ROOT + '/api/farmline';

let fail = 0;
const ok = (m) => console.log('  PASS  ' + m);
const bad = (m) => { fail++; console.log('  FAIL  ' + m); };
const info = (m) => console.log('  info  ' + m);

async function call(method, path, body, token) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch { /* non-json */ }
  return { status: r.status, body: j };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

(async () => {
  console.log('\n=== CHAT + M-PESA ===\n');

  const stamp = Date.now();
  const phone = '07' + String(stamp).slice(-8);

  // ── 1. two sides and a farm ────────────────────────────────────────────────
  console.log('setup');
  const reg = await call('POST', '/auth/farmer/register', {
    phone, pin: '1234', name: 'Chat Farm', farmName: 'Chat Farm ' + String(stamp).slice(-4),
  });
  const farmerTok = reg.body?.token;
  const farmId = (await call('GET', '/me', null, farmerTok)).body?.farm._id;
  const slug = (await call('GET', '/me', null, farmerTok)).body?.farm.slug;
  farmerTok ? ok('farmer + farm ready') : bad('could not register a farmer');

  const buyerA = await call('POST', '/auth/customer', { phone: '07' + String(stamp + 1).slice(-8), name: 'Buyer A', slug });
  const buyerB = await call('POST', '/auth/customer', { phone: '07' + String(stamp + 2).slice(-8), name: 'Buyer B', slug });
  const tokA = buyerA.body?.token, tokB = buyerB.body?.token;
  (tokA && tokB) ? ok('two buyers signed in') : bad('could not sign in two buyers');

  // ── 2. the buyer opens the thread from the shop ────────────────────────────
  console.log('\nopening a conversation');
  const open = await call('POST', '/conversations', { slug }, tokA);
  const convId = open.body?.conversation?._id;
  open.body?.ok ? ok('a buyer can open a thread with a farm from the shop') : bad(`POST /conversations → ${open.status}`);
  if (!convId) { console.log('\nCHAT+MONEY FAILED (no conversation)\n'); process.exit(1); }

  // Re-opening must CONTINUE the thread, not fragment the relationship.
  const again = await call('POST', '/conversations', { slug }, tokA);
  again.body?.conversation?._id === convId
    ? ok('re-opening continues the SAME thread (history is not fragmented)')
    : bad('a second open created a different conversation');

  // ── 3. REST is a peer, not a fallback ─────────────────────────────────────
  console.log('\nREST messages');
  const m1 = await call('POST', `/conversations/${convId}/messages`, { body: 'Is the milk available tomorrow?', clientId: 'c1' }, tokA);
  m1.body?.ok ? ok('a buyer can send over REST') : bad(`POST message → ${m1.status}`);

  // A2 tranche 4 — THE PHOTO: a buyer sends a picture of the bruised box, and
  // the farmer's history carries it. The tiny 1x1 data URL proves the pipe.
  const TINY = 'data:image/jpeg;base64,' +
    '/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';
  const mp = await call('POST', `/conversations/${convId}/messages`, { body: '', photo: TINY, clientId: 'photo1' }, tokA);
  mp.body?.ok ? ok('a message can carry a photo') : bad(`photo message → ${mp.status} ${JSON.stringify(mp.body).slice(0, 120)}`);
  const mpBad = await call('POST', `/conversations/${convId}/messages`, { body: '', photo: 'not-a-data-url', clientId: 'photo-bad' }, tokA);
  mpBad.status === 400 ? ok('a malformed photo is refused, not stored') : bad(`a malformed photo slipped through (${mpBad.status})`);

  const dupe = await call('POST', `/conversations/${convId}/messages`, { body: 'Is the milk available tomorrow?', clientId: 'c1' }, tokA);
  dupe.body?.duplicate ? ok('a replayed clientId is recognised as a duplicate (offline-safe)') : bad('a replayed message posted twice');

  const farmerList = await call('GET', '/conversations', null, farmerTok);
  const mine = (farmerList.body?.conversations || [])[0];
  mine && mine.unread >= 1
    ? ok(`the farmer sees the thread with ${mine.unread} unread`)
    : bad(`the farmer's list is wrong: ${JSON.stringify(mine)}`);
  mine?.counterparty ? ok(`the farmer sees the counterparty as "${mine.counterparty}"`) : info('no counterparty label');

  const hist = await call('GET', `/conversations/${convId}/messages`, null, farmerTok);
  hist.body?.messages?.some((m) => m.body === 'Is the milk available tomorrow?')
    ? ok('the farmer can read the message')
    : bad('the farmer cannot see the buyer\'s message');
  hist.body?.messages?.some((m) => m.photo && m.photo.startsWith('data:image/'))
    ? ok('the photo rides the history back')
    : bad('the photo did not survive the round trip');

  await call('POST', `/conversations/${convId}/read`, {}, farmerTok);
  const afterRead = (await call('GET', '/conversations', null, farmerTok)).body?.conversations?.[0];
  afterRead?.unread === 0 ? ok('reading clears the unread count') : bad(`unread did not clear (${afterRead?.unread})`);

  const reply = await call('POST', `/conversations/${convId}/messages`, { body: 'Yes — 42 litres from 7am.' }, farmerTok);
  reply.body?.ok ? ok('the farmer can reply') : bad(`farmer reply → ${reply.status}`);

  const buyerHist = await call('GET', `/conversations/${convId}/messages`, null, tokA);
  buyerHist.body?.messages?.length >= 2 ? ok('the buyer sees the whole thread') : bad('the buyer\'s history is short');

  // ── 4. SCOPING — the one that must never fail ─────────────────────────────
  console.log('\nscoping (a buyer must not read another buyer\'s thread)');
  const intruderList = await call('GET', '/conversations', null, tokB);
  const leaked = (intruderList.body?.conversations || []).some((c) => c._id === convId);
  leaked ? bad('BUYER B CAN SEE BUYER A\'S CONVERSATION IN THEIR LIST') : ok('buyer B\'s list does not contain buyer A\'s thread');

  const intruderRead = await call('GET', `/conversations/${convId}/messages`, null, tokB);
  intruderRead.status === 403
    ? ok('buyer B reading buyer A\'s thread is refused with 403')
    : bad(`buyer B read the thread with status ${intruderRead.status}`);

  const intruderWrite = await call('POST', `/conversations/${convId}/messages`, { body: 'I am not in this thread' }, tokB);
  intruderWrite.status === 403
    ? ok('buyer B writing into buyer A\'s thread is refused with 403')
    : bad(`buyer B posted into the thread with status ${intruderWrite.status}`);

  const anon = await call('GET', `/conversations/${convId}/messages`);
  anon.status === 401 ? ok('an anonymous reader is refused with 401') : bad(`anonymous read → ${anon.status}`);

  // ── 5. the SOCKET door ────────────────────────────────────────────────────
  console.log('\nsocket.io (/socket-farmline/)');
  let socketOk = false;
  try {
    const { io } = require('socket.io-client');

    const farmerSock = io(ROOT, { path: '/socket-farmline/', auth: { token: farmerTok }, transports: ['websocket'] });
    await new Promise((res, rej) => {
      farmerSock.on('chat:ready', res);
      farmerSock.on('connect_error', rej);
      setTimeout(() => rej(new Error('connect timeout')), 6000);
    });
    ok('an authenticated socket connects');

    farmerSock.emit('chat:join', { conversationId: convId });
    await sleep(400);

    const buyerSock = io(ROOT, { path: '/socket-farmline/', auth: { token: tokA }, transports: ['websocket'] });
    await new Promise((res, rej) => {
      buyerSock.on('chat:ready', res);
      buyerSock.on('connect_error', rej);
      setTimeout(() => rej(new Error('connect timeout')), 6000);
    });

    buyerSock.emit('chat:join', { conversationId: convId });
    await sleep(400);

    // The farmer sends over the SOCKET; the buyer must receive it live.
    const delivered = new Promise((resolve) => {
      buyerSock.on('chat:message', (m) => { if (m.body === 'Live over the socket') resolve(m); });
      setTimeout(() => resolve(null), 4000);
    });
    farmerSock.emit('chat:message', { conversationId: convId, body: 'Live over the socket', clientId: 'sock1' });
    const got = await delivered;
    got ? ok('a message sent over the socket arrives on the other side in real time') : bad('the socket message never arrived');

    // And it must be PERSISTED, not just broadcast.
    const persisted = await call('GET', `/conversations/${convId}/messages`, null, tokA);
    persisted.body?.messages?.some((m) => m.body === 'Live over the socket')
      ? ok('the socket message was persisted (visible over REST too)')
      : bad('a socket message was relayed but NOT saved — it would vanish on reload');

    // A socket with no token must be refused at the handshake.
    const anonSock = io(ROOT, { path: '/socket-farmline/', transports: ['websocket'], reconnection: false });
    const refused = await new Promise((resolve) => {
      anonSock.on('connect', () => resolve(false));
      anonSock.on('connect_error', () => resolve(true));
      setTimeout(() => resolve(false), 4000);
    });
    refused ? ok('an unauthenticated socket is refused at the handshake') : bad('AN ANONYMOUS SOCKET CONNECTED');

    farmerSock.close(); buyerSock.close(); anonSock.close();
    socketOk = true;
  } catch (e) {
    bad(`socket test could not run: ${e.message}`);
  }

  // ── 6. M-PESA — the parts that must not be wrong ──────────────────────────
  console.log('\nM-Pesa (Daraja)');
  const mpesa = require('../src/mpesa');

  const phones = [
    ['0712345678', '254712345678'], ['+254712345678', '254712345678'],
    ['254712345678', '254712345678'], ['712345678', '254712345678'],
    ['07 12 345 678', '254712345678'], ['0112345678', '254112345678'],
  ];
  const badPhones = phones.filter(([input, want]) => mpesa.normalizePhone(input) !== want);
  badPhones.length === 0
    ? ok(`all ${phones.length} Kenyan phone shapes normalise to 254…`)
    : bad(`phone normalisation wrong for: ${badPhones.map((p) => p[0]).join(', ')}`);
  mpesa.normalizePhone('12345') === null ? ok('a nonsense number is rejected, not mangled') : bad('a nonsense number was accepted');

  /^\d{14}$/.test(mpesa.darajaTimestamp())
    ? ok(`timestamp is Daraja-shaped (${mpesa.darajaTimestamp()})`)
    : bad('the timestamp is not YYYYMMDDHHmmss');

  const pw = mpesa.stkPassword('174379', 'passkey', '20260101120000');
  Buffer.from(pw, 'base64').toString() === '174379passkey20260101120000'
    ? ok('the STK password is base64(shortcode+passkey+timestamp)')
    : bad('the STK password is wrong');

  const success = mpesa.parseCallback({
    Body: { stkCallback: { CheckoutRequestID: 'ws_CO_1', ResultCode: 0, ResultDesc: 'ok',
      CallbackMetadata: { Item: [
        { Name: 'MpesaReceiptNumber', Value: 'RJ41ABC123' },
        { Name: 'Amount', Value: 900 }, { Name: 'PhoneNumber', Value: 254712345678 },
        { Name: 'TransactionDate', Value: 20261003120000 }] } } },
  });
  success.ok && success.receipt === 'RJ41ABC123' && success.amount === 900
    ? ok('a successful callback parses to a receipt + amount')
    : bad(`callback parse wrong: ${JSON.stringify(success)}`);

  const cancelled = mpesa.parseCallback({ Body: { stkCallback: { CheckoutRequestID: 'ws_CO_2', ResultCode: 1032, ResultDesc: 'Cancelled' } } });
  !cancelled.ok && /cancel/i.test(cancelled.message)
    ? ok(`a cancelled payment is a FAILURE with a human reason ("${cancelled.message}")`)
    : bad('a cancelled payment would read as success');

  // THE ONE THAT MATTERS: unarmed must never claim success.
  const armedHere = (await call('GET', '/version')).body?.mpesaConfigured;
  const farm = { _id: farmId, moneyMode: 'mpesa', name: 'Chat Farm' };
  const moneyMod = require('../src/money');
  const attempt = await moneyMod.charge({
    farm, customer: null, order: { _id: farmId, ref: 'FL-TEST' }, amountKES: 900, mode: 'mpesa', phone: '0712345678',
  });
  if (!armedHere) {
    attempt.ok === false
      ? ok('an UNARMED M-Pesa rail refuses — it does NOT report a fake success')
      : bad('THE UNARMED RAIL REPORTED SUCCESS — the worst possible bug on a money path');
    info(`unarmed answer: "${attempt.message}"`);
  } else {
    info(`this deployment HAS M-Pesa credentials — the push returned ${attempt.status}`);
    attempt.status === 'pending'
      ? ok('a real push returns PENDING, not paid (only the callback settles)')
      : bad(`a real push returned "${attempt.status}" — success must come only from the callback`);
  }

  // ── THE BALANCE READS ONLY SETTLED MONEY (the audit's fix, 2026-10-08) ──
  // The mpesa rail writes PENDING (PIN not yet entered) and FAILED (refused
  // push) rows direction 'in'; the old aggregate counted them as RECEIVED.
  // Proven at the module level against THROWAWAY ledger rows (a probe farm id
  // that exists nowhere else), created and deleted inside this block.
  {
    const mongoose = require('mongoose');
    const { Ledger } = require('../src/models');
    const moneyMod2 = require('../src/money');
    const probeId = new mongoose.Types.ObjectId();
    try {
      await Ledger.insertMany([
        { farmId: probeId, mode: 'mpesa', direction: 'in', amountKES: 1000, ref: 'FL-BAL-SETTLED', status: 'settled' },
        { farmId: probeId, mode: 'mpesa', direction: 'in', amountKES: 400, ref: 'FL-BAL-PENDING', status: 'pending', checkoutRequestId: 'ws_BAL_P' },
        { farmId: probeId, mode: 'mpesa', direction: 'in', amountKES: 250, ref: 'FL-BAL-FAILED', status: 'failed' },
      ]);
      const bal = await moneyMod2.balance({ ownerType: 'farm', ownerId: probeId, mode: 'mpesa' });
      bal === 1000
        ? ok('the mpesa balance counts SETTLED money only (pending/failed excluded)')
        : bad(`THE BALANCE COUNTS MONEY THAT DID NOT MOVE — got ${bal}, want 1000`);
    } finally {
      await Ledger.deleteMany({ farmId: probeId }).catch(() => {});
    }
  }

  console.log(`\n${fail ? `CHAT+MONEY FAILED — ${fail} problem(s).` : 'CHAT+MONEY PASSED — both doors work, and the rail is honest.'}\n`);
  process.exit(fail ? 1 : 0);
})();
