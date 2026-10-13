/**
 * THE COPY-LAW GUARD (2026-10-13) — the founder: "Do the filter."
 *
 * WHY A FILTER AND NOT JUST A PROMPT: the advisor's system prompt already forbids promises
 * about money, safety or yield. But the person's OWN words arrive as `vitals` — up to two
 * thousand characters they control — and a prompt-injected "guaranteed profit" would come
 * back as OUR line on their screen. An instruction inside a prompt is a REQUEST; this is a
 * GUARD. The two are not the same thing, and the difference is the whole point.
 *
 * PURE DOMAIN LOGIC, NO HTTP COUPLING (the repo rule): every input is a string, every
 * output is data, and it is therefore unit-testable without a server or a model.
 *
 * IT REJECTS, IT DOES NOT SURGICALLY EDIT. A sentence that promises cannot be repaired
 * without risking the mangling of a line the person is about to read as their own farm's
 * description. The local draft is already good and already present, so the honest move is
 * the one the advisor already makes when the key is missing: decline, keep the draft, and
 * let it be SEEN (a silent refusal is how a soft law rots).
 *
 * THE LIST DELIBERATELY DOES NOT BAN "profit" ON ITS OWN — a farming sentence may honestly
 * say a profit depends on the rains. What is banned is the PROMISE: the guarantee, the
 * assurance, the risk-free, the cannot-fail, the double-your-money. Words that claim
 * certainty about outcomes we do not control.
 */

/** The phrases that claim certainty about money, safety or yield. */
const PROMISES = [
  /\bguarantee[ds]?\b/i,
  /\bguaranteed\b/i,
  /\bassured returns?\b/i,
  /\brisk[- ]free\b/i,
  /\bsure[- ]?fire\b/i,
  /\bcannot fail\b/i,
  /\bcan't fail\b/i,
  /\bdouble your (money|income|profit|investment)\b/i,
  /\bwill (definitely|surely|certainly) (make|earn|yield|double)\b/i,
  /\bsafe (investment|returns?|profit)\b/i,
  /\bfree money\b/i,
  /\bget rich\b/i,
];

/**
 * Check one advisor reply against the copy law.
 * @returns {{ok: true} | {ok: false, phrase: string}}
 */
function check(text) {
  const s = String(text == null ? '' : text);
  for (const re of PROMISES) {
    const m = s.match(re);
    if (m) return { ok: false, phrase: String(m[0]).slice(0, 40) };
  }
  return { ok: true };
}

module.exports = { check, PROMISES };
