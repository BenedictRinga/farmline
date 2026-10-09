// ─────────────────────────────────────────────────────────────────────────────
// CHAT — the farmer and the buyer talking, in one thread per farm+buyer pair.
//
// WHAT THIS BORROWS FROM LOOPKEEPER: the shape. A socket.io server on its own path
// (`/socket-farmline/`) so it cannot collide with Zyppar's `/socket.io` or
// LoopKeeper's `/socket-rolodex/` on the same nginx; a room per thread; and the
// same event names (join / message / typing / read).
//
// WHAT IT DELIBERATELY DOES NOT BORROW: LoopKeeper's chat is a DEMO ROOM — no auth,
// no persistence, messages vanish when the tabs close. That is fine for showing an
// investor two browsers talking. It is not fine here:
//
//   · A thread about a real order must survive a reload, a device change and three
//     days. "Is the milk still held?" has to still be answerable tomorrow.
//   · It must be SCOPED, or one buyer can read another buyer's thread.
//   · It is the RECORD of what was agreed. If two people disagree about a delivery
//     slot, this is the evidence.
//
// So every message is persisted, every socket is authenticated with the same HMAC
// token as the REST API, and a participant can only ever reach their own threads.
//
// REST IS NOT A FALLBACK HERE, IT IS A PEER. Chat over a socket fails on a flaky
// connection in ways that are invisible to the user — the message simply never
// arrives. Every message is also postable and fetchable over REST, so a phone that
// lost its socket can still read and send. The socket is for immediacy; REST is for
// truth.
const mongoose = require('mongoose');
const { Conversation, Message, Farm, Customer } = require('./models');
const auth = require('./auth');
const updates = require('./updates'); // B2: the mandatory floor rides the updates room

const oid = (v) => new mongoose.Types.ObjectId(String(v));
const MAX_BODY = 2000;
const HISTORY_LIMIT = 200;

/**
 * Resolve the caller from a bearer token — the same two principals as the REST API.
 * Returns null rather than throwing: every caller must decide what to do with "not
 * signed in", and silently defaulting to somebody would be the worst option.
 */
function principalFromToken(token) {
  const p = auth.verify(token);
  if (!p) return null;
  if (p.typ === 'farmer') return { type: 'farmer', id: String(p.sub), memberId: String(p.mid || ''), role: p.role || 'owner' };
  if (p.typ === 'customer') return { type: 'customer', id: String(p.sub) };
  return null;
}

/** Short, human label for the counterparty. */
function labelFor(kind, doc) {
  if (!doc) return '';
  if (kind === 'farm') return doc.name || 'Farm';
  return doc.name || doc.phone || 'Buyer';
}

/**
 * The single thread between a farm and a buyer. Created on first contact —
 * an enquiry before an order, or the order itself. Re-opening from a later order
 * continues the SAME thread: fragmenting one relationship into five histories
 * would make the record useless precisely when it matters.
 */
