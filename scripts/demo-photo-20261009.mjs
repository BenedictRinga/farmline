// demo-photo-20261009.mjs — THE FOUNDER'S #3: the demo farm's photograph is
// IMMUTABLE. A demo visitor who taps × removes kimanifarms.jpg from the DEMO
// farm's doc and it never returns until a reseed — and a visitor who uploads
// a different photo persists it for every later visitor. THE CURE: the photo
// routes refuse demo farms (the 403 with the honest message) + the app hides
// the photo affordances while visiting.
import fs from 'fs';
let n = 0;
function edit(p, from, to) {
    let s = fs.readFileSync(p, 'utf8');
    if (s.includes(to.split('\n')[0]) && s.includes(to)) { console.log('SKIP (has)'); return; }
    let f = from, t = to;
    if (!s.includes(f)) { f = from.split('\n').join('\r\n'); t = to.split('\n').join('\r\n'); }
    if (!s.includes(f)) { console.log('MISS:', from.slice(0, 70).replace(/\n/g, '|')); process.exitCode = 1; return; }
    fs.writeFileSync(p, s.replace(f, t, 1));
    n++;
    console.log('OK:', from.slice(0, 55).replace(/\n/g, '|'));
}

// ── the server: the photo routes refuse demo farms ──
const S = 'src/index.js';
let svc = fs.readFileSync(S, 'utf8');
// find the photo route bodies and add the guard after the farm lookup
const photoSet = svc.match(/api\.post\('\/farm\/:farmId\/photo'[\s\S]{0,300}/);
const photoDel = svc.match(/api\.delete\('\/farm\/:farmId\/photo'[\s\S]{0,300}/);
if (!photoSet || !photoDel) { console.log('MISS photo routes'); process.exit(1); }
const GUARD = "\n  // THE DEMO WEARS HER FOUNDER'S PHOTOGRAPH (2026-10-09, the founder: the ×\n  // removed it and it never returned until the next reseed — and a visitor's\n  // upload persisted for every later visitor). The demo farm's face is\n  // immutable; the message says so honestly.\n  if (farm.isDemo) return bad(res, 403, 'The demo wears its own photograph — nothing to change here');\n";
// the set route: after the farm lookup line inside its body
const setBody = photoSet[0];
if (setBody.includes('farm.isDemo')) { console.log('SKIP set (has)'); }
else {
    const farmLineMatch = setBody.match(/const farm = await Farm\.findOne\([^\n]*\n/);
    if (!farmLineMatch) { console.log('MISS set farm line'); process.exit(1); }
    edit(S, farmLineMatch[0].replace(/\r?\n$/, ''), farmLineMatch[0].replace(/\r?\n$/, '') + GUARD.replace(/^\n/, ''));
}
let svc2 = fs.readFileSync(S, 'utf8');
const delBody = svc2.match(/api\.delete\('\/farm\/:farmId\/photo'[\s\S]{0,300}/);
if (!delBody) { console.log('MISS del body'); process.exit(1); }
if (delBody[0].includes('farm.isDemo')) { console.log('SKIP del (has)'); }
else {
    const farmLine = delBody[0].match(/const farm = await Farm\.findOne\([^\n]*\n/);
    if (!farmLine) { console.log('MISS del farm line'); process.exit(1); }
    edit(S, farmLine[0].replace(/\r?\n$/, ''), farmLine[0].replace(/\r?\n$/, '') + GUARD.replace(/^\n/, ''));
}
fs.writeFileSync('scripts/.dp-count', String(n));
console.log('swaps:', n);