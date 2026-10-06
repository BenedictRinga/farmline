// scripts/plan-build23.cjs — record the per-animal tranche in the plan.
const fs = require('fs');
let s = fs.readFileSync('PLAN.md', 'utf8');
if (s.includes('23 THE PER-ANIMAL STORY')) { console.log('  ok (already)'); process.exit(0); }
const marker = 'avocado cycle at 7 steps and a sheep flock at 8 and reversed clean).**';
if (!s.includes(marker)) { console.log('  ✗ marker miss'); process.exit(1); }
const add = marker + `
**23 THE PER-ANIMAL STORY (the note's promise made true): GET
/farm/:id/animal/:animalId — the animal's identity is its own; the CARE and
the RECORDS belong to the group (materialise is group-level — the page says
so, never invented per-animal history); the money is what exists (her listed
price + the group's open care costs). The app: /farmer/animal/:id — the
inline panel's 'whole story' tap opens it; Edge 7/7 (Zawadi the probe ewe:
identity, 38 kg, the flock's 8 events, KES 330 upcoming, no raw keys). THE
NGINX GUARANTEE REPAIRED: the 18:03 deploy's nginx -t failure traced to the
INSTALLED package carrying an old UNQUOTED {16,} regex — the ensure now reads
the block from the repo checkout (reset to origin/main before 6.5 runs),
never from a stale installed copy.**`;
s = s.replace(marker, add);
fs.writeFileSync('PLAN.md', s);
console.log('  plan updated');