async function openConversation({ farmId, customerId, orderId = null }) {
  const fid = oid(farmId), cid = oid(customerId);
  const [farm, customer] = await Promise.all([
    Farm.findById(fid).select('name').lean(),
    Customer.findById(cid).select('name phone').lean(),
  ]);
  if (!farm || !customer) return null;

  const doc = await Conversation.findOneAndUpdate(
    { farmId: fid, customerId: cid },
    {
      $setOnInsert: {
        farmId: fid, customerId: cid,
        farmLabel: labelFor('farm', farm),
        customerLabel: labelFor('customer', customer),
      },
      // A later order re-anchors the thread to the newest order, so the farmer can
      // always see which order the current conversation is about.
      ...(orderId ? { $set: { orderId: oid(orderId) } } : {}),
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  return doc;
}

/** Every thread this principal is part of, newest activity first. */
async function listFor(principal) {
  const filter = principal.type === 'farmer'
    ? { farmId: oid(principal.id) }
    : { customerId: oid(principal.id) };

  const rows = await Conversation.find(filter).sort({ lastMessageAt: -1 }).limit(100).lean();

  // Unread = messages from the OTHER side newer than this side's read position.
  const withUnread = await Promise.all(rows.map(async (c) => {
    const readAt = principal.type === 'farmer' ? c.farmerReadAt : c.customerReadAt;
    const unread = await Message.countDocuments({
      conversationId: c._id,
      fromType: principal.type === 'farmer' ? 'customer' : 'farmer',
      ...(readAt ? { at: { $gt: readAt } } : {}),
    });
    return {
      _id: String(c._id),
      farmId: String(c.farmId),
      orderId: c.orderId ? String(c.orderId) : null,
      // What THIS side should see: the other party.
      counterparty: principal.type === 'farmer' ? c.customerLabel : c.farmLabel,
      lastMessageText: c.lastMessageText,
      lastMessageAt: c.lastMessageAt,
      unread,
    };
  }));
  return withUnread;
}

/** True when this principal is a participant in the thread. The scope check. */
async function canAccess(conversationId, principal) {
  if (!conversationId || !principal) return null;
  let id;
  try { id = oid(conversationId); } catch { return null; }
  const c = await Conversation.findById(id).lean();
  if (!c) return null;
  const mine = principal.type === 'farmer'
    ? String(c.farmId) === String(principal.id)
    : String(c.customerId) === String(principal.id);
  return mine ? c : null;
}

/** Persist a message and roll the conversation's summary forward. */
async function postMessage({ conversationId, fromType, fromId, fromLabel = '', body, photo = '', clientId = '' }) {
  const text = String(body || '').slice(0, MAX_BODY).trim();
  // A2 tranche 4 — THE PHOTO: optional, validated, capped. The client downsizes
  // (the farm-photo pattern); this cap is the guard, not the resizing strategy.
  // A message is text OR text+photo — never nothing (a photo speaks).
  let pic = '';
  if (photo) {
    if (typeof photo !== 'string' || !/^data:image\/(jpeg|png);base64,/.test(photo)) {
      return { ok: false, error: 'photo must be a base64 JPEG or PNG data URL' };
    }
    if (photo.length > 300000) return { ok: false, error: 'photo too large — resize before sending' };
    pic = photo;
  }
  if (!text && !pic) return { ok: false, error: 'empty message' };
  // Carried over from LoopKeeper: an old client emitting an object as text coerces
  // to this literal, and relaying it would put "[object Object]" in someone's thread.
  if (text === '[object Object]') return { ok: false, error: 'bad message' };

  if (clientId) {
    const dupe = await Message.findOne({ conversationId: oid(conversationId), clientId }).lean();
    if (dupe) return { ok: true, message: dupe, duplicate: true };
  }

  const msg = await Message.create({
    conversationId: oid(conversationId),
    fromType, fromId: oid(fromId), fromLabel, body: text, photo: pic, at: new Date(),
    clientId: clientId || undefined,
    readByFarmer: fromType === 'farmer',
    readByCustomer: fromType === 'customer',
  });

  await Conversation.updateOne({ _id: oid(conversationId) }, {
    $set: {
      lastMessageAt: msg.at,
      lastMessageText: pic && !text ? '📷 Photo' : text.slice(0, 140),
      ...(fromType === 'farmer' ? { farmerReadAt: msg.at } : { customerReadAt: msg.at }),
    },
  });

  scheduleDemoReply(String(oid(conversationId)), fromType);
  return { ok: true, message: msg };
}

// ── THE DEMO AUTO-REPLY (the founder: the demo must be LIVE) ──────────────────
// In the demo farm's threads, a farmer message is answered ~5s later by the
// fictional customer with a canned line — the visitor sees a conversation
// WORKING. Delivered through the same persistence path + the room broadcast
// (an open thread sees it arrive live). Arms only for a demo farm; a real
// farm's threads are never touched.
function scheduleDemoReply(conversationId, fromType) {
  if (fromType !== 'farmer') return;
  (async () => {
    const conv = await Conversation.findById(conversationId).select('farmId customerId customerLabel').lean();
    if (!conv) return;
    const farm = await Farm.findById(conv.farmId).select('isDemo').lean();
    if (!farm || !farm.isDemo) return;
    const LINES = [
      'Sawa, noted — asante!',
      'That works for me. See you then.',
      'Perfect. NIMEKUBALI.',
      'Okay — and the eggs are from today?',
      'Thank you! I will confirm in the evening.',
    ];
    const body = LINES[Math.floor(Math.random() * LINES.length)];
    const delay = 5000 + Math.floor(Math.random() * 3000);
    const clientId = 'demo-reply-' + Date.now() + '-' + Math.random().toString(36).slice(2, 7);
    setTimeout(async () => {
      try {
        const res = await postMessage({
          conversationId, fromType: 'customer',
          fromId: String(conv.customerId), fromLabel: conv.customerLabel,
          body, clientId,
        });
        if (res.ok && ioRef) {
          ioRef.to('conv:' + conversationId).emit('chat:message', {
            _id: String(res.message._id), conversationId,
            fromType: 'customer', fromLabel: conv.customerLabel,
            body: res.message.body, photo: '', at: res.message.at,
            clientId, duplicate: !!res.duplicate,
          });
        }
      } catch { /* a dead demo reply harms nothing */ }
    }, delay);
  })().catch(() => { /* never break the real send */ });
}

async function history(conversationId, { limit = HISTORY_LIMIT } = {}) {
  const rows = await Message.find({ conversationId: oid(conversationId) })
    .sort({ at: -1 }).limit(Math.min(limit, HISTORY_LIMIT)).lean();
  return rows.reverse();   // oldest first, the way a thread reads
}

/** Move this side's read position to now. */
async function markRead(conversationId, principal) {
  const now = new Date();
  const field = principal.type === 'farmer' ? 'farmerReadAt' : 'customerReadAt';
  await Conversation.updateOne({ _id: oid(conversationId) }, { $set: { [field]: now } });
  await Message.updateMany(
    { conversationId: oid(conversationId), fromType: principal.type === 'farmer' ? 'customer' : 'farmer' },
    { $set: principal.type === 'farmer' ? { readByFarmer: true } : { readByCustomer: true } },
  );
  return now;
}

/**
 * Attach socket.io to the given http server.
 *
 * The path is namespaced deliberately: three products share one nginx, and Zyppar
 * already owns `/socket.io`. A shared path would not fail loudly — it would fail by
 * silently delivering one product's events to another.
 */
let ioRef = null; // B2: the live socket handle for the announce push

function attach(httpServer) {
  let Server;
  try { ({ Server } = require('socket.io')); }
  catch {
    console.warn('[farmline] socket.io is not installed — chat will run on REST only.');
    console.warn('           yarn add socket.io   (then restart)');
    return null;
  }
  ioRef = null;

  const io = new Server(httpServer, {
    // The app is served from the same origin in production (nginx); in dev the
    // Angular server is on another port and is allowed through.
    cors: { origin: '*' },
    path: '/socket-farmline/',
  });
  ioRef = io; // B2: the announce route broadcasts through this handle

  // Authenticate the HANDSHAKE, not each event. An unauthenticated socket gets no
  // room and no events — the same posture as the REST gate.
  io.use((socket, next) => {
    const token = socket.handshake.auth?.token || socket.handshake.query?.token;
    const principal = principalFromToken(token);
    if (!principal) return next(new Error('unauthorised'));
    socket.data.principal = principal;
    next();
  });

  io.on('connection', (socket) => {
    const me = socket.data.principal;

    socket.emit('chat:ready', { type: me.type, id: me.id });

    // ── THE UPDATES ROOM (B2, the founder: "the socket is the accelerator") ──
    // Every signed-in socket sits in the public 'updates' room. On CONNECT it
    // learns the mandatory floor at once (a client that was OPEN through a
    // deploy hears it on its next reconnect); the announce route pushes to the
    // whole room the moment the floor moves.
    socket.join('updates');
    // 2026-10-09 THE LOOPKEEPER VERBATIM: no mandatory floor in the check —
    // the announce route drives the room push. The connection-time floor emit
    // is retired with the floor itself (the crash its removal exposed dies here).
    const floor = 0;
    if (floor > 0) socket.emit('update:mandatory', { build: floor }); // inert

    socket.on('chat:join', async (data) => {
      const conv = await canAccess(data?.conversationId, me);
      if (!conv) return socket.emit('chat:error', { error: 'not your conversation' });
      socket.join('conv:' + conv._id);
      socket.data.conversationId = String(conv._id);
      await markRead(conv._id, me);
      socket.to('conv:' + conv._id).emit('chat:read', { by: me.type, at: Date.now() });
      try {
        const peers = await io.in('conv:' + conv._id).fetchSockets();
        // Peers excludes self, so "the other side is here" is count > 0.
        socket.emit('chat:present', { other: Math.max(0, peers.length - 1) });
      } catch { socket.emit('chat:present', { other: 0 }); }
    });

    socket.on('chat:message', async (data) => {
      const conv = await canAccess(data?.conversationId || socket.data.conversationId, me);
      if (!conv) return socket.emit('chat:error', { error: 'not your conversation' });
      const label = me.type === 'farmer' ? conv.farmLabel : conv.customerLabel;
      const res = await postMessage({
        conversationId: conv._id, fromType: me.type, fromId: me.id, fromLabel: label,
        body: data?.body, photo: data?.photo || '', clientId: data?.clientId,
      });
      if (!res.ok) return socket.emit('chat:error', { error: res.error });
      const payload = {
        _id: String(res.message._id),
        conversationId: String(conv._id),
        fromType: me.type,
        fromLabel: label,
        body: res.message.body,
        photo: res.message.photo || '',
        at: res.message.at,
        clientId: res.message.clientId || '',
        duplicate: !!res.duplicate,
      };
      // Everyone in the room INCLUDING the sender: two devices, one thread, and the
      // sender's other tab must see what they just sent.
      io.in('conv:' + conv._id).emit('chat:message', payload);
    });

    socket.on('chat:typing', (data) => {
      const room = socket.data.conversationId;
      if (!room) return;
      socket.to('conv:' + room).emit('chat:typing', { from: me.type });
    });

    socket.on('chat:read', async () => {
      const room = socket.data.conversationId;
      if (!room) return;
      await markRead(room, me);
      socket.to('conv:' + room).emit('chat:read', { by: me.type, at: Date.now() });
    });

    socket.on('disconnect', () => {
      const room = socket.data.conversationId;
      if (room) socket.to('conv:' + room).emit('chat:left', { type: me.type });
    });
  });

  return io;
}

// B2 — PUSH THE FLOOR: announce to every connected socket in the updates room.
// Called by the announce route when the mandatory floor moves. Returns the
// floor announced (0 = no floor set, nothing pushed).
function broadcastUpdate() {
  const f = updates.mandatoryFloor();
  if (f > 0 && ioRef) ioRef.to('updates').emit('update:mandatory', { build: f });
  return f;
}

module.exports = {
  principalFromToken, openConversation, listFor, canAccess,
  postMessage, history, markRead, attach, labelFor, broadcastUpdate,
};
