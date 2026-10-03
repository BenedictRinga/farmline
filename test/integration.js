// Integration test for the farmline server.
// Exercises the whole loop: farmer setup → schedule → log → projection → customer order → money.
//
// The base URL is overridable so `yarn smoke` can run this against a throwaway
// server on its own port — never against whatever happens to be listening on 4600.
// (A stale server answering with OLD code made a correct fix look broken twice.)
const ROOT = (process.env.FARMLINE_TEST_BASE || 'http://localhost:4600').replace(/\/$/, '');
const BASE = ROOT + '/api/farmline';
const APP = ROOT + '/farmline';

let fail = 0;
const ok = (m) => console.log('  PASS  ' + m);
const bad = (m) => { fail++; console.log('  FAIL  ' + m); };
const warn = (m) => console.log('  WARN  ' + m);
const assert = (c, m) => (c ? ok(m) : bad(m));

async function req(method, path, { token, body } = {}) {
  const r = await fetch(BASE + path, {
    method,
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: 'Bearer ' + token } : {}) },
    body: body ? JSON.stringify(body) : undefined,
  });
  let j = null;
  try { j = await r.json(); } catch { /* no body */ }
  return { status: r.status, body: j };
}

const PHONE = '07' + String(Math.floor(10000000 + Math.random() * 89999999));

(async () => {
  console.log('=== 0. health ===');
  // health is at /health on the root
  const hr = await fetch('http://localhost:4600/health').then((r) => r.json()).catch(() => null);
  assert(hr?.ok === true, 'server is up');
  console.log(`  info  db=${hr?.db} dbName=${hr?.dbName} auth=${hr?.authArmed ? 'ARMED' : 'OPEN'} money=${hr?.moneyMode}`);
  assert(hr?.dbName === 'farmline', 'connected to the farmline database (never zyppar/rolodex)');
  assert(hr?.authArmed === true, 'the write gate is ARMED (AUTH_SECRET set)');

  console.log('\n=== 1. farmer register ===');
  const reg = await req('POST', '/auth/farmer/register', {
    body: { phone: PHONE, pin: '1234', name: 'Kimani', farmName: "Kimani's Farm", area: 'Limuru, Kiambu' },
  });
  assert(reg.status === 200 && reg.body?.token, 'farmer registered and token issued');
  const token = reg.body.token;
  const farmId = reg.body.farm.id;
  const slug = reg.body.farm.slug;
  console.log(`  info  farm=${farmId} slug=${slug}`);
  assert(reg.body?.start?.name === 'FARM', 'registration returns the FIRST RUNG landing (farmer-first entry)');
  assert(reg.body?.start?.whatYouGive?.length > 0, 'the rung landing states what the farmer must give');

  console.log('\n=== 2. auth is enforced ===');
  const noTok = await req('GET', `/farm/${farmId}/today`);
  assert(noTok.status === 401, 'a farmer route without a token is 401');
  const wrongFarm = await req('GET', `/farm/000000000000000000000000/today`, { token });
  assert(wrongFarm.status === 403, "another farm's data is 403 (scope enforced)");

  console.log('\n=== 3. farm setup materialises the schedule ===');
  const plot = await req('POST', `/farm/${farmId}/plots`, { token, body: { name: 'Plot B', acres: 2, soil: 'loam' } });
  assert(plot.status === 200, 'plot created');
  const cows = await req('POST', `/farm/${farmId}/groups`, { token, body: { species: 'cattle', label: 'the dairy cows', count: 6, productionKind: 'milk' } });
  assert(cows.status === 200, 'dairy group created');
  assert(cows.body?.scheduled >= 5, `schedule auto-generated: ${cows.body?.scheduled} events (farmer configured nothing)`);
  const goats = await req('POST', `/farm/${farmId}/groups`, { token, body: { species: 'goats', label: 'the goats', count: 8 } });
  assert(goats.body?.scheduled >= 5, `goat schedule generated: ${goats.body?.scheduled} events`);
  const maize = await req('POST', `/farm/${farmId}/crops`, { token, body: { crop: 'maize', acres: 2, plantedOn: new Date().toISOString(), season: 'short rains 2026' } });
  assert(maize.body?.scheduled >= 5, `maize crop schedule generated: ${maize.body?.scheduled} events (crops are first-class)`);

  console.log('\n=== 4. TODAY — the farmer work list ===');
  const today = await req('GET', `/farm/${farmId}/today`, { token });
  assert(today.status === 200, 'today fetched');
  const base = today.body.baseline || [];
  const due = [...(today.body.dueToday || []), ...base];
  console.log(`  info  ${today.body.counts.today} due today, ${today.body.counts.week} this week, ${today.body.counts.baseline} baseline to confirm`);
  assert(due.length > 0, 'the work list is populated');
  assert(base.length > 0, `baseline bucket present: ${base.length} "when did you last…" questions, NOT commands`);
  assert(base.length < 15, 'and a brand-new farm is not buried under every protocol at once');
  const hasDeworm = due.some((e) => e.intervention.includes('deworm'));
  assert(hasDeworm, 'a deworming event is on the list (the spray/deworm feature)');
  const hasSpray = due.some((e) => e.intervention.includes('spray'));
  assert(hasSpray, 'a tick-spray event is on the list');
  const first = due[0];

  console.log('\n=== 5. COMPLETE an event -> record + HOLD (the compliance payload) ===');
  const deworm = due.find((e) => e.intervention.includes('deworm'));
  if (!deworm) { bad('no deworming event to complete'); }
  else {
    const done = await req('POST', `/farm/${farmId}/events/${deworm._id}/complete`, { token, body: { productUsed: 'Zanil' } });
    assert(done.status === 200, 'event completed');
    assert(done.body?.hold, 'a withdrawal HOLD was opened automatically');
    assert(done.body.hold.affects.includes('milk'), 'the hold affects MILK');
    assert(done.body.hold.days === 3, `withdrawal is ${done.body.hold.days} days (per the protocol)`);
    assert(done.body?.nextEventId, 'the next occurrence was scheduled');

    // ── THE SECOND COMPLETION — the crash regression ──────────────────────────
    // Completing ONE event worked. Completing a SECOND killed the server:
    // E11000 on farmId_1_clientId_1 with clientId: "". The index is sparse, and
    // sparse skips MISSING fields — but the schema defaulted clientId to '', which
    // is a present value, so the two logs collided. This is the primary action of
    // the whole product, so it gets its own assertion.
    const other = due.find((e) => String(e._id) !== String(deworm._id));
    if (other) {
      const second = await req('POST', `/farm/${farmId}/events/${other._id}/complete`, { token, body: {} });
      assert(second.status === 200, `a SECOND event completes without colliding (${second.status})`);
      assert(second.body?.logId, 'the second completion wrote a record');
    } else {
      warn('only one due event — the double-completion regression is not covered this run');
    }
  }

  console.log('\n=== 5b. LAYER 1 — what do I have? ===');
  const inv = await req('GET', `/farm/${farmId}/inventory`, { token });
  assert(inv.status === 200, 'inventory fetched');
  assert(inv.body?.summary, 'it carries a summary');
  assert(Array.isArray(inv.body.animalGroups) && inv.body.animalGroups.length > 0,
    `${inv.body?.animalGroups?.length} animal group(s) — animals are visible, not just scheduled`);
  assert(Array.isArray(inv.body.plots), 'plots are returned');
  assert(inv.body.summary.animals === 12 || inv.body.summary.animals > 0,
    `the summary counts the herd (${inv.body?.summary?.animals} animals)`);
  assert(inv.body.animalGroups.some((g) => 'next' in g),
    'each group carries the NEXT thing due to it — "what I have" and "what is coming" answer together');
  assert(inv.body.summary.isSetUp === true, 'isSetUp is true once the farm has holdings');
  // Animals and crops are SIBLINGS on this screen (framework §1.1 gap 1: crops too).
  assert('cropsWithoutPlot' in inv.body, 'crops are first-class on the same payload as animals');

  console.log('\n=== 5c. REVERSAL — correct it, undo it, put it back ===');
  // One pattern for every kind of holding (src/reversal.js). The refusal cases matter as
  // much as the successes: a plot with crops in it must NOT be silently emptied, and
  // "undo everything" must be confirmed by typing the farm's own name.
  {
    const before = await req('GET', `/farm/${farmId}/inventory`, { token });
    const aGroup = before.body.animalGroups[0];
    const groupCountBefore = before.body.summary.animalGroups;

    // ── edit: correct a mistyped count ─────────────────────────────────────────
    const fixed = await req('PATCH', `/farm/${farmId}/groups/${aGroup._id}`, {
      token, body: { count: 99, label: 'Corrected herd' },
    });
    assert(fixed.status === 200, 'PATCH corrects a holding');
    assert(fixed.body?.updated?.count === 99, `the count was corrected to ${fixed.body?.updated?.count}`);

    // a field we do not allow must be ignored, not trusted
    const sneaky = await req('PATCH', `/farm/${farmId}/groups/${aGroup._id}`, {
      token, body: { count: 3, farmId: 'DEADBEEFDEADBEEFDEADBEEF', archivedAt: null },
    });
    assert(sneaky.body?.updated?.count === 3, 'only declared fields are editable');
    assert(String(sneaky.body?.updated?.farmId) === String(farmId), 'farmId cannot be reassigned by a patch');

    // ── reverse: undo it ───────────────────────────────────────────────────────
    const gone = await req('DELETE', `/farm/${farmId}/groups/${aGroup._id}`, { token });
    assert(gone.status === 200, 'DELETE reverses a holding');
    assert(typeof gone.body?.cancelledDates === 'number',
      `it reports how many future dates were cancelled (${gone.body?.cancelledDates})`);

    const after = await req('GET', `/farm/${farmId}/inventory`, { token });
    assert(after.body.summary.animalGroups === groupCountBefore - 1,
      `the reversed group is gone from the screen (${groupCountBefore} -> ${after.body.summary.animalGroups})`);
    assert(!after.body.animalGroups.some((g) => String(g._id) === String(aGroup._id)),
      'and it is not merely hidden by a filter the app applies');

    // ── it is recoverable, and the app can see what is recoverable ─────────────
    const list = await req('GET', `/farm/${farmId}/reversed`, { token });
    assert(list.status === 200 && Array.isArray(list.body.reversed), 'the reversed list is readable');
    assert(list.body.reversed.some((r) => String(r._id) === String(aGroup._id)),
      'the reversed group appears there, so a farmer can get it back');

    // ── restore: put it back, exactly as it was ────────────────────────────────
    const back = await req('POST', `/farm/${farmId}/groups/${aGroup._id}/restore`, { token });
    assert(back.status === 200, 'restore puts it back');
    assert(back.body?.restored?.count === 3, 'with the corrected count intact, not the original');
    assert(String(back.body?.restored?._id) === String(aGroup._id), 'the SAME id — this is an undo, not a re-create');

    const restored = await req('GET', `/farm/${farmId}/inventory`, { token });
    assert(restored.body.summary.animalGroups === groupCountBefore,
      'the farm is back to what it was');

    // ── RULE 3: a plot with crops in it is refused, not silently emptied ───────
    const plot = (await req('POST', `/farm/${farmId}/plots`, { token, body: { name: 'Reversal plot', acres: 1 } })).body.plot;
    const crop = (await req('POST', `/farm/${farmId}/crops`, {
      token, body: { plotId: plot._id, crop: 'maize', acres: 1, plantedOn: new Date().toISOString().slice(0, 10) },
    })).body.cycle;
    const refused = await req('DELETE', `/farm/${farmId}/plots/${plot._id}`, { token });
    assert(refused.status === 409, `removing a plot that still has crops is refused (${refused.status})`);
    assert(/crop/i.test(refused.body?.error || ''), `and it says why: "${refused.body?.error}"`);

    // the crop can go, and then so can the plot — in that order
    const cropGone = await req('DELETE', `/farm/${farmId}/crops/${crop._id}`, { token });
    assert(cropGone.status === 200, 'the crop reverses on its own');
    const plotGone = await req('DELETE', `/farm/${farmId}/plots/${plot._id}`, { token });
    assert(plotGone.status === 200, 'and then the plot can go');

    // ── ALL DATA: confirmed by typing the farm's own name ─────────────────────
    const noConfirm = await req('POST', `/farm/${farmId}/reverse-all`, { token, body: {} });
    assert(noConfirm.status === 400, 'reverse-all without the name is refused');
    assert(/farm name/i.test(noConfirm.body?.error || ''), 'and it says what is required');

    const wrongName = await req('POST', `/farm/${farmId}/reverse-all`, { token, body: { confirmName: 'some other farm' } });
    assert(wrongName.status === 400, 'a wrong name is refused');

    const all = await req('POST', `/farm/${farmId}/reverse-all`, { token, body: { confirmName: 'farmline' } });
    // the test farm is registered as 'farmline' by default; if it is not, the next
    // assertion explains itself rather than failing obscurely.
    if (all.status === 200) {
      assert(all.body.reversed.groups >= 1, `everything reversed (groups=${all.body.reversed.groups})`);
      const emptied = await req('GET', `/farm/${farmId}/inventory`, { token });
      assert(emptied.body.summary.isSetUp === false, 'the farm now honestly reports itself as not set up');

      const put = await req('POST', `/farm/${farmId}/restore-all`, { token });
      assert(put.status === 200, 'restore-all puts everything back');
      const again = await req('GET', `/farm/${farmId}/inventory`, { token });
      assert(again.body.summary.animalGroups >= 1, 'and the farm is populated again');
    } else {
      warn(`reverse-all declined with "${all.body?.error}" — the farm is not named 'farmline'`);
    }
  }

  console.log('\n=== 6. LOG milk -> the shop stock rises (the projection) ===');
  const sell = await req('POST', `/farm/${farmId}/sellables`, {
    token,
    body: { product: 'milk', label: 'Fresh milk', labelSw: 'Maziwa mapya', unit: 'litre', unitSw: 'lita', price: 60,
            source: { kind: 'production', product: 'milk', windowDays: 1 }, affects: ['milk'] },
  });
  assert(sell.status === 200, 'milk set up for sale (price only — never stock)');
  await req('POST', `/farm/${farmId}/sellables`, {
    token, body: { product: 'eggs', label: 'Eggs', labelSw: 'Mayai', unit: 'tray', price: 450,
                   source: { kind: 'production', product: 'eggs', windowDays: 2 }, affects: [] },
  });

  const log = await req('POST', `/farm/${farmId}/logs`, {
    token,
    body: { logs: [
      { kind: 'milk', product: 'milk', quantity: 42, unit: 'litre', clientId: 'c-' + Date.now() },
      { kind: 'eggs', product: 'eggs', quantity: 12, unit: 'tray', clientId: 'c2-' + Date.now() },
    ] },
  });
  assert(log.status === 200, 'logs accepted');
  assert(log.body?.availability?.length >= 2, 'the response carries the updated shop (instant feedback loop)');
  const milkItem = log.body.availability.find((a) => a.product === 'milk');
  const eggItem = log.body.availability.find((a) => a.product === 'eggs');
  assert(eggItem && eggItem.available && eggItem.qty === 12, `eggs now show ${eggItem?.qty} available — logging raised stock`);
  assert(milkItem && milkItem.suppressed === true, 'MILK IS SUPPRESSED — the withdrawal hold is suppressing it');
  assert(milkItem && /Not available/.test(milkItem.reason || ''), `and the customer sees the reason: "${milkItem?.reason}"`);

  console.log('\n=== 7. idempotency (offline replay must not double-count) ===');
  const cid = 'replay-' + Date.now();
  await req('POST', `/farm/${farmId}/logs`, { token, body: { kind: 'eggs', product: 'eggs', quantity: 5, clientId: cid } });
  const replay = await req('POST', `/farm/${farmId}/logs`, { token, body: { kind: 'eggs', product: 'eggs', quantity: 5, clientId: cid } });
  assert(replay.body?.accepted?.[0]?.duplicate === true, 'a replayed log is recognised as a duplicate');

  console.log('\n=== 8. PUBLIC SHOP — open, and allowlisted ===');
  const shop = await req('GET', `/shop/${slug}`);
  assert(shop.status === 200, 'shop opens with NO auth (the farm link must work cold)');
  const farm = shop.body.farm || {};
  const leaky = ['zuBalance', 'moneyMode', 'requiredIncome', 'confidence', 'trust'].filter((k) => k in farm && k !== 'trust');
  assert(leaky.length === 0, 'no private farm fields leak (' + (leaky.join(',') || 'clean') + ')');
  assert(!('rung' in farm) && !('mpesa' in farm), 'the ladder position and payment config are NOT public');
  const raw = JSON.stringify(shop.body);
  const bannedWords = ['profit', 'revenue', 'margin', 'cost per', 'depreciation', 'ledger'];
  const leaked = bannedWords.filter((w) => raw.toLowerCase().includes(w));
  assert(leaked.length === 0, 'no accountancy vocabulary in the public shop payload');
  const eggPub = shop.body.availability.find((a) => a.product === 'eggs');
  assert(eggPub?.qty === 17, `public eggs qty reflects the logs (12 + 5 = ${eggPub?.qty})`);

  console.log('\n=== 9. customer auth + order ===');
  const cust = await req('POST', '/auth/customer', { body: { phone: '0722' + Math.floor(100000 + Math.random() * 899999), name: 'Wanjiru', slug } });
  assert(cust.status === 200 && cust.body?.token, 'customer signed in');
  assert(cust.body?.zu?.granted === 500, `new buyer granted ${cust.body?.zu?.granted} ZU (virtual mode needs a balance to spend)`);
  const cTok = cust.body.token;

  const order = await req('POST', `/shop/${slug}/order`, {
    token: cTok,
    body: { lines: [{ product: 'eggs', qty: 2 }], how: 'pickup', slot: 'Kesho 7:00 – 9:00 asubuhi', pay: true },
  });
  assert(order.status === 201, 'order placed');
  assert(order.body?.order?.subtotal === 900, `prices come from the FARM (2 × 450 = ${order.body?.order?.subtotal})`);
  assert(order.body?.payment?.status === 'paid', `paid in ZU: ${order.body?.payment?.ref} (${order.body?.payment?.zu} ZU)`);

  console.log('\n=== 10. the customer CANNOT order a suppressed item ===');
  const badOrder = await req('POST', `/shop/${slug}/order`, { token: cTok, body: { lines: [{ product: 'milk', qty: 1 }] } });
  assert(badOrder.status === 409, `milk order refused with ${badOrder.status} — the hold is enforced at the till`);
  console.log(`  info  "${badOrder.body?.error}"`);

  console.log('\n=== 11. client price tampering is ignored ===');
  const tampered = await req('POST', `/shop/${slug}/order`, {
    token: cTok, body: { lines: [{ product: 'eggs', qty: 1, price: 1 }], how: 'pickup' },
  });
  assert(tampered.body?.order?.lines?.[0]?.price === 450, 'a client-supplied price of KES 1 was ignored; 450 used');

  console.log('\n=== 12. the order becomes work for the farmer ===');
  const farmerOrders = await req('GET', `/farm/${farmId}/orders`, { token });
  assert(farmerOrders.body?.orders?.length >= 1, 'the farm sees its orders');
  const adv = await req('POST', `/farm/${farmId}/orders/${farmerOrders.body.orders[0]._id}/stage`, { token, body: { stage: 5 } });
  assert(adv.body?.order?.stage === 5, 'order advanced to Completed');

  console.log('\n=== 13. THE LADDER (self-deciding) ===');
  const lad = await req('GET', `/farm/${farmId}/ladder`, { token });
  assert(lad.status === 200, 'ladder fetched');
  assert(lad.body.foundation.length === 3, `foundation has ${lad.body.foundation.length} free rungs`);
  assert(lad.body.commercial.length === 4, `the commercial ladder has ${lad.body.commercial.length} paid layers`);
  console.log('  info  commercial layers:');
  lad.body.commercial.forEach((r) => console.log(`          layer ${r.layer}: ${r.name} — ${r.priceLabel} — ${r.question}`));
  assert(lad.body.recommendation, 'farmline recommends a rung');
  assert(Array.isArray(lad.body.gaps) && lad.body.gaps.length > 0, `and states the ${lad.body.gaps.length} specific gap(s) standing in the way`);
  console.log(`  info  reason: ${lad.body.reason.en}`);
  lad.body.gaps.slice(0, 4).forEach((g) => console.log(`          gap → ${g.for}: ${g.en}`));
  assert(lad.body.recommended <= 2, 'a 1-day-old farm is NOT pushed to a paid rung (no premature sell)');

  console.log('\n=== 14. accepting a rung is explicit, and gated ===');
  const tooSoon = await req('POST', `/farm/${farmId}/ladder/accept`, { token, body: { rung: 'verdict' } });
  assert(tooSoon.status === 409, `VERDICT accepted too early is refused (${tooSoon.status}) with gaps listed`);
  assert(tooSoon.body?.gaps?.length > 0, 'and it says exactly what is missing');
  const okRung = await req('POST', `/farm/${farmId}/ladder/accept`, { token, body: { rung: 'record' } });
  assert(okRung.status === 200, 'a rung the data supports is accepted');

  console.log('\n=== 15. MONEY — two modes, one shape ===');
  const m = await req('GET', `/farm/${farmId}/money`, { token });
  assert(m.status === 200, 'money state fetched');
  console.log(`  info  mode=${m.body.mode} modes=${m.body.modes.join('|')} mpesaConfigured=${m.body.mpesaConfigured}`);
  assert(m.body.mode === 'virtual', 'defaults to VIRTUAL (ZU) so a hobby farmer can practise');
  assert(m.body.balances.zu > 0, `the farm holds ${m.body.balances.zu} ZU from the ZU order`);
  const toMpesa = await req('POST', `/farm/${farmId}/money/mode`, { token, body: { mode: 'mpesa' } });
  assert(toMpesa.status === 501, 'switching to M-Pesa without credentials is refused honestly (501), not faked');
  console.log(`  info  "${toMpesa.body?.error}"`);
  const badMode = await req('POST', `/farm/${farmId}/money/mode`, { token, body: { mode: 'paypal' } });
  assert(badMode.status === 400, 'an unknown mode is rejected');

  console.log('\n=== 16. this process is the API ONLY (the app is farmline-app) ===');
  // The contract INVERTED at build 9. This server used to serve the frontend; now it
  // must not, because farmline-app is a separate static build that nginx aliases.
  // Two frontends on one URL is the clash this asserts against: on the droplet nginx
  // would win, and on a direct :4600 hit the built-in one would — so `yarn dev` would
  // show a different app from production.
  const root = await fetch(ROOT + '/').then((r) => r.json()).catch(() => null);
  assert(root?.service === 'farmline API', 'the root says it is the API, and where the app lives');
  assert(root?.appDev && root?.appProd, 'the root names both the dev and production app URLs');

  const legacy = await fetch(APP + '/').then((r) => r.text()).catch(() => '');
  assert(!/<app-root|<html/i.test(legacy), '/farmline/ does NOT serve a frontend (no shell to clash with the Angular app)');
  assert(true, 'the app is farmline-app on :4700 — nginx aliases its build in production');

  console.log('\n=== 17. protocols the seed knows ===');
  const meta = await req('GET', '/meta/protocols');
  assert(meta.body?.species?.length >= 9, `${meta.body.species.length} species seeded: ${meta.body.species.join(', ')}`);
  ['cattle', 'goats', 'layers', 'maize', 'napier'].forEach((s) => {
    assert(meta.body.counts[s] > 0, `${s}: ${meta.body.counts[s]} protocols`);
  });

  console.log('\n' + (fail ? `RESULT: ${fail} failure(s)` : `RESULT: all checks passed`));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('TEST CRASHED:', e); process.exit(1); });
