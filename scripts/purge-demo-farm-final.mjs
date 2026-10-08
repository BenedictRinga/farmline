// purge-demo-farm-final.mjs — THE DEMO FARM HID AS "Molly Greens" (the
// founder's own farm name!) with slug 'kimani-farms', area 'Limuru, Kiambu'
// — the seed wore her identity. Purge by the farmId + every dependent.
import mongoose from 'mongoose';
await mongoose.connect(process.env.MONGO_LOCAL_URI);
const db = mongoose.connection.db;
const fid = (await db.collection('farms').findOne({ slug: 'kimani-farms' }))?._id;
if (!fid) { console.log('already clean'); await mongoose.disconnect(); process.exit(0); }
console.log('the demo farm id:', String(fid));
const removed = {};
for (const n of ['plots', 'cropcycles', 'scheduledevents', 'animals', 'animalgroups', 'holds', 'sellables', 'orders', 'conversations', 'messages', 'ledgers', 'logs', 'priceobservations']) {
    const r = await db.collection(n).deleteMany({ $or: [{ farmId: fid }, { farm: fid }] }).catch(() => ({ deletedCount: 0 }));
    if (r.deletedCount) removed[n] = r.deletedCount;
}
await db.collection('farms').deleteOne({ _id: fid });
await db.collection('members').deleteMany({ $or: [{ farmId: fid }, { farm: fid }] });
console.log('the farm + the dependents removed:', JSON.stringify(removed));
console.log('THE DEMO FARM IS GONE');
await mongoose.disconnect();