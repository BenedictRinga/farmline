// scripts/plan-build24.cjs — record build 24 in the plan (both repos).
const fs = require('fs');
let s = fs.readFileSync('PLAN.md', 'utf8');
if (s.includes('24 THE TRACK ENTRY')) { console.log('  ok (already)'); process.exit(0); }
const marker = 'never from a stale installed copy.**';
if (!s.includes(marker)) { console.log('  ✗ marker miss'); process.exit(1); }
const add = marker + `
**24 THE TRACK ENTRY (app + server): POST /farm/:id/animals — the farmer
adds an individual to a group (name/tag/sex/birth/weight; only the name is
required), the always-present track button on every group card, the new chip
opens the story page. The note now FOLDS under a click (the founder's
ruling). Live-verified: the POST, the chip on the inventory, the fold's
tap-open-tap-close; the alert's physical tap-through lands with the
founder's phone review (headless cannot fill Ionic's nested-shadow inputs).**`;
s = s.replace(marker, add);
fs.writeFileSync('PLAN.md', s);
console.log('  plan updated');
