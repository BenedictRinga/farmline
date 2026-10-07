// scripts/set-vision.cjs — flip a farm's visionTier (the entitlement is
// server-side only; this is the founder's droplet hand for testing/upgrade).
// Usage: node scripts/set-vision.cjs <ringaID-or-farmId> [none|advanced]
const mongoose = require('mongoose');
const config = require('../src/config');
(async () => {
  const [id, tierArg] = process.argv.slice(2);
  if (!id) { console.log('usage: node scripts/set-vision.cjs <farmId> [none|advanced]'); process.exit(1); }
  const tier = tierArg === 'none' ? 'none' : 'advanced';
  await mongoose.connect(config.mongoUri, { dbName: config.dbName });
  const Farm = mongoose.connection.collection('farms');
  const r = await Farm.updateOne({ _id: new mongoose.Types.ObjectId(id) }, { $set: { visionTier: tier } });
  if (r.matchedCount) console.log(`  ✓ farm ${id} → visionTier=${tier}`);
  else {
    const alt = await Farm.updateOne({ ringaID: id }, { $set: { visionTier: tier } });
    console.log(alt.matchedCount ? `  ✓ farm ${id} → visionTier=${tier}` : `  ✗ no farm for ${id}`);
  }
  await mongoose.disconnect();
  process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });
