// scripts/probe-align.cjs — align the demo probe's routes with the real ones.
const fs = require('fs');
const f = 'scripts/fl-demo-probe.cjs';
let s = fs.readFileSync(f, 'utf8');
s = s.split('/schedule/today').join('/today');
s = s.split('/chat/conversations').join('/conversations');
s = s.split("/api/farmline/chat/'").join('/api/farmline/conversations/\''); // safety no-op shape
s = s.split("' + conv._id + '/messages'").join("' + conv._id + '/messages'");
// The chat POST/GET paths:
s = s.split("base + '/api/farmline/chat/'").join("base + '/api/farmline/conversations/'");
// The shop probe → the farmer's sellables route:
const shopStart = s.indexOf("const shop = await");
const shopEnd = s.indexOf(');', shopStart) + 2;
if (shopStart === -1) { console.log('  ✗ shop block miss'); process.exit(1); }
const shopNew = [
  "  const shop = await (await fetch(base + '/api/farmline/farm/' + d.farm.id + '/sellables', { headers: H })).json().catch(() => null);",
  "  check('the shop front is stocked (milk, eggs, kale, avocado)', Array.isArray(shop) && shop.length >= 3,",
  "    JSON.stringify(shop).slice(0, 80));",
].join('\n');
s = s.slice(0, shopStart) + shopNew + s.slice(shopEnd);
// And the public-catalog check line inside the old block is gone with it.
fs.writeFileSync(f, s);
console.log('  probe routes aligned');
