// scripts/seed-fixes.cjs — Price→PriceObservation in the seed + isDemo field.
const fs = require('fs');

{
  const f = 'scripts/seed-demo-farm.cjs';
  let s = fs.readFileSync(f, 'utf8');
  s = s.split('Sellable, Order, Ledger, Customer, Conversation, Message, Price }').join('Sellable, Order, Ledger, Customer, Conversation, Message, PriceObservation }');
  s = s.split('await Price.create([').join('await PriceObservation.create([');
  fs.writeFileSync(f, s);
  console.log('  seed: Price → PriceObservation');
}

{
  const f = 'src/models.js';
  let s = fs.readFileSync(f, 'utf8');
  if (!s.includes('isDemo')) {
    const anchor = '  visionTier: { type: String, enum: [\'none\', \'advanced\'], default: \'none\' },';
    if (!s.includes(anchor)) { console.log('  ✗ farm anchor miss'); process.exit(1); }
    s = s.replace(anchor, anchor + '\n\n  // THE LIVING DEMO (the founder, 2026-10-08: "people need to SEE"): exactly\n  // one farm carries isDemo:true — the demo login route issues a REAL farmer\n  // token for it (no secrets on the wire; the farm holds only fictional data\n  // and can be re-seeded whole at any time).\n  isDemo: { type: Boolean, default: false, index: true },');
    fs.writeFileSync(f, s);
    console.log('  models: isDemo added');
  } else console.log('  models: ok (already)');
}
