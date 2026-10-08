// purge-demo-data-20261008.mjs — the demo arc's reversal includes the DATA
// the seed wrote: the Kimani farm, its plots/cycles/herds/records/holds/
// shop/orders/ledger/threads, the fictional customers (0700000007/8), and the
// demo farmer user. The founder: the demo phones are reserved for the fiction.
import mongoose from 'mongoose';
const uri = process.env.MONGO_DB_URI_PAID || process.env.MONGO_DB_URI;
await mongoose.connect(uri, { serverSelectionTimeoutMS: 30000, dbName: process.env.FARMLINE_DB_NAME || 'farmline' });
const db = mongoose.connection.db;
const col = (n) => db.collection(n);
const list = async (n) => (await db.listCollections({ name: n }).toArray()).map(c => c.name);

const names = await list('farmline');
console.log('collections:', names.join(', '));
const pick = (re) => names.find(n => re.test(n));

// 1. the demo farm — by the name or the reserved phones
const farmsC = pick(/^farm/i);
const demoFarm = await col(farmsC).findOne({ $or: [{ name: /kimani/i }, { phone: { $in: ['0700000007', '0700000008', '+2540700000007', '+2540700000008'] } }] });
if (!demoFarm) { console.log('no demo farm found — the data was already clean'); await mongoose.disconnect(); process.exit(0); }
const farmId = demoFarm._id;
console.log('the demo farm:', demoFarm.name, String(farmId));

// 2. the farm's dependents — every collection carrying farmId
let removed = {};
for (const n of names) {
    if (n === farmsC || /user/i.test(n)) continue;
    try {
        const r = await col(n).deleteMany({ $or: [{ farmId }, { farm: farmId }] });
        if (r.deletedCount) removed[n] = r.deletedCount;
    } catch { /* no farmId field */ }
}
console.log('the farm dependents removed:', JSON.stringify(removed));

// 3. the farm doc itself
await col(farmsC).deleteOne({ _id: farmId });
console.log('the farm doc removed');

// 4. the demo farmer user + the fictional customers
for (const n of names.filter(n => /user/i.test(n))) {
    const r = await col(n).deleteMany({ $or: [{ phone: { $in: ['0700000007', '0700000008', '+2540700000007', '+2540700000008'] } }, { isDemo: true }, { email: /kimani/i }] });
    if (r.deletedCount) console.log(n, 'users removed:', r.deletedCount);
}
console.log('THE DEMO DATA PURGED');
await mongoose.disconnect();