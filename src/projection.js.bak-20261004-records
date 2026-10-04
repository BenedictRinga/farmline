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
  'name', 'slug', 'area', 'county', 'story', 'photos', 'verifiedFarm', 'terms', 'slots', 'trust',
];

/** Strip a Farm document down to the customer allowlist. */
function publicFarm(farm) {
  if (!farm) return null;
  const out = {};
  for (const k of CUSTOMER_FARM_FIELDS) out[k] = farm[k];
  // Trust signals are safe and are the customer's main reassurance — but only the
  // aggregated ones. Never the raw counts behind them.
  out.trust = {
    withdrawalAdherence: farm?.trust?.withdrawalAdherence ?? 1,
    vaccinationsCurrent: !!farm?.trust?.vaccinationsCurrent,
    responseRate: farm?.trust?.responseRate ?? 0,
    ordersFulfilled: farm?.trust?.ordersFulfilled ?? 0,
  };
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
      { $match: { farmId: fid, product: s.source.product || s.product, kind: { $in: ['milk', 'eggs'] }, at: { $gte: since } } },
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

module.exports = { publicFarm, buildAvailability, activeHolds, deriveStock, CUSTOMER_FARM_FIELDS };
