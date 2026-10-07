// scripts/plan-build26.cjs — record builds 25/26 in the plan.
const fs = require('fs');
let s = fs.readFileSync('PLAN.md', 'utf8');
if (s.includes('26 THE FLAT HEADERS')) { console.log('  ok (already)'); process.exit(0); }
const marker = "the alert's physical tap-through lands with the\nfounder's phone review (headless cannot fill Ionic's nested-shadow inputs).**";
if (!s.includes(marker)) { console.log('  ✗ marker miss'); process.exit(1); }
const add = marker + `
**25/26 THE UPDATE TRUTH + THE FLAT HEADERS (the founder's 4-item report,
2026-10-07): the "up to date forever" illusion killed at its root — the
server's check compared ITS OWN package.json counter (19) against the APP's
stamp (24): "19 > 24" false forever. serverBuild() now reads the SERVED
BUNDLE's stamp (/var/www/farmline/build.json; the sibling checkout on the
dev machine; the env override FARMLINE_SERVED_BUNDLE) — live-probed:
client 1 → available, client 25 → up to date, client 19 → available. The
verify ladder gains the update-truth probes (build.json reachable, the
check's build EQUALS it, both no-store/no-cache). The Settings version line
carries the build. Headers FLAT app-wide (the MD ::after gradient dead, one
hairline border); the two farm captions' computed typography PROVEN
identical (22px/700/26.4px/-0.44px — the illusion was the surrounding row).**`;
s = s.replace(marker, add);
fs.writeFileSync('PLAN.md', s);
console.log('  plan updated');
