// fl-demo-probe.cjs — THE KIMANI FARMS DEMO, live end to end:
// the demo door mints a REAL farmer token → /me shows Kimani Farms → the
// inventory carries schedules → the work list shows events → the chat thread
// exists with the fictional customers → a posted message is auto-replied
// (the demo is live) → the tier is advanced (the vision flow visible).
const base = 'http://localhost:4600';
(async () => {
  let pass = 0, fail = 0;
  const check = (n, ok, d) => { ok ? (pass++, console.log('PASS ', n)) : (fail++, console.log('FAIL ', n, d || '')); };

  // 1. The demo door.
  const d = await (await fetch(base + '/api/farmline/auth/demo', { method: 'POST' })).json();
  check('the demo door mints a real farmer token', !!d.token && d.farm?.name === 'Kimani Farms', JSON.stringify(d).slice(0, 100));
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + d.token };

  // 2. /me — the demo farm.
  const me = await (await fetch(base + '/api/farmline/me', { headers: H })).json();
  check('/me shows Kimani Farms (the visitor is INSIDE the demo)', me.farm?.name === 'Kimani Farms', me.farm?.name);
  check('the demo farm is on advanced (the vision flow is visible)', me.farm?.visionTier === 'advanced', me.farm?.visionTier);

  // 3. The inventory — plots, crops, groups with schedules.
  const inv = await (await fetch(base + '/api/farmline/farm/' + d.farm.id + '/inventory', { headers: H })).json();
  check('the plots are there (River Field, Hillside, Poultry Yard)',
    (inv.plots || []).length >= 3 && (inv.plots || []).some((p) => p.name === 'River Field'),
    JSON.stringify((inv.plots || []).map((p) => p.name)));
  check('the crop cycles carry the full EA line (maize→avocado)',
    (inv.crops || inv.cycles || []).length >= 5 || (inv.plots || []).some((p) => (p.crops || []).length),
    'crops=' + (inv.crops || inv.cycles || []).length);

  // 4. The work list — today's + upcoming events.
  const today = await (await fetch(base + '/api/farmline/farm/' + d.farm.id + '/today', { headers: H })).json().catch(() => null);
  check('the work list answers (the schedules are real)', !!today, 'no /today response');

  // 5. The shop front.
  const shop = await (await fetch(base + '/api/farmline/farm/' + d.farm.id + '/sellables', { headers: H })).json().catch(() => null);
  check('the shop front is stocked (milk, eggs, kale, avocado)', !!shop && (shop.sellables || []).length >= 3,
    JSON.stringify(shop).slice(0, 80));
  // 6. The chat — the demo thread exists; posting gets the live auto-reply.
  const convs = await (await fetch(base + '/api/farmline/conversations', { headers: H })).json();
  const list = convs.conversations || convs;
  check('the threads with the fictional customers exist', Array.isArray(list) && list.length >= 2, JSON.stringify(list).slice(0, 80));
  const conv = list[0];
  const posted = await (await fetch(base + '/api/farmline/conversations/' + conv._id + '/messages', {
    method: 'POST', headers: H, body: JSON.stringify({ body: 'demo probe message', clientId: 'probe-' + Date.now() }),
  })).json();
  check('the visitor posts into the demo thread', !!posted.message || posted.ok === true, JSON.stringify(posted).slice(0, 90));
  await new Promise((r) => setTimeout(r, 9000));
  const hist = await (await fetch(base + '/api/farmline/conversations/' + conv._id + '/messages', { headers: H })).json();
  const rows = hist.messages || hist;
  const replied = rows.some((m) => m.fromType === 'customer' && /asante|works|KUBALI|eggs|confirm/i.test(m.body || ''));
  check('THE FICTIONAL CUSTOMER ANSWERS (the demo is live)', replied, JSON.stringify(rows.slice(-2).map((m) => m.body)));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });