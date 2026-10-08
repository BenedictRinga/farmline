// hunt-demo-traces-20261008.mjs — find every remaining doc tied to the demo
// (the farm named Kimani / the demo farmer's phone 0700000009) across all
// collections, then purge them with their farmId-scoped dependents.
import mongoose from 'mongoose';
await mongoose.connect(process.env.MONGO_LOCAL_URI);
const db = mongoose.connection.db;
const NAMES = ['farms', 'plots', 'cropcycles', 'animals', 'animalgroups', 'holds', 'orders', 'conversations', 'messages', 'ledgers', 'logs', 'scheduledevents', 'priceobservations', 'sellables', 'customers'];
const phoneOr = [{ owner: '0700000009' }, { phone: '0700000009' }, { memberPhone: '0700000009' }, { name: /kimani/i }, { farmName: /kimani/i }, { farm: /kimani/i }];

// 1. the farms matching the demo
const farms = await db.collection('farms').find({ $or: phoneOr }).toArray();
console.log('the demo farms:', farms.map(f => f.name + '/' + f._id).join(', ') || '(none)');
for (const f of farms) {
    const fid = f._id;
    const removed = {};
    for (const n of NAMES) {
        if (n === 'farms') continue;
        try {
            const r = await db.collection(n).deleteMany({ $or: [{ farmId: fid }, { farm: fid }, { farmName: fid }] });
            if (r.deletedCount) removed[n] = r.deletedCount;
        } catch { /* the field shape varies */ }
    }
    await db.collection('farms').deleteOne({ _id: fid });
    console.log('removed the farm', String(fid), JSON.stringify(removed));
}
// 2. any stragglers keyed by the demo phone
for (const n of NAMES) {
    const r = await db.collection(n).deleteMany({ $or: [{ owner: '0700000009' }, { phone: '0700000009' }, { memberPhone: '0700000009' }] }).catch(() => ({ deletedCount: 0 }));
    if (r.deletedCount) console.log(n, 'stragglers removed:', r.deletedCount);
}
console.log('HUNT COMPLETE');
await mongoose.disconnect();