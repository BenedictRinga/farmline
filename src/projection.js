// src/projection.js — THE SECURITY BOUNDARY.
//
// Two jobs, and both are load-bearing:
//
//  1. buildAvailability() — the customer's shop, DERIVED from farm records.
//     Where the farmer's work becomes sellable stock without a single extra tap.
//
//  2. publicFarm() — an explicit ALLOWLIST of what a customer may see.
//     This is not a formatting preference. If a field is not named in
//     CUSTOMER_FARM_FIELDS it cannot reach the customer face, no matter what is
//     added to the Farm schema later. Costs, animals, treatments, other customers'
//     orders and the farm's money are structurally unreachable.
//
// The tests assert both: that logging raises stock, and that no operational term
// can appear in a public payload.
const mongoose = require('mongoose');
const { Sellable, Log, Hold, Animal, CropCycle, Farm, Order } = require('./models');

const DAY = 86400000;

/** Aggregation pipelines do NOT cast strings to ObjectId. Route every id through
 *  this or an aggregate silently matches nothing — which reads as "no stock"
 *  rather than as an error, the worst possible failure mode for a shop. */
const oid = (v) => new mongoose.Types.ObjectId(String(v));

/** The ONLY Farm fields a customer may ever receive. Adding to this list is a
 *  deliberate act; forgetting to add a field fails closed. */
const CUSTOMER_FARM_FIELDS = [
  // C6: 'trust' REMOVED from the allowlist — the derived signals are not built
  // yet, so the field carried only the schema's fabricated defaults (see
  // publicFarm below). It returns when the derivation exists.
  'name', 'slug', 'area', 'county', 'story', 'photos', 'verifiedFarm', 'terms', 'slots',
  // ROUND A (the buyer's guide): `photo` is THE FARM'S FACE — the one hero
  // photograph the farmer uploaded (build 16). The photograph is the trust
  // layer's first movement, and until now the buyer never received it: the
  // allowlist carried the old Photo Kit array only. One field opens; nothing else does.
  'photo',
];

/** Strip a Farm document down to the customer allowlist. */
function publicFarm(farm) {
  if (!farm) return null;
  const out = {};
  for (const k of CUSTOMER_FARM_FIELDS) out[k] = farm[k];
  // C6 (the GLM audit, 2026-10-10): trust signals are NOT exposed at all until
  // they are COMPUTED. The schema defaults (adherence 1, rates 0) rode through
  // `?? 1` and a farm with zero records shipped a perfect adherence score to
  // every buyer — the no-assurance register is a standing law. Nothing in the
  // buyer face reads these fields today, so removing the exposure touches no
  // display; when the nightly derivation job exists, restore this block carrying
  // ONLY computed values, absent when nothing real stands behind them.
  return out;
}

/**
 * Derive the stock for one sellable from the farm's own records.
 * Returns { qty, reason } where reason explains an empty or suppressed shelf.
 */
async function deriveStock(farmId, s, { holds }) {
  // 1. SUPPRESSION FIRST. A hold beats every other answer — if the milk is not
  //    safe to sell, the shelf is empty for that reason, full stop.
  if (s.affects?.length) {
    const blocking = holds.find((h) => h.affects?.some((a) => s.affects.includes(a)));
    if (blocking) {
      return {
        qty: 0,
        suppressed: true,
        until: blocking.until,
        subjectLabel: blocking.subjectLabel,
        reason: { en: 'Not available — treated', sw: 'Haipatikani — imepewa dawa' },
      };
    }
  }

  // 2. Otherwise, project from the configured source.
  const kind = s.source?.kind || 'none';
  if (kind === 'none') return { qty: 0, reason: null };

  if (kind === 'production') {
    const since = new Date(Date.now() - (s.source.windowDays || 1) * DAY);
    const fid = oid(farmId);   // aggregation does NOT cast — must be a real ObjectId
    const rows = await Log.aggregate([
      // archivedAt: null — a REVERSED record stops counting the moment it is
      // archived (Layer 2 in-situ reversal). The shelf is a projection of the
      // records, so an undone record must take its milk off the shelf again.
      { $match: { farmId: fid, product: s.source.product || s.product, kind: { $in: ['milk', 'eggs'] }, at: { $gte: since }, archivedAt: null } },
      { $group: { _id: null, total: { $sum: '$quantity' } } },
    ]);
    const produced = rows[0]?.total || 0;
    // Subtract what has already been ordered but not yet collected — the shelf
    // must not promise the same crates twice.
    const pending = await Order.aggregate([
      { $match: { farmId: fid, stage: { $lt: 5 }, 'lines.product': s.product } },
      { $unwind: '$lines' },
      { $match: { 'lines.product': s.product } },
      { $group: { _id: null, total: { $sum: '$lines.qty' } } },
    ]);
    const committed = pending[0]?.total || 0;
    return { qty: Math.max(0, Math.round((produced - committed) * 100) / 100), reason: null };
  }

  if (kind === 'harvest') {
    const rows = await CropCycle.aggregate([
      { $match: { farmId: oid(farmId), crop: s.source.product || s.product, status: 'harvested' } },
      { $group: { _id: null, total: { $sum: '$yield.quantity' } } },
    ]);
    return { qty: Math.round((rows[0]?.total || 0) * 100) / 100, reason: null };
  }

  if (kind === 'animalForSale') {
    const n = await Animal.countDocuments({ farmId: oid(farmId), status: 'forSale', species: s.source.product || s.product });
    return { qty: n, reason: null };
  }

  return { qty: 0, reason: null };
}

/**
 * buildAvailability — the shop, as the customer sees it.
 * Open (no auth): the link must work from a cold browser.
 */
async function buildAvailability(farmId, { lang = 'en' } = {}) {
  const [sellables, holds] = await Promise.all([
    Sellable.find({ farmId, enabled: true }).lean(),
    Hold.find({ farmId, active: true, until: { $gt: new Date() } }).lean(),
  ]);

  const items = [];
  for (const s of sellables) {
    const stock = await deriveStock(farmId, s, { holds });
    items.push({
      product: s.product,
      label: lang === 'sw' && s.labelSw ? s.labelSw : (s.label || s.product),
      icon: s.icon || '',
      unit: lang === 'sw' && s.unitSw ? s.unitSw : (s.unit || ''),
      price: s.price,
      minQty: s.minQty || 1,
      available: !stock.suppressed && stock.qty >= (s.minQty || 1),
      qty: stock.qty,
      suppressed: !!stock.suppressed,
      until: stock.until || null,
      reason: stock.reason ? stock.reason[lang] || stock.reason.en : null,
    });
  }
  return items;
}

/**
 * buyerRecords — THE READABLE RECORDS, as the BUYER may read them (Round A).
 *
 * The buyer's trust mechanism is that this shelf fell out of records kept on the
 * farm. This shape says so with NUMBERS ONLY, never sentences — the app renders
 * the words in either language (the same law /sharp obeys), so the server's
 * payload stays honest in both.
 *
 * What a buyer may read: what the farm's own logs recorded, inside a small
 * window, for the products ON THE SHELF. What stays structurally unreadable
 * here: costs, the farm's sales money, herd counts, the treatments list,
 * mortality — the buyer reads freshness and care, never the farm's management
 * (framework §1.6: the customer face sees the shelf, not how the farm is run).
 *
 * The matching MIRRORS deriveStock exactly — same product key, same kinds, same
 * archivedAt: null — so this summary can never disagree with the shelf it stands
 * behind (a reversed record leaves both at once).
 */
async function buyerRecords(farmId, { lang = 'en', windowDays = 7 } = {}) {
  const since = new Date(Date.now() - windowDays * DAY);
  const sellables = await Sellable.find({ farmId, enabled: true }).lean();
  const fed = sellables
    .filter((s) => ['production', 'harvest'].includes(s.source?.kind))
    .map((s) => ({ sellable: s, product: s.source?.product || s.product }));
  if (!fed.length) return { window: windowDays, fresh: [] };

  const rows = await Log.find({
    farmId: oid(farmId), archivedAt: null,
    kind: { $in: ['milk', 'eggs', 'harvest'] },
    product: { $in: fed.map((f) => f.product) },
    at: { $gte: since },
  }).select('kind product quantity').lean();

  const fresh = [];
  for (const { sellable: s, product } of fed) {
    const kinds = s.source.kind === 'harvest' ? ['harvest'] : ['milk', 'eggs'];
    const mine = rows.filter((l) => l.product === product && kinds.includes(l.kind));
    const qty = Math.round(mine.reduce((a, l) => a + (Number(l.quantity) || 0), 0) * 100) / 100;
    if (qty <= 0) continue;
    fresh.push({
      product,
      label: lang === 'sw' && s.labelSw ? s.labelSw : (s.label || s.product),
      unit: lang === 'sw' && s.unitSw ? s.unitSw : (s.unit || ''),
      qty,
    });
  }
  fresh.sort((a, b) => b.qty - a.qty);
  return { window: windowDays, fresh };
}

/** Live holds, as the FARMER sees them (richer — this is their own farm). */
async function activeHolds(farmId) {
  const holds = await Hold.find({ farmId, active: true, until: { $gt: new Date() } }).sort({ until: 1 }).lean();
  const now = Date.now();
  return holds.map((h) => ({
    id: h._id,
    subjectLabel: h.subjectLabel,
    product: h.product,
    affects: h.affects,
    until: h.until,
    daysLeft: Math.max(1, Math.ceil((new Date(h.until).getTime() - now) / DAY)),
    days: h.days,
  }));
}

module.exports = { publicFarm, buildAvailability, buyerRecords, activeHolds, deriveStock, CUSTOMER_FARM_FIELDS };
