// scripts/seed-photo2.cjs — the seed wears kimanifarms.jpg AS A RELATIVE PATH
// (the 500KB file ships in the bundle; base64 would bloat every farm read).
// Accepts both names (kimanifarms.jpg first, kimani.jpg second).
const fs = require('fs');
const f = 'scripts/seed-demo-farm.cjs';
let s = fs.readFileSync(f, 'utf8');
if (s.includes('kimanifarms.jpg')) { console.log('  ok (already)'); process.exit(0); }

// Replace the base64 block with the relative-path resolution.
const start = s.indexOf("  // THE DEMO'S FACE:");
const end = s.indexOf("  } catch { /* no photo yet — the demo still works */ }");
if (start === -1 || end === -1) { console.log('  ✗ photo block miss'); process.exit(1); }
const NL = String.fromCharCode(10);
const block = [
  "  // THE DEMO'S FACE: kimanifarms.jpg ships IN the bundle",
  '  // (farmline-app/src/assets/images/), so the farm doc carries the RELATIVE',
  '  // path — every img binding in the app resolves it, and no base64 bloats',
  '  // the reads. The seed finds it beside the app checkout on the droplet.',
  "  let photo = '';",
  '  try {',
  "    const dir = require('path').join(__dirname, '..', '..', 'farmline-app', 'src', 'assets', 'images');",
  "    for (const name of ['kimanifarms.jpg', 'kimani.jpg']) {",
  "      if (require('fs').existsSync(require('path').join(dir, name))) {",
  "        photo = 'assets/images/' + name;",
  "        console.log('  photo: ' + name + ' — the demo farm wears it (bundle path)');",
  '        break;',
  '      }',
  '    }',
  '  } catch { /* no photo yet — the demo still works */ }',
].join(NL);
s = s.slice(0, start) + block + s.slice(end);
fs.writeFileSync(f, s);
console.log('  the seed wears the bundle path');
