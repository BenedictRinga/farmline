// ─────────────────────────────────────────────────────────────────────────────
// FEEDBACK — the LoopKeeper tester-channel mechanism, farmline-shaped (2026-10-10,
// the founder: "Clone the chat feature in LoopKeeper home page and place it at
// header of farmline home (shamba) page, so that it opens and any one can give
// feedback, text or images. Assign them persistent id when they try to chat.
// Again, see loopkeeper app and server for mechanism. Just clone it - faster.").
//
// THE CLONE (rolodex-server src/index.js builds 126–135, read and mapped — not
// invented):
//   · THE PERSISTENT ID — LoopKeeper's ChatId: minted SERVER-side, idempotent per
//     deviceId (a re-request returns the SAME id — one id per device, forever),
//     five unambiguous characters (no I/L/O/0/1 — hand-shareable), collision
//     re-rolls on the unique index. farmline's prefix is FL-.
//   · THE THREAD — LoopKeeper's TesterChat: one thread per id, messages carry
//     {from, text, at}, a cap on history, READ RECEIPTS both sides (the sender's
//     read stamps senderReadAt; the HQ inbox fetch stamps hqReadAt — the sender
//     can see their report was picked up).
//   · THE INBOX + REPLY — admin-key gated, newest activity first (farmline's
//     FARMLINE_ADMIN_KEY, the same gate /admin/farms uses).
//   · OPEN TO ANYONE — LoopKeeper gated the channel to a tester roster; the
//     founder's brief here says "any one". The id↔device binding stays (the scope
//     check), the roster gate does not.
//
// WHAT IS FARMLINE-SHAPED (the deliberate differences):
//   · Messages are SEPARATE DOCS (FeedbackMsg), not an embedded array — the
//     founder asked for images, and a doc carrying 80 × 300KB photos would walk
//     into Mongo's document limit. Same shape as the farm↔buyer Message: text OR
//     photo, never nothing; the client downsizes, the cap is the guard.
//   · REST only — the socket requires an HMAC principal and an anonymous feedback
//     sender has none. REST is the truth (chat.js's own doctrine); the sheet polls
//     while it stands, which is exactly how LoopKeeper's sheet "sees the reply come
//     home while it stands".
//   · NO farm document is touched — the demo farm's immutability is untouched by
//     construction (chat is not a farm write).
const crypto = require('crypto');
const { FeedbackChat, FeedbackMsg } = require('./models');

const MAX_TEXT = 2000;
const MAX_PHOTO = 300000;   // the same guard the farm↔buyer photo carries
const THREAD_LIMIT = 200;   // what a read returns (the thread's working memory)

// LoopKeeper's alphabet verbatim: no I/L/O/0/1 — hand-shareable.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

/** FL-XXXXX: five unambiguous characters; the unique index is the real guard. */
function mintFeedbackId() {
  let tail = '';
  for (let i = 0; i < 5; i++) tail += ALPHABET[crypto.randomBytes(1)[0] % ALPHABET.length];
  return 'FL-' + tail;
}

/**
 * THE PERSISTENT ID (LoopKeeper's POST /chat-id, verbatim shape): idempotent per
 * deviceId. An existing device gets its SAME id back (and a name change rides);
 * a new device mints once, re-rolling on the rare id collision. One id per
 * device, forever — the founder's "assign them persistent id when they try to chat".
 */
async function ensureId(deviceId) {
  const existing = await FeedbackChat.findOne({ deviceId }).lean();
  if (existing) return { feedbackId: existing.feedbackId, created: false };
  for (let attempt = 0; attempt < 12; attempt++) {
    const feedbackId = mintFeedbackId();
    try {
      const rec = await FeedbackChat.create({ feedbackId, deviceId });
      return { feedbackId: rec.feedbackId, created: true };
    } catch (dup) {
      // A feedbackId collision re-rolls; a deviceId race re-reads the winner.
      const raced = await FeedbackChat.findOne({ deviceId }).lean();
      if (raced) return { feedbackId: raced.feedbackId, created: false };
    }
  }
  return null;
}

/** The scope check: the id must belong to the device presenting it. */
async function threadFor(deviceId, feedbackId) {
  if (!deviceId || !feedbackId) return null;
  return FeedbackChat.findOne({ deviceId, feedbackId }).lean();
}

/** The thread's tail, oldest first — the way a thread reads. */
async function threadMessages(threadId, { limit = THREAD_LIMIT } = {}) {
  const rows = await FeedbackMsg.find({ threadId }).sort({ at: -1 }).limit(Math.min(limit, THREAD_LIMIT)).lean();
  return rows.reverse();
}

