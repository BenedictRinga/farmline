// fl-protocols-probe.cjs — the live end-to-end: the new protocols actually
// materialise through the engine, and reverse cleanly (leave nothing behind).
//   node fl-protocols-probe.cjs [base]
const base = process.argv[2] || 'http://localhost:4600';
const J = (r) => { const t = typeof r === 'string' ? r : JSON.stringify(r); console.log(t); return t; };
(async () => {
  const login = await fetch(base + '/api/farmline/auth/farmer/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '0700000001', pin: '1234' }),
  });
  const lj = await login.json();
  if (!lj.token) { console.log('LOGIN FAIL', JSON.stringify(lj).slice(0, 200)); process.exit(1); }
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + lj.token };
  const me = await (await fetch(base + '/api/farmline/me', { headers: H })).json();
  const farmId = me.farm?._id || me.farm;
  console.log('farm:', farmId);

  // 1. A PLOT for the probe (own plot → clean reversal of the cycle).
  const plot = await (await fetch(`${base}/api/farmline/farm/${farmId}/plots`, { method: 'POST', headers: H, body: JSON.stringify({ name: 'Probe Avocado Plot', size: 0.5 }) })).json();
  const plotId = plot.plot?._id || plot.plot;
  console.log('plot:', plotId);

  // 2. THE AVOCADO CYCLE — the perennial's 7-step schedule materialises.
  const cyc = await (await fetch(`${base}/api/farmline/farm/${farmId}/crops`, { method: 'POST', headers: H, body: JSON.stringify({ plotId, crop: 'avocado', acres: 0.5, plantedOn: new Date().toISOString().slice(0, 10) }) })).json();
  console.log('AVOCADO scheduled:', JSON.stringify(cyc?.scheduled));
  const cycleId = cyc?.cycle?._id || cyc?.cycle;
  // The inventory snapshot is where open events surface; count by intervention prefix.
  const inv = await (await fetch(`${base}/api/farmline/farm/${farmId}/inventory`, { headers: H })).json();
  const flat = JSON.stringify(inv);
  const avCount = (flat.match(/avocado\./g) || []).length;
  console.log('AVOCADO events visible in inventory:', avCount);

  // 3. THE SHEEP GROUP — the species gate must ACCEPT (protocol exists now).
  const sheep = await (await fetch(`${base}/api/farmline/farm/${farmId}/groups`, { method: 'POST', headers: H, body: JSON.stringify({ species: 'sheep', label: 'Probe flock', count: 8, productionKind: 'meat' }) })).json();
  console.log('SHEEP scheduled:', JSON.stringify(sheep?.scheduled));
  const sheepId = sheep?.group?._id || sheep?.group;
  const inv2 = await (await fetch(`${base}/api/farmline/farm/${farmId}/inventory`, { headers: H })).json();
  const flat2 = JSON.stringify(inv2);
  const sheepCount = (flat2.match(/sheep\./g) || []).length;
  const baselineCount = (flat2.match(/"isBaseline":true/g) || []).length;
  console.log('SHEEP events visible in inventory:', sheepCount, '| baselines (confirm-the-baseline):', baselineCount);

  // 4. REVERSE EVERYTHING — the probe leaves the seeded farm clean.
  const d1 = await (await fetch(`${base}/api/farmline/farm/${farmId}/crops/${cycleId}`, { method: 'DELETE', headers: H })).json();
  const d2 = await (await fetch(`${base}/api/farmline/farm/${farmId}/groups/${sheepId}`, { method: 'DELETE', headers: H })).json();
  const d3 = await (await fetch(`${base}/api/farmline/farm/${farmId}/plots/${plotId}`, { method: 'DELETE', headers: H })).json();
  console.log('reversed:', [d1, d2, d3].map((d) => d.ok || d.archived ? 'ok' : JSON.stringify(d).slice(0, 60)).join(' | '));

  let fail = 0;
  // The creation counts ARE the schedule truth (materialise returned them);
  // the inventory intentionally surfaces only the SOONEST event per subject
  // (the farmer screen answers "what is next", not the whole ledger).
  if (cyc?.scheduled < 7) { console.log('FAIL avocado scheduled', cyc?.scheduled); fail++; }
  if (avCount < 1) { console.log('FAIL avocado next-due not surfaced', avCount); fail++; }
  if (sheep?.scheduled < 6) { console.log('FAIL sheep scheduled', sheep?.scheduled); fail++; }
  if (sheepCount < 1) { console.log('FAIL sheep next-due not surfaced', sheepCount); fail++; }
  console.log(fail ? `\n${fail} FAIL` : '\nPROTOCOLS LIVE END-TO-END');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });