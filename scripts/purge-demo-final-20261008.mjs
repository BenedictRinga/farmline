// purge-demo-final-20261008.mjs — the demo traces measured: the demo farmer
// = the member 'Peter Kimani' (0700000009), the fictional customers =
// 0700000007 'Mama Njeri' + 0700000008 'Wanjiku Store'. Purge the farmer's
// farm + its dependents + the demo member + the fictional customers.
import mongoose from 'mongoose';
await mongoose.connect(process.env.MONGO_LOCAL_URI);
const db = mongoose.connection.db;
const DEMO_PHONES = ['0700000007', '0700000008', '+2540700000007', '+2540700000008'];

// 1. the demo farmer member
const demoMembers = await db.collection('members').find({ $or: [{ phone: '0700000009' }, { name: /peter kimani/i }] }).toArray();
console.log('the demo members:', demoMembers.map(m => m.name + '/' + m.phone).join(', '));
for (const m of demoMembers) {
    // the farm owned by them
    const farm = await db.collection('farms').findOne({ $or: [{ memberId: m._id }, { member: m._id }, { ownerId: m._id }] });
    if (farm) {
        const fid = farm._id;
        const removed = {};
        for (const n of ['animals', 'animalgroups', 'orders', 'conversations', 'messages', 'holds', 'plots', 'ledgers', 'logs', 'priceobservations', 'scheduledevents', 'cropcycles', 'sellables']) {
            const r = await db.collection(n).deleteMany({ $or: [{ farmId: fid }, { farm: fid }] }).catch(() => ({ deletedCount: 0 }));
            if (r.deletedCount) removed[n] = r.deletedCount;
        }
        await db.collection('farms').deleteOne({ _id: fid });
        console.log('the demo farm removed:', farm.name, '| dependents:', JSON.stringify(removed));
    }
    await db.collection('members').deleteOne({ _id: m._id });
    console.log('the demo member removed:', m.phone);
}
// 2. the fictional customers
const cr = await db.collection('customers').deleteMany({ phone: { $in: DEMO_PHONES } });
console.log('the fictional customers removed:', cr.deletedCount);
console.log('THE DEMO DATA PURGE COMPLETE');
await mongoose.disconnect();