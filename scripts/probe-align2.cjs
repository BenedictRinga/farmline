// scripts/probe-align2.cjs — the shop checks consolidated (the route returns
// {ok, sellables}; ONE check asserting the stocked shelves).
const fs = require('fs');
const f = 'scripts/fl-demo-probe.cjs';
let s = fs.readFileSync(f, 'utf8');
const NL = String.fromCharCode(13, 10);
const OLD = [
  "  check('the shop front is stocked (milk, eggs, kale, avocado)', Array.isArray(shop) && shop.length >= 3,",
  "    JSON.stringify(shop).slice(0, 80));",
  "  check('the shop front answers publicly (the visitor can SEE)', !!shop && (shop.items || shop.sellables || []).length >= 3,",
  "    JSON.stringify(shop).slice(0, 80));",
].join(NL);
const NEW = [
  "  check('the shop front is stocked (milk, eggs, kale, avocado)', !!shop && (shop.sellables || []).length >= 3,",
  "    JSON.stringify(shop).slice(0, 80));",
].join(NL);
if (!s.includes(OLD)) { console.log('  ✗ shop block miss'); process.exit(1); }
s = s.replace(OLD, NEW);
fs.writeFileSync(f, s);
console.log('  shop check consolidated');
