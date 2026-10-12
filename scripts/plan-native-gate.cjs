// scripts/plan-native-gate.cjs — the founder's verdict recorded; the native
// pass becomes a STANDING GATE in the canonical PLAN (the server repo's file,
// then synced verbatim to the app repo).
const fs = require('fs');
const MARK = '### ROUND B — Capacitor init (app)';
const f = 'PLAN.md';
let s = fs.readFileSync(f, 'utf8');
if (s.includes('THE NATIVE-PASS GATE')) {
  console.log('  ok (already)');
} else {
  const i = s.indexOf(MARK);
  if (i === -1) { console.log('  \u2700 marker miss'); process.exit(1); }
  const gate = [
    '### THE NATIVE-PASS GATE (the founder\u2019s verdict, 2026-10-13 \u2014 STANDING)',
    '- The five-corrections session is verified: \u201cthe report is faithful and the build is real.\u201d The stories land the ethos; the modal treats the visitor with Zyppar\u2019s full respect; the chip no longer slips; the Amharic headline strings read as real Amharic (the founder\u2019s own read-back).',
    '- **THE ONE OPEN DEBT:** the Amharic and Hausa long-form copy still needs the NATIVE PASS \u2014 and it **MUST precede any Hausa/Amharic distribution push**. No ha/am marketing, sharing campaign, or store listing goes out before the native review signs the long-form copy. The flag rides every future session report until the pass is done.',
    '',
    '',
  ].join('\n');
  s = s.slice(0, i) + gate + s.slice(i);
  fs.writeFileSync(f, s);
  console.log('  gate recorded in the canonical PLAN');
}
fs.copyFileSync(f, '../farmline-app/PLAN.md');
console.log('  PLAN synced verbatim to the app repo');