/**
 * SEND — the sender's line. Text OR text+photo, never nothing; a photo is a
 * client-downsized data URL (the farm↔buyer photo cap is the guard here too).
 * Idempotent on clientId (the Log/Message partial-index pattern), so a replayed
 * send is recognised, never doubled. Nothing writes without the sender's tap —
 * the route only answers the tap that already happened.
 */
async function send({ deviceId, feedbackId, text, photo = '', clientId = '' }) {
  const thread = await threadFor(deviceId, feedbackId);
  if (!thread) return { ok: false, status: 403, error: 'this feedback id does not belong to this device' };
  const body = String(text || '').slice(0, MAX_TEXT).trim();
  let pic = '';
  if (photo) {
    if (typeof photo !== 'string' || !/^data:image\/(jpeg|png);base64,/.test(photo)) {
      return { ok: false, status: 400, error: 'photo must be a base64 JPEG or PNG data URL' };
    }
    if (photo.length > MAX_PHOTO) return { ok: false, status: 413, error: 'photo too large — resize before sending' };
    pic = photo;
  }
  if (!body && !pic) return { ok: false, status: 400, error: 'empty message' };
  if (body === '[object Object]') return { ok: false, status: 400, error: 'bad message' };

  if (clientId) {
    const dupe = await FeedbackMsg.findOne({ threadId: thread._id, clientId }).lean();
    if (dupe) return { ok: true, duplicate: true };
  }

  await FeedbackMsg.create({
    threadId: thread._id, from: 'sender', text: body, photo: pic, at: new Date(),
    clientId: clientId || undefined,
  });
  await FeedbackChat.updateOne({ _id: thread._id }, { $set: { lastMessageAt: new Date() } });
  return { ok: true };
}

/** READ — the sender's own read: the thread plus their receipt stamp. */
async function read({ deviceId, feedbackId }) {
  const thread = await threadFor(deviceId, feedbackId);
  if (!thread) return null;
  await FeedbackChat.updateOne({ _id: thread._id }, { $set: { senderReadAt: new Date() } });
  const msgs = await threadMessages(thread._id);
  return { feedbackId: thread.feedbackId, msgs, senderReadAt: new Date() };
}

/**
 * THE HQ INBOX (admin-key gated at the route): every thread, newest activity
 * first, each with its tail. Reading stamps hqReadAt — the sender's sheet can
 * show the receipt (LoopKeeper server 135, the accountability shape).
 */
async function inbox({ tail = 8 } = {}) {
  // B12 (the GLM audit): ONE updateMany stamps the receipts (was 50 updateOnes)
  // and ONE sorted fetch feeds the tails (was 50 find queries) — the admin
  // surface no longer walks an N+1 that would time out as data grows.
  const threads = await FeedbackChat.find().sort({ lastMessageAt: -1 }).limit(50).lean();
  const now = new Date();
  if (threads.length) {
    await FeedbackChat.updateMany({ _id: { $in: threads.map((t) => t._id) } }, { $set: { hqReadAt: now } }).catch(() => null);
  }
  const ids = threads.map((t) => t._id);
  const msgs = ids.length
    ? await FeedbackMsg.find({ threadId: { $in: ids } }).sort({ at: -1 }).limit(ids.length * tail).lean()
    : [];
  const byThread = new Map();
  for (const m of msgs) {
    const k = String(m.threadId);
    const arr = byThread.get(k) || [];
    if (arr.length < tail) arr.push(m);
    byThread.set(k, arr);
  }
  return threads.map((th) => ({
    feedbackId: th.feedbackId, deviceId: th.deviceId, lastMessageAt: th.lastMessageAt,
    hqReadAt: now, createdAt: th.createdAt,
    msgs: (byThread.get(String(th._id)) || []).reverse(),
  }));
}

/** THE HQ REPLY (admin-key gated at the route): HQ's line lands in the same thread. */
async function reply(feedbackId, text) {
  const thread = await FeedbackChat.findOne({ feedbackId: String(feedbackId || '').toUpperCase().slice(0, 16) }).lean();
  if (!thread) return { ok: false, status: 404, error: 'unknown thread' };
  const body = String(text || '').slice(0, MAX_TEXT).trim();
  if (!body) return { ok: false, status: 400, error: 'text required' };
  await FeedbackMsg.create({ threadId: thread._id, from: 'hq', text: body, at: new Date() });
  await FeedbackChat.updateOne({ _id: thread._id }, { $set: { lastMessageAt: new Date() } });
  return { ok: true };
}

module.exports = { mintFeedbackId, ensureId, threadFor, threadMessages, send, read, inbox, reply };