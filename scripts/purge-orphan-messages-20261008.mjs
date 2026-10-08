// purge-orphan-messages-20261008.mjs — the messages whose conversation no
// longer exists (the demo threads' remainders).
import mongoose from 'mongoose';
await mongoose.connect(process.env.MONGO_LOCAL_URI);
const db = mongoose.connection.db;
const convIds = new Set((await db.collection('conversations').find({}, { projection: { _id: 1 } }).toArray()).map(d => String(d._id)));
const msgs = await db.collection('messages').find({}, { projection: { conversationId: 1 } }).toArray();
const orphans = msgs.filter(x => !convIds.has(String(x.conversationId))).map(x => x._id);
if (orphans.length) {
    const r = await db.collection('messages').deleteMany({ _id: { $in: orphans } });
    console.log('the orphan demo messages removed:', r.deletedCount);
} else console.log('no orphan messages');
await mongoose.disconnect();