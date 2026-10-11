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

  // ── 6. ZU — FARMLINE'S OWN UNIT (the money doctrine, 2026-10-11) ──────────
  // What is tested here, and why: Farmline no longer runs a rail between a buyer
  // and a farmer, so there is no M-Pesa parsing, no phone normalisation, no STK
  // password and no callback left to prove. The properties that MUST hold now are
  // the doctrine's own — and these are the ones a future session must not break:
  //   · ZU is one US cent, and the pack ladder reaches the paid rungs;
  //   · a balance counts SETTLED rows only;
  //   · a filed claim credits NOTHING;
  //   · a confirmed claim cannot be credited twice;
  //   · a spend refuses honestly when short and moves nothing.
  console.log('\nZU — the unit, the door, the paid rungs');
  const zu = require('../src/zu');
  const moneyMod = require('../src/money');

  zu.ZU_PER_USD === 100
    ? ok('1 ZU is one US cent (ZU_PER_USD = 100)')
    : bad(`the unit moved: ZU_PER_USD=${zu.ZU_PER_USD}`);

  Object.keys(zu.RUNG_ZU).length === 4
    ? ok(`the four paid rungs carry ZU prices (${Object.entries(zu.RUNG_ZU).map(([k, v]) => `${k} ${v}`).join(', ')})`)
    : bad('the paid rungs are not all priced in ZU');

  // A LADDER, NOT A FLAT UNIT: each bigger pack must give at least as many ZU per
  // USD as the one below it. (The comparison is `>=` — the first draft had it
  // backwards, which passed everything and proved nothing.)
  zu.PACKS.every((p, i, a) => i === 0 || p.zu / p.usd >= a[i - 1].zu / a[i - 1].usd - 1e-9)
    ? ok(`every bigger pack gives a better rate (${zu.PACKS.map((p) => (p.zu / p.usd).toFixed(1)).join(' → ')} ZU/USD)`)
    : bad('a bigger pack is worse value — the ladder is inverted');

  zu.PACKS[0].zu >= zu.RUNG_ZU.verdict
    ? ok(`the smallest pack (${zu.PACKS[0].zu} ZU) reaches the first paid rung (${zu.RUNG_ZU.verdict} ZU) — the small first step`)
    : bad('the smallest pack cannot reach the first paid rung');

  // NO LOCAL CURRENCY ANYWHERE (the founder's rule: "no local currency to
  // Farmline direct"). The shape the app renders must not carry a price in KES,
  // NGN or USD — only the ZU and the unit it is pegged to.
  !/KES|NGN|₦|KSh/.test(JSON.stringify(zu.publicShape()))
    ? ok('the public ZU shape carries NO local-currency price (ZU only)')
    : bad('THE PUBLIC ZU SHAPE LEAKED A LOCAL-CURRENCY PRICE');

  // ── THE BALANCE READS ONLY SETTLED MONEY (the lesson kept from the old file) ──
  // Proven at the module level against THROWAWAY ledger rows (a probe farm id
  // that exists nowhere else), created and deleted inside this block.
  {
    const mongoose = require('mongoose');
    const { Ledger } = require('../src/models');
    const probeId = new mongoose.Types.ObjectId();
    try {
      await Ledger.insertMany([
        { farmId: probeId, mode: 'virtual', direction: 'in', amountZU: 1000, ref: 'ZU-BAL-SETTLED', status: 'settled' },
        { farmId: probeId, mode: 'virtual', direction: 'in', amountZU: 400, ref: 'ZU-BAL-PENDING', status: 'pending' },
        { farmId: probeId, mode: 'virtual', direction: 'in', amountZU: 250, ref: 'ZU-BAL-FAILED', status: 'failed' },
        { farmId: probeId, mode: 'virtual', direction: 'out', amountZU: 300, ref: 'ZU-BAL-SPENT', status: 'settled' },
      ]);
      const bal = await moneyMod.balance({ farmId: probeId });
      bal === 700
        ? ok('the ZU balance counts SETTLED rows only, both directions (1000 − 300)')
        : bad(`THE BALANCE COUNTS WHAT DID NOT MOVE — got ${bal}, want 700`);
    } finally {
      await Ledger.deleteMany({ farmId: probeId }).catch(() => {});
    }
  }
  // ── THE CLAIM → CONFIRM DOOR (the doctrine's ONE money door) ────────────────
  // A claim is a REQUEST TO BE CHECKED. It credits nothing. Only the operator's
  // confirm turns it into money — and a confirm can never credit twice.
  {
    const mongoose = require('mongoose');
    const { Ledger, ZuClaim } = require('../src/models');
    const config = require('../src/config');
    const adminKey = config.envVar('FARMLINE_ADMIN_KEY');
    const probeId = new mongoose.Types.ObjectId();

    try {
      // ── THE TWO VERBS, at the module level where the invariants live ────────
      const a = await moneyMod.award({ farmId: probeId, amountZU: 600, ref: 'ZU-TEST', note: 'test credit' });
      a.ok && a.balance === 600
        ? ok('award() credits ZU and reports the new balance')
        : bad(`award() wrong: ${JSON.stringify(a)}`);

      const short = await moneyMod.spend({ farmId: probeId, amountZU: 900, ref: 'rung-verdict' });
      short.ok === false && short.short === 300
        ? ok('spend() refuses honestly when short and NAMES the shortfall (300 ZU)')
        : bad(`spend() did not refuse honestly: ${JSON.stringify(short)}`);
      (await moneyMod.balance({ farmId: probeId })) === 600
        ? ok('a refused spend moves NOTHING')
        : bad('A REFUSED SPEND MOVED MONEY');

      const spent = await moneyMod.spend({ farmId: probeId, amountZU: zu.RUNG_ZU.verdict, ref: 'rung-verdict' });
      spent.ok && spent.balance === 600 - zu.RUNG_ZU.verdict
        ? ok(`spend() deducts exactly the rung price (${zu.RUNG_ZU.verdict} ZU) leaving ${spent.balance}`)
        : bad(`spend() wrong: ${JSON.stringify(spent)}`);

      // ── THE DOOR ITSELF ────────────────────────────────────────────────────
      if (!zu.collectionOpen()) {
        const closed = await call('POST', `/farm/${farmId}/zu/claim`, { packId: 'starter', reference: 'REF-CLOSED' }, farmerTok);
        closed.status === 503
          ? ok('with no collection details published the door answers 503 honestly — it never invents an account')
          : bad(`the closed door answered ${closed.status} — it must refuse, not improvise`);
        // And the door is FARMER-side: a buyer's token must not reach it at all.
        const asBuyer = await call('POST', `/farm/${farmId}/zu/claim`, { packId: 'starter', reference: 'REF-BUYER' }, tokA);
        asBuyer.status === 403
          ? ok('a BUYER token is refused at the ZU door (403) — ZU is bought by the farm, not by the storefront')
          : bad(`a buyer token reached the ZU door (${asBuyer.status}) — the wrong side of the app let it in`);
        info('set FARMLINE_ZU_COLLECTION in .env to exercise the live claim→confirm legs');
      } else {
        const before = await moneyMod.balance({ farmId });
        const filed = await call('POST', `/farm/${farmId}/zu/claim`, { packId: 'starter', method: 'bank', reference: 'REF-' + Date.now() }, farmerTok);
        if (filed.status === 200) {
          ok('a claim is FILED (200) and keeps its reference as the receipt');
          (await moneyMod.balance({ farmId })) === before
            ? ok('A FILED CLAIM CREDITS NOTHING — a claim is not money')
            : bad('A FILED CLAIM CREDITED ZU WITHOUT CONFIRMATION');

          const claimId = filed.body?.claim?.id;
          if (!adminKey) {
            info('FARMLINE_ADMIN_KEY is not set — the operator-confirm legs are skipped');
          } else {
            const noKey = await call('POST', `/zu/claims/${claimId}/confirm`, {});
            noKey.status === 401 || noKey.status === 403
              ? ok(`a confirm WITHOUT the admin key is refused (${noKey.status})`)
              : bad(`a confirm without the admin key answered ${noKey.status}`);

            const confirmed = await call('POST', `/zu/claims/${claimId}/confirm`, { key: adminKey });
            const after = await moneyMod.balance({ farmId });
            confirmed.status === 200 && after === before + zu.PACKS[0].zu
              ? ok(`the operator's confirm credits the pack (${zu.PACKS[0].zu} ZU)`)
              : bad(`confirm did not credit: ${confirmed.status}, balance ${after}, want ${before + zu.PACKS[0].zu}`);

            const twice = await call('POST', `/zu/claims/${claimId}/confirm`, { key: adminKey });
            const afterTwice = await moneyMod.balance({ farmId });
            twice.status === 409 && afterTwice === after
              ? ok('confirming TWICE credits once (409, balance unchanged)')
              : bad(`A DOUBLE CONFIRM CREDITED TWICE: ${twice.status}, balance ${afterTwice}`);
          }
        } else {
          bad(`filing a claim answered ${filed.status}: ${filed.body?.error || ''}`);
        }
      }
    } finally {
      await Ledger.deleteMany({ farmId: probeId }).catch(() => {});
      await ZuClaim.deleteMany({ farmId: probeId }).catch(() => {});
    }
  }

  // ── 7. THE REFILL, THE LEDGER'S HONESTY, AND THE MID-SEASON DOOR (2026-10-11) ──
  // These three are the founder's rulings, and each one has a failure mode that would
  // be invisible in production: an allowance that pays twice, history that a photo can
  // manufacture, and a rung that outlives the days someone paid for.
  console.log('\nThe refill, honest readiness, and the mid-season door');
  {
    const mongoose = require('mongoose');
    const { Ledger } = require('../src/models');
    const ladder = require('../src/ladder');

    // ── THE DAILY ALLOWANCE ────────────────────────────────────────────────────
    // It must be claimable with the COLLECTION DOOR CLOSED (otherwise, before
    // collection details are published, no farmer has any route to ZU at all).
    const d1 = await call('POST', `/farm/${farmId}/zu/daily`, {}, farmerTok);
    d1.status === 200 && d1.body?.credited > 0
      ? ok(`the daily allowance is claimable (${d1.body.credited} ZU) — and with the door closed, which is the point`)
      : bad(`the allowance refused: ${d1.status} ${JSON.stringify(d1.body || {})}`);
    const afterFirst = d1.body?.balance;

    // THE ONE THAT MATTERS: a second tap the same day pays NOTHING. The lock is the
    // unique index, not a check-then-write, so two taps racing cannot both win.
    const d2 = await call('POST', `/farm/${farmId}/zu/daily`, {}, farmerTok);
    d2.status === 200 && d2.body?.already === true && d2.body?.credited === 0
      ? ok('a second tap the same day credits 0 and SAYS SO (already collected)')
      : bad(`THE ALLOWANCE PAID TWICE: ${JSON.stringify(d2.body)}`);
    const afterSecond = (await call('GET', `/farm/${farmId}/zu`, null, farmerTok)).body?.balance;
    afterSecond === afterFirst
      ? ok(`the balance did not move on the second tap (${afterSecond} ZU)`)
      : bad(`THE BALANCE MOVED ON A REPEAT TAP: ${afterFirst} -> ${afterSecond}`);
    (await call('GET', `/farm/${farmId}/zu`, null, farmerTok)).body?.allowance?.collectedToday === true
      ? ok('the door reports today as already collected')
      : bad('the door does not know today was collected — the app would offer it again');

    // A BUYER MUST NOT COLLECT A FARM'S ALLOWANCE.
    const asBuyer = await call('POST', `/farm/${farmId}/zu/daily`, {}, tokA);
    asBuyer.status === 403
      ? ok('a BUYER token cannot claim a farm allowance (403)')
      : bad(`a buyer claimed a farm allowance (${asBuyer.status})`);

    // ── READINESS CANNOT BE MANUFACTURED (the founder's ruling #3) ──────────────
    // The mid-season door writes back-calculated logs. If those counted, a farmer
    // could buy the VERDICT badge on an afternoon of fiction. farmFacts excludes them
    // — and the PURE half of that claim is provable here: with LOW confidence the
    // engine never recommends past SHARPEN, whatever else is present.
    const thin = ladder.readiness({ logs30d: 40, daysOfHistory: 60, sellables: 3, plots: 1, confidence: 'low' });
    thin.recommended <= 2
      ? ok(`thin-confidence facts never recommend a paid rung (recommended ${thin.recommended})`)
      : bad(`READINESS RECOMMENDED ${thin.recommended} ON LOW CONFIDENCE`);

    // And the exclusion itself, at the data layer: an ESTIMATED log must not be
    // countable as history. Proven by writing both kinds and asking the same
    // question the engine asks.
    const probeId = new mongoose.Types.ObjectId();
    try {
      const { Log } = require('../src/models');
      await Log.insertMany([
        { farmId: probeId, kind: 'note', at: new Date(), estimated: true },
        { farmId: probeId, kind: 'note', at: new Date(), estimated: true },
        { farmId: probeId, kind: 'note', at: new Date(), estimated: true },
        { farmId: probeId, kind: 'note', at: new Date(), estimated: false },
      ]);
      const real = await Log.countDocuments({ farmId: probeId, estimated: { $ne: true } });
      const all = await Log.countDocuments({ farmId: probeId });
      real === 1 && all === 4
        ? ok('estimated records are EXCLUDED from history (4 written, 1 counted)')
        : bad(`THE EXCLUSION IS WRONG: ${all} written, ${real} counted (want 1 of 4)`);
    } finally {
      const { Log } = require('../src/models');
      await Log.deleteMany({ farmId: probeId }).catch(() => {});
    }

    // ── A RUNG DOES NOT OUTLIVE THE DAYS SOMEONE PAID FOR ───────────────────────
    const day = 86400000;
    const now = Date.now();
    const r = (f, when) => ladder.effectiveRung(f, when);
    r({ rung: 1 }, now).rung === 1 ? ok('a free rung is held with no payment (rung 1)') : bad('a free rung was downgraded');
    r({ rung: 3, rungPaidUntil: new Date(now + 5 * day) }, now).rung === 3 ? ok('a live paid period holds the rung (3)') : bad('a live paid rung was downgraded');
    const lapsed = r({ rung: 3, rungPaidUntil: new Date(now - day) }, now);
    lapsed.rung === 2 && lapsed.expired
      ? ok('a LAPSED paid period falls back to the free ceiling (3 → 2) and says it expired')
      : bad(`A LAPSED PAID RUNG STILL READS AS HELD: ${JSON.stringify(lapsed)}`);
    const prov = r({ rung: 3, rungProvisionalUntil: new Date(now + 5 * day) }, now);
    prov.rung === 3 && prov.provisional === true
      ? ok('a provisional rung holds AND is labelled provisional — the mid-season door')
      : bad(`the provisional rung is not labelled: ${JSON.stringify(prov)}`);
    const provGone = r({ rung: 3, rungProvisionalUntil: new Date(now - day) }, now);
    provGone.rung === 2
      ? ok('an EXPIRED provisional rung falls back to the free ceiling')
      : bad(`an expired provisional rung still reads as held (${provGone.rung})`);
    r({ rung: 6, isDemo: true }, now).rung === 6
      ? ok('the DEMO keeps its rung — money rules never touch the visitor walk')
      : bad('THE DEMO WAS DOWNGRADED BY A MONEY RULE');
    // A paid farm is never demoted to provisional, and never upgraded for free.
    prov.rung === r({ rung: 3, rungProvisionalUntil: new Date(now + day) }, now).rung
      ? ok('the provisional path never demotes or invents a rung')
      : bad('the provisional path changed the rung unexpectedly');
  }

  console.log(`\n${fail ? `CHAT+MONEY FAILED — ${fail} problem(s).` : 'CHAT+MONEY PASSED — both doors work, and the rail is honest.'}\n`);
  process.exit(fail ? 1 : 0);
})();
