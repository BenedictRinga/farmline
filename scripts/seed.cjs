// scripts/seed.cjs — a populated farm for debugging, in one command.
//
//   yarn seed                          # against http://localhost:4600 (dev)
//   yarn seed https://staging.example  # against any target
//
// WHY: debugging farmline from an empty farm means clicking through setup, adding
// animals, waiting for a schedule, logging milk and pricing a product EVERY time
// you want to look at one screen. This creates a farm that is already a week into
// its life — animals, crops, records, a withdrawal hold, prices, an order — so you
// can debug the interesting states immediately.
//
// It goes through the REAL API, never the models directly: if seeding breaks, the
// app is broken, and you find out here rather than in front of a farmer.
//
// Re-runnable. The same phone is reused: a second run signs in instead of
// registering, and tops the farm up.
const ROOT_URL = (process.argv[2] || process.env.FARMLINE_BASE || 'http://localhost:4600').replace(/\/$/, '');
const BASE = ROOT_URL + '/api/farmline';

const PHONE = process.env.SEED_PHONE || '0700000001';
const PIN = process.env.SEED_PIN || '1234';
const FARM_NAME = process.env.SEED_FARM || 'Debug Farm';

const log = (m) => console.log('  ' + m);
const step = (m) => console.log('\n' + m);

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

(async () => {
  console.log(`\nfarmline seed → ${ROOT_URL}\n`);

  const ver = await call('GET', '/version');
  if (!ver.body?.build) {
    console.error(`  FATAL ${ROOT_URL}/api/farmline/version did not answer JSON. Is the server running?`);
    process.exit(1);
  }
  log(`server build ${ver.body.build} · env=${ver.body.env} · db=${ver.body.dbName}`);
  if (ver.body.isProduction === true) {
    console.error('  REFUSING: that target is PRODUCTION. Seed a dev or staging server.');
    process.exit(1);
  }

  // ── 1. the farmer ──────────────────────────────────────────────────────────
  step('farmer');
  let token = null;
  const reg = await call('POST', '/auth/farmer/register', { phone: PHONE, pin: PIN, name: 'Debug', farmName: FARM_NAME });
  if (reg.body?.token) {
    token = reg.body.token;
    log(`registered ${PHONE} (pin ${PIN})`);
  } else {
    const login = await call('POST', '/auth/farmer/login', { phone: PHONE, pin: PIN });
    if (!login.body?.token) {
      console.error(`  FATAL could not register or sign in as ${PHONE}: ${reg.body?.error || login.body?.error}`);
      process.exit(1);
    }
    token = login.body.token;
    log(`signed in as the existing ${PHONE} (pin ${PIN})`);
  }
  const me = await call('GET', '/me', null, token);
  const farmId = me.body.farm._id;
  const slug = me.body.farm.slug;
  log(`farm ${me.body.farm.name} · ${slug}`);

  // ── 2. a farm that looks lived-in ──────────────────────────────────────────
  step('the farm');
  await call('POST', `/farm/${farmId}/plots`, { name: 'Plot A', acres: 2 }, token);
  await call('POST', `/farm/${farmId}/plots`, { name: 'Plot B', acres: 1.5 }, token);
  log('2 plots');

  for (const [species, count, label] of [['cattle', 6, 'Dairy'], ['goats', 4, 'Mbuzi'], ['layers', 20, 'Layers']]) {
    await call('POST', `/farm/${farmId}/groups`, { species, label, count }, token);
    log(`group ${label} × ${count}`);
  }
  await call('POST', `/farm/${farmId}/crops`, {
    crop: 'maize', acres: 2,
    plantedOn: new Date(Date.now() - 35 * 86400000).toISOString(),   // planted 35 days ago,
    season: 'short rains',                                            // so top-dressing is due
  }, token);
  log('maize, 2 acres, planted 35 days ago');

  // The schedule is generated server-side, so count it FROM the server rather than
  // guessing at what the create routes return.
  const sched = await call('GET', `/farm/${farmId}/today`, null, token);
  const sc = sched.body?.counts || {};
  log(`schedule: ${sc.today || 0} due today · ${sc.week || 0} this week · ${sc.baseline || 0} baselines to confirm`);

  // ── 3. records, so the shop has stock ──────────────────────────────────────
  step('records');
  const stamp = Date.now();
  for (let i = 0; i < 3; i++) {
    await call('POST', `/farm/${farmId}/logs`, {
      log: { kind: 'milk', product: 'milk', quantity: 42, unit: 'litre', clientId: `seed-milk-${stamp}-${i}` },
    }, token);
    await call('POST', `/farm/${farmId}/logs`, {
      log: { kind: 'eggs', product: 'eggs', quantity: 12, unit: 'tray', clientId: `seed-eggs-${stamp}-${i}` },
    }, token);
  }
  log('3 days of milk (42 L) and eggs (12 trays)');

  // ── 4. prices — without these the shop is empty BY DEFINITION ──────────────
  step('prices (the Uza panel)');
  await call('POST', `/farm/${farmId}/sellables`, {
    product: 'milk', label: 'Fresh milk', labelSw: 'Maziwa mapya', unit: 'litre', unitSw: 'lita', icon: '🥛',
    price: 60, minQty: 1, source: { kind: 'production', product: 'milk', windowDays: 1 }, affects: ['milk'],
  }, token);
  await call('POST', `/farm/${farmId}/sellables`, {
    product: 'eggs', label: 'Eggs', labelSw: 'Mayai', unit: 'tray', unitSw: 'tray', icon: '🥚',
    price: 450, minQty: 1, source: { kind: 'production', product: 'eggs', windowDays: 2 }, affects: [],
  }, token);
  log('milk KES 60/litre · eggs KES 450/tray');

  // ── 5. a withdrawal hold — the compliance payload, visible ─────────────────
  step('a treatment (creates a withdrawal hold)');
  const today = await call('GET', `/farm/${farmId}/today`, null, token);
  const pool = [...(today.body?.baseline || []), ...(today.body?.dueToday || [])];
  // DEWORM FIRST, deliberately. A tick spray carries NO withdrawal (cattle.spray is
  // milkDays:0 meatDays:0), so completing one would prove nothing about the hold
  // mechanism — the single most useful state to be able to look at in dev.
  const treatment = pool.find((e) => /deworm/i.test(e.intervention))
    || pool.find((e) => /spray|vacc/i.test(e.intervention))
    || pool[0];
  if (treatment) {
    const done = await call('POST', `/farm/${farmId}/events/${treatment._id}/complete`, {}, token);
    const holds = done.body?.holds || [];
    holds.length
      ? log(`completed "${treatment.intervention}" → holding ${holds.map((h) => h.affects.join('/') + ' ' + h.days + 'd').join(', ')}`)
      : log(`completed "${treatment.intervention}" → no withdrawal on this protocol`);
  } else {
    log('no events to complete yet');
  }

  // ── 6. a customer order, so the farmer has work waiting ────────────────────
  step('a customer order');
  const cust = await call('POST', '/auth/customer', { phone: '0711111111', name: 'Debug Buyer', slug });
  if (cust.body?.token) {
    const shop = await call('GET', `/shop/${slug}`);
    const buyable = (shop.body?.availability || []).find((a) => a.available && a.qty > 0);
    if (buyable) {
      const ord = await call('POST', `/shop/${slug}/order`, {
        lines: [{ product: buyable.product, qty: 2 }],
        how: 'pickup', slot: 'Kesho 7:00 – 9:00 asubuhi', addr: '', note: 'seed order', pay: true,
      }, cust.body.token);
      log(ord.body?.ok ? `order ${ord.body.order.ref} · ${buyable.qty} ${buyable.unit} of ${buyable.label} available` : `order failed: ${ord.body?.error}`);
    } else {
      log('nothing buyable yet — the hold may be suppressing the only priced item (that is correct behaviour)');
    }
  } else {
    log(`customer sign-in failed: ${cust.body?.error}`);
  }

  // ── report ─────────────────────────────────────────────────────────────────
  const finalShop = await call('GET', `/shop/${slug}`);
  step('what you can now look at');
  console.log(`  app      ${ROOT_URL}/farmline/`);
  console.log(`  shop     ${ROOT_URL}/farmline/s/${slug}     <- the customer face`);
  console.log(`  sign in  ${PHONE} / ${PIN}`);
  console.log(`  api      ${ROOT_URL}/api/farmline/version`);
  console.log('\n  shop now shows:');
  for (const a of finalShop.body?.availability || []) {
    console.log(`    ${a.suppressed ? '⛔' : a.available ? '✓' : '·'} ${a.label} — ${a.qty} ${a.unit} @ KES ${a.price}`
      + (a.suppressed ? ` (held: ${a.reason})` : ''));
  }
  console.log('');
})();
