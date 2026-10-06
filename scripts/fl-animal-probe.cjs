// scripts/fl-animal-probe.cjs — the per-animal story, live: create a probe
// flock + a tracked animal, hit the detail route, assert the story, reverse.
const base = process.argv[2] || 'http://localhost:4600';
(async () => {
  const login = await fetch(base + '/api/farmline/auth/farmer/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '0700000001', pin: '1234' }),
  });
  const lj = await login.json();
  if (!lj.token) { console.log('LOGIN FAIL'); process.exit(1); }
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + lj.token };
  const me = await (await fetch(base + '/api/farmline/me', { headers: H })).json();
  const farmId = me.farm?._id || me.farm;

  const sheep = await (await fetch(`${base}/api/farmline/farm/${farmId}/groups`, { method: 'POST', headers: H, body: JSON.stringify({ species: 'sheep', label: 'Probe flock', count: 8, productionKind: 'meat' }) })).json();
  const groupId = sheep?.group?._id || sheep?.group;
  console.log('group:', groupId, '| scheduled:', sheep?.scheduled);

  // The tracked animal — created directly (the add-animal UI is a later tranche;
  // the STORY route and page are what this probe proves).
  const mongoose = require('mongoose');
  await mongoose.connect('mongodb://localhost:27017/farmline');
  const Animal = mongoose.connection.collection('animals');
  const ins = await Animal.insertOne({
    farmId: new (require('mongodb').ObjectId)(farmId),
    groupId: new (require('mongodb').ObjectId)(String(groupId)),
    name: 'Zawadi', tag: 'SH-01', species: 'sheep', sex: 'ewe',
    weightKg: 38, status: 'alive', salePrice: 0, photo: '',
    createdAt: new Date(), updatedAt: new Date(),
  });
  const animalId = String(ins.insertedId);
  await mongoose.disconnect();

  const d = await (await fetch(`${base}/api/farmline/farm/${farmId}/animal/${animalId}`, { headers: H })).json();
  console.log('story:', JSON.stringify({
    name: d?.animal?.name, tag: d?.animal?.tag, group: d?.group?.label,
    events: d?.events?.length, upcomingKes: d?.upcomingKes,
    firstLabel: d?.events?.[0]?.label || null, records: d?.records?.length,
  }));

  // cleanup (KEEP=1 leaves the animal + group for the page probe)
  if (!process.env.KEEP) {
    await (async () => { const m = require('mongoose'); await m.connect('mongodb://localhost:27017/farmline'); await m.connection.collection('animals').deleteOne({ _id: new (require('mongodb').ObjectId)(animalId) }); await m.disconnect(); })();
    const del = await (await fetch(`${base}/api/farmline/farm/${farmId}/groups/${groupId}`, { method: 'DELETE', headers: H })).json();
    console.log('reversed:', del.ok || del.archived ? 'ok' : JSON.stringify(del).slice(0, 60));
  } else {
    require('fs').writeFileSync('C:/Users/mTrustQ Kenya No1/AppData/Local/Temp/fl-animal-id.txt', animalId + ' ' + farmId);
    console.log('KEPT for the page probe:', animalId, farmId);
  }

  let fail = 0;
  if (d?.animal?.name !== 'Zawadi') { console.log('FAIL identity'); fail++; }
  if (!d?.group?.label) { console.log('FAIL group'); fail++; }
  if ((d?.events?.length || 0) < 6) { console.log('FAIL events', d?.events?.length); fail++; }
  if (!(d?.events?.[0]?.label?.en)) { console.log('FAIL bilingual labels'); fail++; }
  if (!(d?.upcomingKes > 0)) { console.log('FAIL upcoming money'); fail++; }
  console.log(fail ? `\n${fail} FAIL` : '\nTHE ANIMAL STORY IS LIVE');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });