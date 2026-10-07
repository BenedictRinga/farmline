// fl-vision-probe.cjs — the AI-vision hand, live: the tier gate (403 for a
// non-advanced farm), the not-armed 503, and the advanced-farm shape (with a
// fake key the service 502s honestly — no real call from the probe).
const base = 'http://localhost:4600';
(async () => {
  const login = await fetch(base + '/api/farmline/auth/farmer/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '0700000001', pin: '1234' }),
  });
  const lj = await login.json();
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + lj.token };
  const me = await (await fetch(base + '/api/farmline/me', { headers: H })).json();
  const fid = me.farm._id;
  let pass = 0, fail = 0;
  const check = (n, ok, d) => { ok ? (pass++, console.log('PASS ', n)) : (fail++, console.log('FAIL ', n, d || '')); };

  // 1. A normal farm (tier none) → 403, the entitlement holds.
  const r1 = await fetch(`${base}/api/farmline/farm/${fid}/vision`, {
    method: 'POST', headers: H, body: JSON.stringify({ photo: 'data:image/jpeg;base64,AAAA' }),
  });
  check('a non-advanced farm is refused (403, the entitlement holds)', r1.status === 403, 'got ' + r1.status);

  // 2. Flip the farm to advanced (directly through mongo — the server-side-only tier).
  const mongoose = require('mongoose');
  await mongoose.connect('mongodb://localhost:27017/farmline');
  await mongoose.connection.collection('farms').updateOne(
    { _id: new (require('mongodb').ObjectId)(fid) }, { $set: { visionTier: 'advanced' } });
  await mongoose.disconnect();

  // 3. Advanced + no OPENROUTER_API_KEY on the running server → 503, honest.
  const r2 = await fetch(`${base}/api/farmline/farm/${fid}/vision`, {
    method: 'POST', headers: H, body: JSON.stringify({ photo: 'data:image/jpeg;base64,AAAA' }),
  });
  const j2 = await r2.json().catch(() => ({}));
  check('an advanced farm without the key gets the honest 503', r2.status === 503, r2.status + ' ' + JSON.stringify(j2).slice(0, 80));

  // 4. A junk photo on an advanced farm → 400 before the service.
  const r3 = await fetch(`${base}/api/farmline/farm/${fid}/vision`, {
    method: 'POST', headers: H, body: JSON.stringify({ photo: 'not-a-photo' }),
  });
  check('a junk photo is refused (400)', r3.status === 400, 'got ' + r3.status);

  // 5. Restore the tier (the probe leaves no trace).
  const mongoose2 = require('mongoose');
  await mongoose2.connect('mongodb://localhost:27017/farmline');
  await mongoose2.connection.collection('farms').updateOne(
    { _id: new (require('mongodb').ObjectId)(fid) }, { $set: { visionTier: 'none' } });
  await mongoose2.disconnect();

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });