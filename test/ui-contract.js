// test/ui-contract.js — the SHAPE contract between public/index.html and the API.
//
// The integration suite proves the server behaves. It does NOT prove the app can
// READ what the server says. A single renamed field — `orders` vs `items`,
// `dueToday` vs `due` — passes every server test and shows a farmer an empty
// screen. That is the failure most likely to reach the first farmer, so it gets
// its own check: for every field public/index.html touches, assert it is present.
//
// If this file fails, the app is broken for the farmer even though the API is fine.
const ROOT = (process.env.FARMLINE_TEST_BASE || 'http://localhost:4600').replace(/\/$/, '');
const BASE = ROOT + '/api/farmline';

let fail = 0;
const ok = (m) => console.log('  PASS  ' + m);
const bad = (m) => { fail++; console.log('  FAIL  ' + m); };
const assert = (c, m) => (c ? ok(m) : bad(m));

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

// What the app reads at each step. Missing = a blank screen for the farmer.
function need(label, obj, fields) {
  const missing = fields.filter((f) => obj?.[f] === undefined || obj?.[f] === null);
  missing.length
    ? bad(`${label} is missing: ${missing.join(', ')}`)
    : ok(`${label} carries what the app reads (${fields.join(', ')})`);
}

(async () => {
  console.log('\nfarmline ui contract  (what public/index.html actually reads)\n');

  const stamp = Date.now();
  const phone = '07' + String(stamp).slice(-8);
  const reg = await call('POST', '/auth/farmer/register', {
    phone, pin: '1234', name: 'Contract Farm', farmName: 'Contract Farm ' + String(stamp).slice(-4),
  });
  if (!reg.body?.ok || !reg.body.token) {
    bad(`register did not return a token (${reg.status}) — the app cannot sign a farmer in`);
    console.log('\nUI CONTRACT FAILED\n');
    process.exit(1);
  }
  ok('register returns ok + token (the app stores it)');
  const T = reg.body.token;

  const me = await call('GET', '/me', null, T);
  need('GET /me', me.body, ['ok', 'farm']);
  need('  .farm', me.body?.farm, ['_id', 'name', 'slug']);
  const farmId = me.body.farm._id;
  const slug = me.body.farm.slug;

  // The app builds its share link from the slug.
  need('GET /me → farm.slug', { slug }, ['slug']);

  // Setup, as the app sends it.
  await call('POST', `/farm/${farmId}/plots`, { name: 'Plot B', acres: 2 }, T);
  const grp = await call('POST', `/farm/${farmId}/groups`, { species: 'cattle', label: 'cattle', count: 6 }, T);
  grp.body?.ok ? ok('POST /groups accepted (the setup buttons work)') : bad(`POST /groups → ${grp.status}`);
  const crp = await call('POST', `/farm/${farmId}/crops`, { crop: 'maize', acres: 2, plantedOn: new Date().toISOString(), season: 'short rains' }, T);
  crp.body?.ok ? ok('POST /crops accepted (crops are first-class)') : bad(`POST /crops → ${crp.status}`);

  const today = await call('GET', `/farm/${farmId}/today`, null, T);
  need('GET /today', today.body, ['ok', 'dueToday', 'thisWeek', 'baseline', 'counts']);
  need('  .counts', today.body?.counts, ['today', 'week', 'baseline']);
  const anyEv = [...(today.body.dueToday || []), ...(today.body.baseline || [])][0];
  need('  an event row', anyEv, ['_id', 'intervention', 'subjectLabel']);

  // A2 tranche 4 — THE UPDATES CHECK (public, no-store): the app reads this on
  // boot, on every visibility return and every 5 minutes while visible; the
  // contract pins the exact shape, because a cached or partial answer is a lie.
  // RE-ALIGNED 2026-10-09 to the founder-ordered LoopKeeper shape (commit 6e959fa
  // "VERBATIM LOOPKEEPER — no invention"): the answer is { version, type } — the
  // client sends its STORED version, invalid → 'immediate', a major drift →
  // 'immediate', else 'flexible'. The old build-counter fields (build,
  // isUpdateAvailable, mandatory, mandatoryBuild) are RETIRED; asserting them here
  // kept this gate red ever since that attunement landed.
  const updNoClient = await call('GET', `/updates/check`);
  need('GET /updates/check (no auth, no client version)', updNoClient.body, ['version', 'type']);
  assert(updNoClient.body?.type === 'immediate', 'an invalid/absent client version is told IMMEDIATE (the honest clock)');
  const updStale = await call('GET', `/updates/check?clientVersion=0.1.0`);
  need('GET /updates/check (stale client)', updStale.body, ['version', 'type']);
  assert(['immediate', 'flexible'].includes(updStale.body?.type), 'the type is one of the two honest values');

  // Complete — the app reads holds[].affects and holds[].days for its message.
  // `holds` is ALWAYS an array; it is only non-empty when the protocol carried a
  // withdrawal window (a vaccine has none, a dewormer has two). Asserting a
  // non-empty holds[0] unconditionally would assert something untrue.
  const done = await call('POST', `/farm/${farmId}/events/${anyEv._id}/complete`, {}, T);
  need('POST /events/:id/complete', done.body, ['ok', 'holds']);
  if (Array.isArray(done.body?.holds) && done.body.holds.length) {
    need('  .holds[0] (a withdrawal was opened)', done.body.holds[0], ['affects', 'days', 'until']);
  } else {
    ok('  .holds is an empty array (this protocol carries no withdrawal) — correct');
  }

  // PUT SOMETHING UP FOR SALE, as the app's Uza form does. Without this the shop
  // is empty BY DEFINITION: the storefront is projected from a Sellable, so a farm
  // that has priced nothing has nothing to show a customer. This was the gap the
  // contract test caught — the API was complete, the app had no way to call it.
  const sell = await call('POST', `/farm/${farmId}/sellables`, {
    product: 'milk', label: 'Fresh milk', labelSw: 'Maziwa mapya', unit: 'litre', unitSw: 'lita',
    price: 60, minQty: 1, source: { kind: 'production', product: 'milk', windowDays: 1 }, affects: ['milk'],
  }, T);
  need('POST /sellables (the Uza form)', sell.body, ['ok', 'sellable']);

  const sellsList = await call('GET', `/farm/${farmId}/sellables`, null, T);
  need('GET /sellables (the Uza list)', sellsList.body, ['ok', 'sellables', 'availability']);

  const log = await call('POST', `/farm/${farmId}/logs`, {
    log: { kind: 'milk', product: 'milk', quantity: 42, unit: 'litre', clientId: 'ui' + stamp },
  }, T);
  need('POST /logs', log.body, ['ok', 'availability']);
  need('  .availability[0] (what the app renders back)', log.body?.availability?.[0],
       ['product', 'label', 'unit', 'available']);

  // Eggs too — a milk hold must not leave the customer face with nothing, and the
  // contract test must not depend on which protocol happened to be first.
  await call('POST', `/farm/${farmId}/sellables`, {
    product: 'eggs', label: 'Eggs', labelSw: 'Mayai', unit: 'tray', unitSw: 'tray',
    price: 450, minQty: 1, source: { kind: 'production', product: 'eggs', windowDays: 2 }, affects: [],
  }, T);
  await call('POST', `/farm/${farmId}/logs`, {
    log: { kind: 'eggs', product: 'eggs', quantity: 12, unit: 'tray', clientId: 'ui-eggs-' + stamp },
  }, T);

  const orders = await call('GET', `/farm/${farmId}/orders`, null, T);
  need('GET /orders', orders.body, ['ok', 'orders']);

  const money = await call('GET', `/farm/${farmId}/money`, null, T);
  need('GET /money', money.body, ['ok', 'mode', 'balances', 'mpesaConfigured']);
  need('  .balances', money.body?.balances, ['zu']);

  const ladder = await call('GET', `/farm/${farmId}/ladder`, null, T);
  need('GET /ladder', ladder.body, ['ok', 'currentRung', 'foundation', 'commercial', 'gaps', 'reason']);
  need('  .foundation[0]', ladder.body?.foundation?.[0], ['rung', 'name', 'question', 'free']);
  need('  .commercial[0]', ladder.body?.commercial?.[0], ['rung', 'name', 'question', 'layer']);

  // ── the customer face, exactly as the app reads it ─────────────────────────
  const shop = await call('GET', `/shop/${slug}`);
  need('GET /shop/:slug (no auth)', shop.body, ['ok', 'farm', 'availability', 'records', 'moneyMode']);
  need('  .farm', shop.body?.farm, ['name', 'area', 'terms', 'slots', 'photo']);
  // C6 (the GLM audit, 2026-10-10): the trust fields LEFT the contract BY DESIGN —
  // the derived signals are not built, so the API stopped sending fabricated
  // defaults (a zero-record farm shipped a perfect adherence score). The buyer
  // face never rendered them. They return to this contract only when a real
  // derivation exists.
  need('  .availability[0]', shop.body?.availability?.[0], ['product', 'label', 'unit', 'price', 'qty', 'available']);
  // ROUND A — the buyer's guide: the farm's face rides the payload, and the
  // readable records carry the numbers the app renders. This farm logged milk
  // and eggs above, so fresh[0] is guaranteed here — pinning the whole shape.
  need('  .records', shop.body?.records, ['window', 'fresh']);
  need('  .records.fresh[0]', shop.body?.records?.fresh?.[0], ['product', 'label', 'unit', 'qty']);

  // Order, as the app posts it — AS A SIGNED-IN CUSTOMER. The shop is open to
  // browse but an order needs a verified phone; that is the trust mechanism.
  // Without this token the app gets a 401, which is how the missing-customer-token
  // bug in public/index.html was found.
  const cust = await call('POST', '/auth/customer', { phone: '07' + String(stamp + 1).slice(-8), name: '', slug });
  const custTok = cust.body?.token;
  custTok ? ok('POST /auth/customer returns a token (the buyer\'s identity)')
          : bad(`POST /auth/customer → ${cust.status}, no token — nobody could ever order`);

  const buyable = (shop.body.availability || []).find((a) => a.available && a.qty > 0);
  if (!buyable) {
    bad('nothing is buyable — the customer face has nothing to order');
  } else {
    const ord = await call('POST', `/shop/${slug}/order`, {
      lines: [{ product: buyable.product, qty: 1 }],
      how: 'pickup', slot: 'Kesho 7:00 – 9:00 asubuhi', addr: '', note: 'ui contract', pay: true,
    }, custTok);
    need('POST /shop/:slug/order (as a customer)', ord.body, ['ok', 'order']);
    need('  .order', ord.body?.order, ['_id', 'ref', 'total', 'lines', 'stage', 'how', 'slot', 'payment']);
  }

  // The money toggle, as the app posts it.
  const mode = await call('GET', `/farm/${farmId}/money`, null, T);
  const same = await call('POST', `/farm/${farmId}/money/mode`, { mode: mode.body.mode }, T);
  need('POST /money/mode', same.body, ['ok']);

  console.log(`\n${fail ? `UI CONTRACT FAILED — ${fail} field(s) the app reads but the API does not send.` : 'UI CONTRACT OK — every field the app reads is present.'}\n`);
  process.exit(fail ? 1 : 0);
})();
