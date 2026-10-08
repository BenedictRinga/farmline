// scripts/seed-photo.cjs — the demo farm wears kimani.jpg when the founder
// drops it into farmline-app/src/assets/images/.
const fs = require('fs');
const f = 'scripts/seed-demo-farm.cjs';
let s = fs.readFileSync(f, 'utf8');
if (s.includes('kimani.jpg')) { console.log('  ok (already)'); process.exit(0); }

const NL = String.fromCharCode(10);
const marker = '  console.log(';
const i = s.indexOf(marker);
if (i === -1) { console.log('  ✗ log anchor miss'); process.exit(1); }
const add = [
  "  // THE DEMO'S FACE: the founder drops kimani.jpg into",
  '  // farmline-app/src/assets/images/ — the seed finds it, base64s it, and the',
  '  // demo farm wears it (the buyer\u2019s guide and the share cards carry it).',
  "  let photo = '';",
  '  try {',
  "    const p = require('path').join(__dirname, '..', '..', 'farmline-app', 'src', 'assets', 'images', 'kimani.jpg');",
  "    if (require('fs').existsSync(p)) {",
  "      photo = 'data:image/jpeg;base64,' + require('fs').readFileSync(p).toString('base64');",
  "      console.log('  photo: kimani.jpg found — the demo farm wears it');",
  '    }',
  '  } catch { /* no photo yet — the demo still works */ }',
].join(NL);
s = s.slice(0, i) + add + NL + s.slice(i);
s = s.split('    isDemo: true,').join('    isDemo: true,' + NL + '    photo,');
fs.writeFileSync(f, s);
console.log('  the seed wears kimani.jpg when it exists');
