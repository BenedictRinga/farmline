// scripts/probe-align3.cjs — the shop checks consolidated, line-anchored.
const fs = require('fs');
const f = 'scripts/fl-demo-probe.cjs';
let s = fs.readFileSync(f, 'utf8');
const NL = String.fromCharCode(13, 10);
const lines = s.split(NL);
// Replace lines: 'check the shop front is stocked' + its JSON line + the
// 'answers publicly' check + its JSON line → ONE check + one JSON line.
const out = [];
let i = 0;
let done = false;
while (i < lines.length) {
  const L = lines[i];
  if (!done && L.includes("the shop front is stocked")) {
    out.push("  check('the shop front is stocked (milk, eggs, kale, avocado)', !!shop && (shop.sellables || []).length >= 3,");
    out.push("    JSON.stringify(shop).slice(0, 80));");
    // skip: the JSON line, the publicly check, its JSON line
    i += 4;
    done = true;
    continue;
  }
  out.push(L);
  i++;
}
if (!done) { console.log('  ✗ stocked line miss'); process.exit(1); }
fs.writeFileSync(f, out.join(NL));
console.log('  shop check consolidated');
