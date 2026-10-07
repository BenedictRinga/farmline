// scripts/truth-chain.cjs — the update truth, live: the check must answer the
// SERVED BUNDLE's build (www/build.json), not the server's own counter.
const base = process.argv[2] || 'http://localhost:4600';
const chk = async (cb) => {
  const r = await fetch(`${base}/api/farmline/updates/check?clientBuild=${cb}`);
  const j = await r.json();
  console.log(`clientBuild=${cb} → build ${j.build} | available: ${j.isUpdateAvailable} | version: ${j.version}`);
  return j;
};
(async () => {
  const fs = require('fs');
  const stamp = JSON.parse(fs.readFileSync('../farmline-app/www/build.json', 'utf8'));
  console.log('the served bundle stamp:', JSON.stringify(stamp));
  let fail = 0;
  const a = await chk(1);
  if (Number(a.build) !== Number(stamp.build)) { console.log('FAIL: the check does not read the served bundle'); fail++; }
  if (!a.isUpdateAvailable) { console.log('FAIL: client 1 must see an update'); fail++; }
  const b = await chk(stamp.build);
  if (b.isUpdateAvailable) { console.log('FAIL: a current client must read up to date'); fail++; }
  const c = await chk(stamp.build - 6);
  if (!c.isUpdateAvailable) { console.log('FAIL: a behind client must see an update'); fail++; }
  console.log(fail ? `\n${fail} FAIL` : '\nTHE CHECK READS THE SERVED BUNDLE — the truth');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });