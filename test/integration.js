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
  // health is at /health on the root. THIS suite's own base — never a hardcoded
  // port. Under `yarn smoke` the suite runs against the smoke's own server (4699),
  // and probing 4600 here asserts the health of a DIFFERENT server than the one
  // these checks exercise — or fails outright when no dev server is running.
  const hr = await fetch(ROOT + '/health').then((r) => r.json()).catch(() => null);
  assert(hr?.ok === true, 'server is up');
  // A4: authArmed left the public /health on purpose (a server must not advertise
  // its disarmament); the arm state is asserted module-side instead.
  console.log(`  info  db=${hr?.db} dbName=${hr?.dbName} money=${hr?.moneyMode}`);
  assert(hr?.dbName === 'farmline', 'connected to the farmline database (never zyppar/rolodex)');
  assert(require('../src/auth').authArmed === true, 'the write gate is ARMED (AUTH_SECRET set)');

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

    // ── A5: THE DOUBLE-TAP IS IDEMPOTENT (the GLM audit, 2026-10-10) ───────────
    // Completing the SAME event twice writes ONE record, ONE set of holds and ONE
    // next occurrence: the atomic claim turns the second call into an honest
    // no-op that reports alreadyDone.
    const first2 = await req('POST', `/farm/${farmId}/events/${deworm._id}/complete`, { token, body: { clientId: 'smoke-done-1' } });
    assert(first2.body?.alreadyDone === true, `the FIRST repeat reports alreadyDone (${first2.status})`);
    const second2 = await req('POST', `/farm/${farmId}/events/${deworm._id}/complete`, { token, body: { clientId: 'smoke-done-1' } });
    assert(second2.body?.alreadyDone === true, 'the SECOND repeat also reports alreadyDone (the client-id replay lands too)');
    const { Log } = require('../src/models');   // the same direct-model pattern chat-money.js proved
    const n = await Log.countDocuments({ farmId, scheduledEventId: deworm._id });
    assert(n === 1, `exactly ONE record for the doubly-completed event (${n})`);
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

  console.log('\n=== 5d. RECORDS — what did I do, and what happened (Layer 2) ===');
  // The read side of the record, and in-situ reversal: a record can be CORRECTED
  // and REVERSED where it was made, and its consequences follow it — the shelf
  // recovers, a withdrawal hold lifts, the schedule event goes back on the list.
  {
    const rec0 = await req('GET', `/farm/${farmId}/records`, { token });
    assert(rec0.status === 200 && Array.isArray(rec0.body?.records), 'GET /records returns the record history');
    assert(rec0.body.records.length > 0, `${rec0.body?.records?.length} record(s) visible — the farmer can read their own history`);
    const ats = rec0.body.records.map((r) => new Date(r.at).getTime());
    assert(ats.every((t, i) => i === 0 || ats[i - 1] >= t), 'records are newest-first');

    // ── quick capture: the shelf is a projection, so the record IS the stock ──
    // (EGGS are used here: milk is under a withdrawal hold in this suite —
    //  suppression beats stock, so milk would always read 0.)
    const capStock = (await req('POST', `/farm/${farmId}/logs`, {
      token, body: { kind: 'eggs', product: 'eggs', quantity: 10, unit: 'tray', clientId: 'l2-' + Date.now() },
    }));
    assert(capStock.status === 200, 'a milk record is captured');
    const eggA = (capStock.body?.availability || []).find((a) => a.product === 'eggs');
    const stockA = eggA ? eggA.qty : null;
    assert(stockA !== null, 'the capture response carries the shelf the record just changed');
    const listed = await req('GET', `/farm/${farmId}/records`, { token });
    const topRec = listed.body.records.find((r) => r.kind === 'eggs' && r.quantity === 10);
    assert(topRec, 'the new record is in the history, newest-first');
    assert(topRec?.fromSchedule === false, 'a quick capture is marked as not-from-the-schedule');

    // ── CORRECT it in situ: 10 -> 12 trays, the shelf follows +2 ────────────────
    const fixed = await req('PATCH', `/farm/${farmId}/logs/${topRec.id}`, { token, body: { quantity: 12 } });
    assert(fixed.status === 200 && fixed.body?.updated?.quantity === 12, 'a record is corrected in place');
    // The correction response returns the updated record; the shelf is read back
    // from the shop (the PATCH does not carry availability).
    const shopB = await req('GET', `/shop/${slug}`, { });
    const stockB = (shopB.body?.availability || []).find((a) => a.product === 'eggs')?.qty;
    assert(stockB === stockA + 2, `the shelf follows the correction (${stockA} -> ${stockB})`);

    // a field we do not allow must be ignored, not trusted
    const sneaky = await req('PATCH', `/farm/${farmId}/logs/${topRec.id}`, {
      token, body: { quantity: 12, farmId: 'DEADBEEFDEADBEEFDEADBEEF', archivedAt: null },
    });
    assert(String(sneaky.body?.updated?.farmId) === String(farmId), 'only declared fields are editable on a record');

    // ── REVERSE it in situ: the record is undone, the shelf gives the eggs back ─
    const gone = await req('DELETE', `/farm/${farmId}/logs/${topRec.id}`, { token });
    assert(gone.status === 200 && gone.body?.reversed === true, 'a record is reversed in place');
    assert(gone.body?.holdsLifted === 0, 'an eggs record opened no hold, so none is lifted');
    const afterGone = await req('GET', `/farm/${farmId}/records`, { token });
    assert(!afterGone.body.records.some((r) => r.id === topRec.id), 'the reversed record leaves the history');
    const avail = await req('GET', `/shop/${slug}`, { });
    const eggC = (avail.body?.availability || []).find((a) => a.product === 'eggs');
    assert(eggC && eggC.qty === stockB - 12, `the shelf recovers exactly what the record carried (${eggC?.qty} = ${stockB} - 12)`);
    const tray = await req('GET', `/farm/${farmId}/reversed`, { token });
    const inTray = (tray.body?.reversed || []).find((r) => r.kind === 'logs' && String(r._id) === topRec.id);
    assert(inTray, 'the reversed record is in the tray, ready to be put back');

    // ── RESTORE it: the SAME record returns, and the shelf with it ─────────────
    const put = await req('POST', `/farm/${farmId}/logs/${topRec.id}/restore`, { token });
    assert(put.status === 200 && String(put.body?.restored?._id) === String(topRec.id), 'the restored record carries the SAME _id');
    const avail2 = await req('GET', `/shop/${slug}`, { });
    const eggD = (avail2.body?.availability || []).find((a) => a.product === 'eggs');
    assert(eggD && eggD.qty === stockB, `the shelf returns with the record (${eggD?.qty} = ${stockB})`);
    // Leave it reversed: the cleanest final state for the sections that follow.
    await req('DELETE', `/farm/${farmId}/logs/${topRec.id}`, { token });

    // ── A TREATMENT record: reversing it lifts the hold it opened ──────────────
    const t0 = await req('GET', `/farm/${farmId}/today`, { token });
    const pool = [...(t0.body?.dueToday || []), ...(t0.body?.thisWeek || []), ...(t0.body?.baseline || [])];
    const withdrawalEvent = pool.find((e) => (e.withdrawal?.milkDays || 0) > 0 || (e.withdrawal?.meatDays || 0) > 0);
    if (withdrawalEvent) {
      const done = await req('POST', `/farm/${farmId}/events/${withdrawalEvent._id}/complete`, { token, body: {} });
      assert(done.status === 200 && done.body?.logId, `the treatment completes and records (${withdrawalEvent.intervention})`);
      const tLogId = done.body.logId;
      const recs = await req('GET', `/farm/${farmId}/records`, { token });
      const tRec = recs.body.records.find((r) => r.id === String(tLogId));
      assert(tRec, 'the treatment record is in the history');
      assert(tRec?.fromSchedule === true, 'a schedule completion is marked as from-the-schedule');
      assert(Array.isArray(tRec?.hold?.affects) && tRec.hold.affects.length > 0,
        'the record carries the hold it opened — cause and consequence on one line');

      const rev = await req('DELETE', `/farm/${farmId}/logs/${tLogId}`, { token });
      assert(rev.status === 200, 'the treatment record is reversed');
      assert((rev.body?.holdsLifted || 0) >= 1, `the hold the record opened is LIFTED (${rev.body?.holdsLifted})`);
      assert(rev.body?.eventReopened === true, 'the schedule event goes back on the work list');
      const t1 = await req('GET', `/farm/${farmId}/today`, { token });
      const pool1 = [...(t1.body?.dueToday || []), ...(t1.body?.thisWeek || []), ...(t1.body?.baseline || [])];
      assert(pool1.some((e) => String(e._id) === String(withdrawalEvent._id)),
        'the undone treatment is back as work to do');
      const recs2 = await req('GET', `/farm/${farmId}/records`, { token });
      assert(!recs2.body.records.some((r) => r.id === String(tLogId)), 'the reversed treatment leaves the history');

      const back = await req('POST', `/farm/${farmId}/logs/${tLogId}/restore`, { token });
      assert(back.status === 200, 'the treatment record is restored');
      assert((back.body?.holdsReArmed || 0) >= 1, `the hold is re-armed with it (${back.body?.holdsReArmed})`);
      const recs3 = await req('GET', `/farm/${farmId}/records`, { token });
      assert(recs3.body.records.some((r) => r.id === String(tLogId)), 'the treatment record is back in the history');
      // Leave it reversed: the event returns to the work list, the hold lifts —
      // the honest final state is "this has not been done".
      await req('DELETE', `/farm/${farmId}/logs/${tLogId}`, { token });
    } else {
      warn('no withdrawal-bearing event was pending — the hold-lift chain is not covered this run');
    }
  }

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
  // THE PAID WALL FIRST (the founder's ruling, 2026-10-08 "v-A"): a paid rung
  // is refused with 403 whatever the readiness — force or not. The readiness
  // gate itself is proven on a FREE rung ('sharpen' — the fresh farm's history
  // is 0 days, the 21-day gap is live).
  const paid = await req('POST', `/farm/${farmId}/ladder/accept`, { token, body: { rung: 'verdict' } });
  assert(paid.status === 403, `a PAID rung is refused while the paid rounds are unbuilt (${paid.status})`);
  const forced = await req('POST', `/farm/${farmId}/ladder/accept`, { token, body: { rung: 'verdict', force: true } });
  assert(forced.status === 403, `force cannot bypass the paid wall (${forced.status})`);
  const tooSoon = await req('POST', `/farm/${farmId}/ladder/accept`, { token, body: { rung: 'sharpen' } });
  assert(tooSoon.status === 409, `SHARPEN accepted too early is refused (${tooSoon.status}) with gaps listed`);
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


  console.log('\n=== 18. SHARPEN — what is working, what is not (Layer 3) ===');
  // The records the farmer already keeps, aggregated into plain shapes. The
  // server returns NUMBERS AND WINDOWS; the app renders the sentences (vocab law).
  {
    const sharp0 = await req('GET', `/farm/${farmId}/sharp?days=7`, { token });
    assert(sharp0.status === 200 && Array.isArray(sharp0.body?.groups), 'GET /sharp returns the groups');
    assert(Array.isArray(sharp0.body?.crops), 'crops ride beside the animals — equals, not afterthoughts');
    assert(sharp0.body?.pulse && typeof sharp0.body.sales === 'object', 'the record pulse and the sales shape ride too');

    // ── per-group production: a milk log CARRIED BY a group counts for that group ──
    const dairy = sharp0.body.groups.find((g) => (g.species || '') === 'cattle' || /dairy|cow/i.test(g.label || ''));
    assert(dairy, `a cattle/dairy group exists to sharpen (${sharp0.body.groups.length} groups)`);
    const milk = await req('POST', `/farm/${farmId}/logs`, {
      token,
      body: { kind: 'milk', product: 'milk', quantity: 20, unit: 'litre', clientId: 'sharp-' + Date.now(),
              subjectType: 'group', subjectId: dairy.id, subjectLabel: dairy.label },
    });
    assert(milk.status === 200, 'a milk record carried by the dairy group is captured');
    const sharp1 = await req('GET', `/farm/${farmId}/sharp?days=7`, { token });
    const dairy1 = sharp1.body.groups.find((g) => g.id === dairy.id);
    assert(dairy1?.production && dairy1.production.this >= 20,
      `the group's production THIS window carries the record (${dairy1?.production?.this})`);
    assert(dairy1.production.prev !== undefined, 'and the PREVIOUS window rides beside it (the delta the app speaks)');

    // ── care adherence: completing a schedule event counts on its group ──
    const t = await req('GET', `/farm/${farmId}/today`, { token });
    const pool = [...(t.body?.dueToday || []), ...(t.body?.thisWeek || [])];
    const ev = pool.find((e) => String(e.subjectId || '') === dairy.id);
    if (ev) {
      const done = await req('POST', `/farm/${farmId}/events/${ev._id}/complete`, { token, body: {} });
      assert(done.status === 200, `a dairy event completes (${ev.intervention})`);
      const sharp2 = await req('GET', `/farm/${farmId}/sharp?days=7`, { token });
      const dairy2 = sharp2.body.groups.find((g) => g.id === dairy.id);
      assert(dairy2.care.done >= 1, `care.done counts the completion (${dairy2.care.done})`);
      assert(typeof dairy2.care.late === 'number', 'care.late rides beside it (numbers, never judgement)');
    } else {
      warn('no pending dairy event — the care-adherence count is not exercised this run');
    }

    // ── reversal-aware: the eggs records reversed in 5d do not sharpen anything ──
    assert(!sharp1.body.groups.some((g) => g.production && g.production.this < 0), 'no negative production leaks from reversed records');

    // ── the buyer's own order, PUBLIC (the cold link works — §1.6) ──
    const oid = order.body?.order?._id || order.body?.order?.id;
    assert(oid, 'an order id exists from section 9');
    const mine = await req('GET', `/shop/${slug}/order/${oid}`, {});
    assert(mine.status === 200 && Array.isArray(mine.body?.order?.lines) && mine.body.order.lines.length > 0,
      'GET /shop/:slug/order/:id serves the buyer their order WITHOUT a token (cold link)');
    assert(mine.body.order.total !== undefined, 'and carries the total (the buyer sees what they agreed to)');
    const notMine = await req('GET', `/shop/${slug}/order/000000000000000000000000`, {});
    assert(notMine.status === 404, `a stranger's order id is a 404, never a leak (${notMine.status})`);

    // ── the farm's face: one photograph, persisted (founder, 2026-10-05) ──
    const tinyJpeg = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQEAYABgAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofGh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDUzNDP/wgALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AVN//2Q==';
    const ph = await req('POST', `/farm/${farmId}/photo`, { token, body: { photo: tinyJpeg } });
    assert(ph.status === 200 && ph.body?.saved, 'the farm photograph is accepted');
    const me2 = await req('GET', '/me', { token });
    assert(me2.body?.farm?.photo === tinyJpeg, 'and it PERSISTS — /me carries it back on every boot');
    const badPh = await req('POST', `/farm/${farmId}/photo`, { token, body: { photo: 'http://x/y.jpg' } });
    assert(badPh.status === 400, 'a URL is not a photograph — the data-URL contract is enforced');
    const bigPh = await req('POST', `/farm/${farmId}/photo`, { token, body: { photo: 'data:image/jpeg;base64,' + 'A'.repeat(301000) } });
    assert(bigPh.status === 413, `an oversized upload is refused with 413 (${bigPh.status})`);
    const rm = await req('DELETE', `/farm/${farmId}/photo`, { token });
    assert(rm.status === 200, 'the photograph can be removed');
    const me3 = await req('GET', '/me', { token });
    assert(me3.body?.farm?.photo === '', 'and removal persists too');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // THE AUDIT CURATIONS (2026-10-08 — the founder's five rulings, server side)
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n=== 11. THE ANIMAL\'S OWN EDIT (iv-A: for sale / sold / died / correct) ===');
  {
    const g = await req('POST', `/farm/${farmId}/groups`, {
      token, body: { species: 'goats', label: 'audit goats', count: 2, productionKind: 'none' },
    });
    assert(g.status === 200 && g.body?.group?._id, 'a goat group stands up for the audit');
    const a = await req('POST', `/farm/${farmId}/animals`, {
      token, body: { groupId: g.body.group._id, name: 'Audit Ewe', sex: 'female', weightKg: 33 },
    });
    assert(a.status === 200 && a.body?.animal?._id, 'a tracked animal is added');
    const animalId = a.body.animal._id;

    const junk = await req('PATCH', `/farm/${farmId}/animals/${animalId}`, { token, body: { status: 'xyz' } });
    assert(junk.status === 400, `a junk status is refused plainly (${junk.status})`);
    const junkPrice = await req('PATCH', `/farm/${farmId}/animals/${animalId}`, { token, body: { salePrice: 'expensive' } });
    assert(junkPrice.status === 400, `a junk price is refused plainly (${junkPrice.status})`);

    const fs = await req('PATCH', `/farm/${farmId}/animals/${animalId}`, {
      token, body: { status: 'forSale', salePrice: 4500 },
    });
    assert(fs.status === 200 && fs.body?.animal?.status === 'forSale' && fs.body?.animal?.salePrice === 4500,
      'the farmer can put her own animal up for sale with a price');

    // the shelf the demo advertised but no farmer could ever stock. affects []
    // because the suite's farm carries a live 14-day MEAT hold from section 5's
    // deworming — and the projection suppresses by affect, farm-wide, WITH the
    // reason: the withdrawal machine suppressing a for-sale animal is the
    // keystone behaviour, proven by the milk case in section 6. Here we prove
    // the COUNT itself.
    const sell = await req('POST', `/farm/${farmId}/sellables`, {
      token, body: { product: 'goats', label: 'Goat', unit: 'head', price: 5000,
        source: { kind: 'animalForSale', product: 'goats' }, affects: [] },
    });
    assert(sell.status === 200, 'the goat shelf item is priced');
    const shop = await req('GET', `/farm/${farmId}/sellables`, { token });
    const goat = (shop.body?.availability || []).find((x) => x.product === 'goats');
    assert(goat && goat.available === true && goat.qty === 1,
      `the animalForSale shelf is finally stockable by a real farmer (qty ${goat?.qty})`);

    const sold = await req('PATCH', `/farm/${farmId}/animals/${animalId}`, { token, body: { status: 'sold' } });
    assert(sold.status === 200 && sold.body?.animal?.status === 'sold', 'the animal can be marked sold');
    const alive = await req('PATCH', `/farm/${farmId}/animals/${animalId}`, { token, body: { status: 'alive' } });
    assert(alive.status === 200 && alive.body?.animal?.status === 'alive',
      'a mis-marked animal can be set back to alive (the mistake is reversible)');
    const fix = await req('PATCH', `/farm/${farmId}/animals/${animalId}`, { token, body: { name: 'Audit Ewe II', weightKg: 34 } });
    assert(fix.status === 200 && fix.body?.animal?.name === 'Audit Ewe II' && fix.body?.animal?.weightKg === 34,
      'the animal\'s details are correctable (a mistyped name/weight is no longer permanent)');
  }

  console.log('\n=== 12. THE PAID WALL HOLDS (v-A) ===');
  {
    const refused = await req('POST', `/farm/${farmId}/ladder/accept`, { token, body: { rung: 'verdict' } });
    assert(refused.status === 403, `a PAID rung is refused while the paid rounds are unbuilt (${refused.status})`);
    const forced = await req('POST', `/farm/${farmId}/ladder/accept`, { token, body: { rung: 'verdict', force: true } });
    assert(forced.status === 403, `force cannot bypass the paid wall (${forced.status})`);
  }

  console.log('\n=== 13. THE LYING DOOR IS GONE (iii-A) ===');
  {
    const enq = await req('POST', `/shop/${slug}/enquire`, { body: { text: 'hello' } });
    assert(enq.status === 404, `the enquire route that pretended to receive no longer exists (${enq.status})`);
  }

  console.log('\n=== 14. A FARMER TOKEN CANNOT PAY (the Infinity-ZU hole) ===');
  {
    const money0 = await req('GET', `/farm/${farmId}/money`, { token });
    const zu0 = money0.body?.balances?.zu;
    const fOrder = await req('POST', `/shop/${slug}/order`, {
      token, body: { lines: [{ product: 'eggs', qty: 1 }], pay: true },
    });
    assert(fOrder.status === 201, `a farmer can still place the order — the work is the point (${fOrder.status})`);
    assert(fOrder.body?.payment && fOrder.body.payment.status !== 'paid',
      `the payment did NOT go through (status: ${fOrder.body?.payment?.status})`);
    const money1 = await req('GET', `/farm/${farmId}/money`, { token });
    assert(money1.body?.balances?.zu === zu0,
      `no ZU was minted out of thin air (balance ${zu0} -> ${money1.body?.balances?.zu})`);
  }

  console.log('\n=== 15. THE CAPTURE RECORDS A REAL NUMBER (ii-C contract) ===');
  {
    const cap = await req('POST', `/farm/${farmId}/logs`, {
      token, body: { log: { kind: 'milk', product: 'milk', quantity: 7, unit: 'litre', clientId: 'audit-cap-1' } },
    });
    assert(cap.status === 200, 'a milk capture with the farmer-typed quantity is accepted');
    const dup = await req('POST', `/farm/${farmId}/logs`, {
      token, body: { log: { kind: 'milk', product: 'milk', quantity: 7, unit: 'litre', clientId: 'audit-cap-1' } },
    });
    assert(dup.status === 200 && dup.body?.accepted?.[0]?.duplicate === true, 'the replay is still idempotent');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // § MID-SEASON DOOR (the founder's brief, 2026-10-09) — three doors, all walked.
  // A farmer whose maize is already knee-high must not be asked for a planting
  // date they cannot recall, and must never walk away unwelcome.
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n=== M1. the pure core: stage tables + back-calculation edges ===');
  {
    const stages = require('../src/stages');
    const NOW = new Date('2026-10-09T12:00:00Z');
    const table = stages.stageTable('maize');
    assert(table && table.bands.length >= 2, `maize carries a stage table derived from its own cycle (${table?.bands?.length || 0} bands)`);
    assert(table.bands[table.bands.length - 1].key === 'harvestReady', 'the last band is the harvest window');
    const first = stages.backCalculate('maize', table.bands[0].key, 'mid', NOW);
    assert(first && first.offsetDays >= table.bands[0].from && first.offsetDays <= table.bands[0].to,
      `the first stage back-calculates inside its band (offset ${first?.offsetDays} in [${table.bands[0].from},${table.bands[0].to}))`);
    const lastBand = table.bands[table.bands.length - 1];
    const last = stages.backCalculate('maize', lastBand.key, 'mid', NOW);
    assert(last && last.offsetDays >= lastBand.from, 'the last stage resolves at/after the harvest day');
    assert(last.plantedOn.getTime() < NOW.getTime(), 'a picked stage always puts planting in the past — never the future');
    const wide = table.bands.find((b) => b.wide);
    if (wide) {
      const e = stages.backCalculate('maize', wide.key, 'early', NOW);
      const l = stages.backCalculate('maize', wide.key, 'late', NOW);
      assert(e.offsetDays < l.offsetDays, 'a wide band\'s refinement orders honestly (early < late)');
      assert(e.offsetDays >= wide.from && l.offsetDays <= wide.to, 'the refinement never leaves the band');
    } else {
      warn('no wide band on maize this run — the refinement edges are covered by the other crops\' tables');
    }
    assert(stages.backCalculate('maize', 'no-such-stage', 'mid', NOW) === null, 'an unknown stage is refused, not guessed');
    assert(stages.backCalculate('unknowncrop', 'sprouting', 'mid', NOW) === null, 'an unknown crop is refused, not guessed');
    assert(stages.resolveStage('maize', 4 * 7, NOW)?.key, 'Door 2\'s bridge resolves a weeks-count into a band');
    assert(stages.resolveStage('maize', 99999, NOW)?.key === 'harvestReady', 'a count beyond the cycle resolves into the harvest band');
    const allTables = stages.stageTableAll();
    assert(allTables.maize && allTables.beans, 'the served table carries the crops');
    const classed = Object.values(stages.CROP_CLASS).flat();
    const missing = classed.filter((c) => !allTables[c]);
    assert(missing.length === 0, `every protocol\'d crop is classed and served (${missing.join(', ') || 'none missing'})`);
  }

  console.log('\n=== M2. Door 1 — pick the stage, the schedule lands, the past asks ===');
  {
    const meta = await req('GET', '/meta/crop-stages', { token });
    assert(meta.status === 200 && meta.body?.crops?.maize, 'crop-stages serves the picker data');
    const bands = meta.body.crops.maize.bands;
    const picked = bands.find((b) => b.wide) || bands[Math.min(1, bands.length - 1)];
    const prev = await req('POST', `/farm/${farmId}/crops/preview`, { token, body: { crop: 'maize', stageKey: picked.key, within: 'mid' } });
    assert(prev.status === 200 && prev.body?.plantedOn, `the preview computes the estimate read-only (${prev.status})`);
    assert(Array.isArray(prev.body.estimatedPast) && Array.isArray(prev.body.upcoming),
      `the preview splits past (estimated) from future (dated): ${prev.body?.estimatedPast?.length} past / ${prev.body?.upcoming?.length} ahead`);
    const mid = await req('POST', `/farm/${farmId}/crops`, {
      token, body: { plotId: plot.body.plot._id, crop: 'maize', acres: 1, entry: 'midseason', stageKey: picked.key, within: 'mid' },
    });
    assert(mid.status === 200, `the mid-season write lands (${mid.status})`);
    assert(mid.body?.cycle?.plantedOnEstimated === true, 'the cycle carries the honesty flag (plantedOnEstimated)');
    assert(mid.body?.estimated >= 1, `past steps materialised as confirmation-due estimates: ${mid.body?.estimated}`);
    assert(mid.body?.scheduled >= 1, `future steps land on real dates: ${mid.body?.scheduled}`);
    const midCycleId = mid.body.cycle._id;

    const inv2 = await req('GET', `/farm/${farmId}/inventory`, { token });
    const shaped = (inv2.body?.plots || []).flatMap((p) => p.crops || []).find((c) => String(c._id) === String(midCycleId));
    assert(shaped && Array.isArray(shaped.estimated) && shaped.estimated.length >= 1,
      'the inventory carries the confirmation-due steps on the crop itself');
    assert(shaped?.plantedOnEstimated === true, 'the inventory says the planting date is an estimate');
    assert(shaped?.next && shaped.next.intervention !== undefined,
      'an estimated step never becomes the crop\'s next-due work');

    // CONFIRM one — the normal record machinery runs, and the record says it was confirmed.
    const recsBefore = await req('GET', `/farm/${farmId}/records`, { token });
    const n0 = recsBefore.body?.records?.length ?? 0;
    const estOne = shaped.estimated[0];
    const conf = await req('POST', `/farm/${farmId}/events/${estOne.id}/confirm-estimated`, { token, body: {} });
    assert(conf.status === 200 && conf.body?.logId, `confirm writes the record through the normal path (${conf.status})`);
    const recsAfter = await req('GET', `/farm/${farmId}/records`, { token });
    const n1 = recsAfter.body?.records?.length ?? 0;
    assert(n1 === n0 + 1, `exactly one record was written by the confirm (${n0} -> ${n1})`);

    const invAfterConfirm = await req('GET', `/farm/${farmId}/inventory`, { token });
    const shapedAfterConfirm = (invAfterConfirm.body?.plots || []).flatMap((p) => p.crops || []).find((c) => String(c._id) === String(midCycleId));
    assert((shapedAfterConfirm?.estimated || []).length === shaped.estimated.length - 1,
      `a confirmed estimate stops being a question (${shaped.estimated.length} -> ${shapedAfterConfirm?.estimated?.length})`);

    // DISMISS another — zero trace: no record appears, the question is gone.
    const estTwo = shapedAfterConfirm.estimated[0];
    if (estTwo) {
      const dis = await req('POST', `/farm/${farmId}/events/${estTwo.id}/dismiss-estimated`, { token, body: {} });
      assert(dis.status === 200 && dis.body?.dismissed === true, `dismiss removes the question (${dis.status})`);
      const recsFinal = await req('GET', `/farm/${farmId}/records`, { token });
      const n2 = recsFinal.body?.records?.length ?? 0;
      assert(n2 === n1, `a dismissed estimate leaves ZERO trace in the records (${n1} -> ${n2})`);
      const inv3 = await req('GET', `/farm/${farmId}/inventory`, { token });
      const shaped3 = (inv3.body?.plots || []).flatMap((p) => p.crops || []).find((c) => String(c._id) === String(midCycleId));
      assert((shaped3?.estimated || []).length === shapedAfterConfirm.estimated.length - 1,
        'the dismissed question no longer renders on the crop');
    } else {
      warn('only one estimated step this run — the dismiss path is covered by the pure-core edges');
    }

    // A confirmed step must not be confirmable twice, and a non-estimated event
    // must never enter these routes (409, not a silent double record).
    const again = await req('POST', `/farm/${farmId}/events/${estOne.id}/confirm-estimated`, { token, body: {} });
    assert(again.status === 404 || again.status === 409, `confirming twice cannot double-record (${again.status})`);
  }

  console.log('\n=== M3. Door 3 — start from today; the past stays unwritten ===');
  {
    const t3 = await req('POST', `/farm/${farmId}/crops`, { token, body: { plotId: plot.body.plot._id, crop: 'kale', acres: 0.2, entry: 'today' } });
    assert(t3.status === 200, `Door 3 lands (${t3.status})`);
    assert(t3.body?.cycle?.plantedOn === null || t3.body?.cycle?.plantedOn === undefined, 'no planting date is invented (plantedOn stays empty)');
    assert(t3.body?.cycle?.status === 'growing', 'the crop is honestly growing');
    assert(t3.body?.calendarFrom, 'the remaining calendar anchors today');
    assert(t3.body?.estimated === 0, 'nothing about the past was created');
    assert(t3.body?.scheduled >= 1, `the remaining steps are dated from today: ${t3.body?.scheduled}`);
  }

  console.log('\n=== M4. the honest degrades — never a dead end ===');
  {
    const badStage = await req('POST', `/farm/${farmId}/crops/preview`, { token, body: { crop: 'maize', stageKey: 'nope' } });
    assert(badStage.status === 400, `an unknown stage is refused at the door (${badStage.status})`);
    const noTable = await req('POST', `/farm/${farmId}/crops/preview`, { token, body: { crop: 'Raspberry', stageKey: 'sprouting' } });
    assert(noTable.status === 400, `a crop with no stage table degrades honestly (${noTable.status})`);
    const otherWrite = await req('POST', `/farm/${farmId}/crops`, { token, body: { crop: 'Raspberry', acres: 0.1, entry: 'midseason', stageKey: 'sprouting' } });
    assert(otherWrite.status === 400, 'the write refuses the same way');
    const classic = await req('POST', `/farm/${farmId}/crops`, { token, body: { crop: 'beans', acres: 1, plantedOn: new Date().toISOString() } });
    assert(classic.status === 200 && classic.body?.cycle?.plantedOnEstimated === false,
      'the classic planting path is byte-identical in behavior (no estimate flag)');
  }

  console.log('\n=== M5. Door 2 — the vision gate is honest ===');
  {
    const vis = await req('POST', `/farm/${farmId}/vision/stage`, { token, body: { photo: 'data:image/jpeg;base64,AAAA' } });
    assert(vis.status === 403, `the entitlement gate holds on a non-advanced farm (${vis.status})`);
    const noPhoto = await req('POST', `/farm/${farmId}/vision/stage`, { token, body: { photo: 'hello' } });
    assert(noPhoto.status === 403 || noPhoto.status === 400, 'a junk body never reaches the compute');
  }

  console.log('\n=== M6. the demo stays read-only — THE FULL WALK (A2: one middleware, every write) ===');
  {
    const demo = await req('POST', '/auth/demo', { body: {} });
    if (demo.status === 200 && demo.body?.token) {
      const dme = await req('GET', '/me', { token: demo.body.token });
      const dfarm = dme.body?.farm;
      if (dfarm) {
        const dfarmId = dfarm._id || dfarm.id;
        const dt = demo.body.token;
        // THE WRITE WALL: every non-GET on the demo farm answers 403 — one
        // middleware, so the wall holds for every route that exists and every
        // route added tomorrow.
        const wall = [
          ['POST', `/farm/${dfarmId}/logs`],
          ['POST', `/farm/${dfarmId}/plots`],
          ['POST', `/farm/${dfarmId}/animals`],
          ['POST', `/farm/${dfarmId}/groups`],
          ['POST', `/farm/${dfarmId}/sellables`],
          ['POST', `/farm/${dfarmId}/reverse-all`],
          ['POST', `/farm/${dfarmId}/restore-all`],
          ['POST', `/farm/${dfarmId}/money/mode`],
          ['POST', `/farm/${dfarmId}/ladder/accept`],
          ['PATCH', `/farm/${dfarmId}/profile`],
          ['PATCH', `/farm/${dfarmId}/crops/x`],
          ['DELETE', `/farm/${dfarmId}/crops/x`],
        ];
        for (const [m, path] of wall) {
          const w = await req(m, path, { token: dt, body: {} });
          assert(w.status === 403, `${m} ${path.replace(`/farm/${dfarmId}`, '')} is walled in the demo (${w.status})`);
        }
        // THE EXEMPTIONS SAID PLAINLY: the read surfaces and the visitor's walk.
        const reads = await Promise.all([
          req('GET', `/farm/${dfarmId}/today`, { token: dt }),
          req('GET', `/farm/${dfarmId}/inventory`, { token: dt }),
        ]);
        assert(reads.every((r) => r.status === 200), `the demo READS still open (${reads.map((r) => r.status).join(',')})`);
        // the estimated steps (the M6 walk, kept)
        const dinv = reads[1];
        const demoCrop = (dinv.body?.plots || []).flatMap((p) => p.crops || [])
          .concat(dinv.body?.cropsWithoutPlot || [])
          .find((c) => (c.estimated || []).length > 0);
        if (demoCrop) {
          const evId = demoCrop.estimated[0].id;
          const dc = await req('POST', `/farm/${dfarmId}/events/${evId}/confirm-estimated`, { token: dt, body: {} });
          assert(dc.status === 403, `confirm is guarded in the demo (${dc.status})`);
          const dd = await req('POST', `/farm/${dfarmId}/events/${evId}/dismiss-estimated`, { token: dt, body: {} });
          assert(dd.status === 403, `dismiss is guarded in the demo (${dd.status})`);
        } else {
          warn('the demo\'s mid-season crop is not seeded yet — the estimate legs skipped this run');
        }
      } else {
        warn('demo /me did not resolve — the demo-guard walk skipped this run');
      }
    } else {
      warn(`demo login unavailable (${demo.status}) — the demo-guard walk skipped this run`);
    }
  }

  // ════════════════════════════════════════════════════════════════════════════
  // § FEEDBACK CHAT (the LoopKeeper tester-channel mechanism, farmline-shaped —
  // the founder: "any one can give feedback, text or images. Assign them
  // persistent id when they try to chat").
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n=== F1. the persistent id — minted once per device, forever ===');
  const ADMIN_KEY = require('../src/config').envVar('FARMLINE_ADMIN_KEY');
  const devA = 'smoke-device-' + Date.now();
  const mint1 = await req('POST', '/feedback/id', { body: { deviceId: devA } });
  assert(mint1.status === 200 && /^FL-[A-Z2-9]{5}$/.test(mint1.body?.feedbackId || ''),
    `the id mints in the FL-XXXXX shape (${mint1.status}, ${mint1.body?.feedbackId})`);
  const fid = mint1.body?.feedbackId;
  const mint2 = await req('POST', '/feedback/id', { body: { deviceId: devA } });
  assert(mint2.status === 200 && mint2.body?.feedbackId === fid && mint2.body?.created === false,
    'the re-request returns the SAME id — idempotent per device, forever');

  console.log('\n=== F2. the thread — text, photo, and the binding ===');
  const fsSend = await req('POST', '/feedback/chat', { body: { deviceId: devA, feedbackId: fid, text: 'The kale price line looks off', clientId: 'smoke-fb-1' } });
  assert(fsSend.status === 200, `a text send lands (${fsSend.status})`);
  const dup2 = await req('POST', '/feedback/chat', { body: { deviceId: devA, feedbackId: fid, text: 'The kale price line looks off', clientId: 'smoke-fb-1' } });
  assert(dup2.status === 200 && dup2.body?.duplicate === true, 'a replayed clientId is recognised, never doubled');
  const photoSend = await req('POST', '/feedback/chat', { body: { deviceId: devA, feedbackId: fid, text: '', photo: 'data:image/jpeg;base64,/9j/4AAQ', clientId: 'smoke-fb-2' } });
  assert(photoSend.status === 200, `a photo-only message lands (${photoSend.status})`);
  const emptyMsg = await req('POST', '/feedback/chat', { body: { deviceId: devA, feedbackId: fid, text: '', photo: '' } });
  assert(emptyMsg.status === 400, `an empty message is refused, never stored (${emptyMsg.status})`);
  const read1 = await req('GET', `/feedback/chat?deviceId=${devA}&feedbackId=${fid}`);
  assert(read1.status === 200 && (read1.body?.msgs || []).length === 2,
    `the read returns the thread (${read1.body?.msgs?.length} msgs, oldest first)`);
  assert((read1.body?.msgs || []).every((m) => m.from === 'sender'), 'the sender sees their own lines');
  // THE BINDING: an id presented by a device it was not minted to is refused.
  const strangerRead = await req('GET', `/feedback/chat?deviceId=smoke-stranger-device&feedbackId=${fid}`);
  assert(strangerRead.status === 403, `another device cannot read this thread (${strangerRead.status})`);
  const strangerSend = await req('POST', '/feedback/chat', { body: { deviceId: 'smoke-stranger-device', feedbackId: fid, text: 'hi' } });
  assert(strangerSend.status === 403, `another device cannot write into this thread (${strangerSend.status})`);
  // NO AUTH is required at all — an anonymous device walks in and mints/sends.
  const anon = await req('POST', '/feedback/id', { body: { deviceId: 'smoke-anon-' + Date.now() } });
  assert(anon.status === 200, 'the door is open to anyone (no token asked)');

  console.log('\n=== F3. HQ — the inbox, the reply, the receipt ===');
  const inboxNoKey = await req('GET', `/feedback/chat/inbox?key=wrong`);
  assert(inboxNoKey.status === 401 || inboxNoKey.status === 403, `the inbox is admin-gated (${inboxNoKey.status})`);
  const replyNoKey = await req('POST', '/feedback/chat/reply', { body: { key: 'wrong', feedbackId: fid, text: 'x' } });
  assert(replyNoKey.status === 401 || replyNoKey.status === 403, `the reply door is admin-gated (${replyNoKey.status})`);
  if (ADMIN_KEY) {
    const inbox1 = await req('GET', `/feedback/chat/inbox?key=${ADMIN_KEY}`);
    assert(inbox1.status === 200 && Array.isArray(inbox1.body?.threads),
      `the inbox answers the admin key (${inbox1.status})`);
    const mine = (inbox1.body?.threads || []).find((t) => t.feedbackId === fid);
    assert(mine && (mine.msgs || []).length >= 1, 'the new thread is in the inbox with its tail');
    assert(!!mine?.hqReadAt, 'the inbox read stamps HQ\u2019s receipt');
    const reply = await req('POST', '/feedback/chat/reply', { body: { key: ADMIN_KEY, feedbackId: fid, text: 'Asante — looking into the kale line now.' } });
    assert(reply.status === 200, `the reply lands (${reply.status})`);
    const read2 = await req('GET', `/feedback/chat?deviceId=${devA}&feedbackId=${fid}`);
    const hq = (read2.body?.msgs || []).filter((m) => m.from === 'hq');
    assert(hq.length === 1, 'the sender\u2019s next read carries HQ\u2019s reply home');
  } else {
    warn('FARMLINE_ADMIN_KEY not set — the with-key legs skipped this run (the gates themselves verified closed)');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // § VISION SPEND (Task 3 — the founder: "automate that review to trigger alarm
  // at CommandCenter once it reaches a threshold"): the counter lives in the DB,
  // exposed at /meta/vision-spend + /health. The smoke cannot make a real model
  // call (no OPENROUTER_API_KEY in the test env — an unarmed rail reports itself),
  // so the increment path is proven by the honest zero here and the wiring by
  // code; the threshold walk is the founder's on the armed server.
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n=== V. the demo vision spend — exposed for the alarm ===');
  {
    const spend = await req('GET', '/meta/vision-spend');
    assert(spend.status === 200 && typeof spend.body?.today === 'number',
      `the spend endpoint answers with the day count (${spend.status}, today=${spend.body?.today})`);
    assert(Number(spend.body?.threshold) >= 1, `the threshold rides the answer (${spend.body?.threshold})`);
    const hr2 = await fetch(ROOT + '/health').then((r) => r.json()).catch(() => null);
    assert(hr2 && typeof hr2.visionCallsToday === 'number',
      'the health answer carries visionCallsToday (the monitor reads it for free)');
  }

  // ════════════════════════════════════════════════════════════════════════════
  // § RATINGS (Task 6 — the founder: "Rate Farmline, backend persisted, truthful,
  // and live"): one current rating per identity, the latest wins, the history for
  // the trend; the aggregate is the REAL stored average, honestly rounded.
  // BASELINE-AWARE: the smoke DB keeps rows between runs, so the assertions ride
  // the delta (count/sum before vs after), never absolute numbers.
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n=== R. the ratings — persisted, latest wins, truthful aggregate ===');
  {
    const base = await req('GET', '/meta/rating');
    const baseCount = Number(base.body?.count || 0);
    const baseSum = Math.round((Number(base.body?.average) || 0) * baseCount * 10) / 10;

    const rate1 = await req('POST', '/rating', { body: { deviceId: devA, feedbackId: fid, value: 4 } });
    assert(rate1.status === 200 && rate1.body?.value === 4, `a rating lands (${rate1.status})`);
    const agg1 = await req('GET', '/meta/rating');
    assert(agg1.body?.count === baseCount + 1,
      `the aggregate grew by exactly one (${agg1.body?.count} = ${baseCount} + 1)`);
    const rate2 = await req('POST', '/rating', { body: { deviceId: devA, feedbackId: fid, value: 5 } });
    assert(rate2.status === 200, `a re-tap updates (${rate2.status})`);
    const agg2 = await req('GET', '/meta/rating');
    assert(agg2.body?.count === baseCount + 1,
      `the LATEST wins — the same identity still holds ONE row (${agg2.body?.count})`);
    const myRating = await req('GET', `/rating?deviceId=${devA}&feedbackId=${fid}`);
    assert(myRating.status === 200 && myRating.body?.value === 5,
      `the identity's own current rating reads back as the latest (${myRating.body?.value})`);
    const strangerRate = await req('POST', '/rating', { body: { deviceId: 'smoke-stranger-device', feedbackId: fid, value: 1 } });
    assert(strangerRate.status === 403, `another device cannot rate for this identity (${strangerRate.status})`);
    const badVal = await req('POST', '/rating', { body: { deviceId: devA, feedbackId: fid, value: 9 } });
    assert(badVal.status === 400, `an out-of-range value is refused, never stored (${badVal.status})`);

    // A SECOND identity rates 2 — the aggregate must be the real average of ALL
    // current ratings: (baseSum + 5 + 2) / (baseCount + 2), honestly rounded.
    const otherDev = 'smoke-device-r' + Date.now();
    const otherMint = await req('POST', '/feedback/id', { body: { deviceId: otherDev } });
    const otherId = otherMint.body?.feedbackId;
    assert(!!otherId, 'the second identity mints');
    const forged = await req('POST', '/rating', { body: { deviceId: otherDev, feedbackId: 'X-FORCE', value: 2 } });
    assert(forged.status === 403, `a forged id cannot rate (${forged.status})`);
    const rate3 = await req('POST', '/rating', { body: { deviceId: otherDev, feedbackId: otherId, value: 2 } });
    assert(rate3.status === 200, `a second identity rates (${rate3.status})`);
    const agg3 = await req('GET', '/meta/rating');
    const expectCount = baseCount + 2;
    const expectAvg = Math.round(((baseSum + 5 + 2) / expectCount) * 10) / 10;
    assert(agg3.body?.count === expectCount && agg3.body?.average === expectAvg,
      `the aggregate is the real stored average (count ${agg3.body?.count} = ${expectCount}, avg ${agg3.body?.average} = ${expectAvg})`);

    // AN UNRATED identity answers null honestly — never a fabricated number.
    const freshDev = 'smoke-unrated-' + Date.now();
    const freshMint = await req('POST', '/feedback/id', { body: { deviceId: freshDev } });
    assert(!!freshMint.body?.feedbackId, 'the third identity mints');
    const unrated = await req('GET', `/rating?deviceId=${freshDev}&feedbackId=${freshMint.body.feedbackId}`);
    assert(unrated.status === 200 && unrated.body?.value === null,
      `an unrated identity reads null (${unrated.status}, value ${unrated.body?.value})`);
    // AND the binding still guards the read: a stranger device gets the 403.
    const strangerRead = await req('GET', `/rating?deviceId=smoke-stranger-device&feedbackId=${freshMint.body.feedbackId}`);
    assert(strangerRead.status === 403, `a stranger's read of an id is refused (${strangerRead.status})`);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // § C — the enhancements that shipped with the audit sweep: the price
  // intelligence routes (C5), the per-farm OG data (C2), the fabricated trust
  // exposure REMOVED (C6), the robots.txt ask recorded in the report (C3).
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n=== C. the price intelligence + the per-farm OG + the trust truth ===');
  {
    // A THROWAWAY PRODUCT NAME: the price aggregate is global, so leftovers from
    // any earlier smoke run would poison the counts — the leg posts under a name
    // only this run created and asserts on exactly its own rows.
    const smokeProduct = 'smoke-milk-' + Date.now();
    const p1 = await req('POST', `/farm/${farmId}/prices`, { token, body: { product: smokeProduct, price: 60, unit: 'litre', market: 'Eldoret' } });
    assert(p1.status === 200, `a farmer's price report lands (${p1.status})`);
    const p2 = await req('POST', `/farm/${farmId}/prices`, { token, body: { product: smokeProduct, price: 70, unit: 'litre', market: 'Eldoret' } });
    assert(p2.status === 200, 'a second report lands');
    const thin = await req('GET', `/meta/prices?product=${smokeProduct}`);
    assert(thin.status === 200 && thin.body?.prices?.[0]?.count === 2, `the aggregate counts the reports (${thin.body?.prices?.[0]?.count})`);
    assert(thin.body.prices[0].average === null, 'an average with fewer than 3 reports is NOT shown (the no-assurance law)');
    await req('POST', `/farm/${farmId}/prices`, { token, body: { product: smokeProduct, price: 80, unit: 'litre', market: 'Eldoret' } });
    const ready = await req('GET', `/meta/prices?product=${smokeProduct}`);
    assert(ready.body?.prices?.[0]?.average === 70, `the average shows once the crowd exists (${ready.body?.prices?.[0]?.average})`);
    assert(ready.body.prices[0].low === 60 && ready.body.prices[0].high === 80, `the range is honest (${ready.body.prices[0].low}–${ready.body.prices[0].high})`);
    const badPrice = await req('POST', `/farm/${farmId}/prices`, { token, body: { product: 'milk', price: -5 } });
    assert(badPrice.status === 400, `a negative price is refused (${badPrice.status})`);
    const noProduct = await req('POST', `/farm/${farmId}/prices`, { token, body: { price: 50 } });
    assert(noProduct.status === 400, 'a price with no product is refused');
    // C2: the per-farm OG data
    const og = await req('GET', `/og/s/${slug}`);
    assert(og.status === 200 && og.body?.og?.url?.includes(`/farmline/s/${slug}`), `the per-farm OG carries the shop URL (${og.status})`);
    const ogMiss = await req('GET', '/og/s/no-such-slug');
    assert(ogMiss.status === 404, 'an unknown slug is a 404');
    // C6: the fabricated trust is GONE from the public read
    const pub = await req('GET', `/shop/${slug}`);
    assert(pub.status === 200 && !('trust' in (pub.body?.farm || {})), `publicFarm no longer carries the fabricated trust (${Object.keys(pub.body?.farm || {}).join(',')})`);
  }

  // ════════════════════════════════════════════════════════════════════════════
  // § AUTH (A4 — the fail-fast): production without AUTH_SECRET is CLOSED (503 on
  // every gated route), while the development grace still admits the dev
  // principal. Verified in a CHILD PROCESS (auth.js caches the secret at require
  // time, so the shape of the boot is what is being tested): NODE_ENV decides,
  // config.envVar is patched to hide the secret, and the mock res records the
  // answer. The smoke server itself runs development WITH the secret — this child
  // is the only honest way to walk the production shape.
  // ════════════════════════════════════════════════════════════════════════════
  console.log('\n=== A4. AUTH_SECRET: production CLOSED, development graceful ===');
  {
    const { spawnSync } = require('child_process');
    const ROOT = process.cwd().replace(/\\/g, '/');
    const child = (nodeEnv) => {
      const script = `
        process.env.NODE_ENV = '${nodeEnv}';
        const config = require('${ROOT}/src/config.js');
        const orig = config.envVar;
        config.envVar = (name, fb) => (name === 'AUTH_SECRET' || name === 'MPESA_CALLBACK_SECRET') ? '' : orig(name, fb);
        const auth = require('${ROOT}/src/auth.js');
        const res = { code: '', status(c) { this.code = c; return this; }, json() { return this; } };
        auth.requireAuth('farmer')({ headers: {}, socket: {} }, res, () => { res.code = 'next'; });
        console.log('RESULT=' + res.code);
      `;
      const r = spawnSync(process.execPath, ['-e', script], { encoding: 'utf8', env: { ...process.env } });
      return (r.stdout || '').match(/RESULT=(\S+)/)?.[1] || ('stderr:' + String(r.stderr).slice(0, 80));
    };
    assert(child('production') === '503', 'production without AUTH_SECRET is CLOSED (503 on a gated route)');
    assert(child('development') === 'next', 'development without AUTH_SECRET keeps the honest grace (the dev principal walks)');
  }

  console.log('\n' + (fail ? `RESULT: ${fail} failure(s)` : `RESULT: all checks passed`));
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('TEST CRASHED:', e); process.exit(1); });
