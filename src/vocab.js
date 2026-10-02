// src/vocab.js — THE ACCOUNTANCY-FREE VOCABULARY.
//
// This file exists because of AGENTS.md rule 1: "Never make the farmer feel like
// they are filling in an accounting system."
//
// The farmer is a farmer. farmline is the accountant. Every user-facing money
// string is built from this map, and `assertPlain()` fails the build if jargon
// leaks into a farmer- or customer-facing string.
//
// The rule is mechanical, not a matter of taste: if a term is in BANNED, it may
// appear in the database, in code, in logs and in this file — but never on a
// screen the farmer or the customer reads.

/** Canonical plain-language terms. Use these, never the left column. */
const TERMS = {
  revenue:    { sw: 'Ulifaidika', en: 'You got' },
  expense:    { sw: 'Ulitumia',   en: 'You spent' },
  netProfit:  { sw: 'Iliyobaki',  en: "You're left with" },
  costOfProd: { sw: 'Inakugharimu', en: 'What it costs you' },
  margin:     { sw: 'Kinachobaki', en: "What's left" },
  perUnit:    { sw: 'Kinachobaki kwa kila {unit}', en: "What's left from each {unit}" },
  cashflow:   { sw: 'Mwaka wako utaendaje', en: 'How the year will go' },
  assets:     { sw: 'Unachomiliki', en: 'What you own' },
  total:      { sw: 'Jumla', en: 'Total' },
  deliveryFee:{ sw: 'Ada ya kufikisha', en: 'Delivery fee' },
  free:       { sw: 'Bure', en: 'Free' },
};

/**
 * Terms that must NEVER reach a farmer- or customer-facing string before the
 * commercial rungs. This is the banned list from the spec, made enforceable.
 */
const BANNED = [
  'revenue', 'expenditure', 'expenses', 'net profit', 'gross profit',
  'cost of production', 'gross margin', 'net margin', 'ebitda',
  'debit', 'credit', 'ledger', 'journal', 'accrual', 'accrued',
  'amortisation', 'amortization', 'reconciliation', 'reconcile',
  'balance sheet', 'profit and loss', 'p&l', 'liability', 'equity',
  'depreciation', 'cost allocation', 'unit economics', 'cogs',
];

/** Terms allowed only from the commercial rungs upward, and only WITH a gloss. */
const GLOSSED = {
  'cost per litre': 'what it costs you for each litre',
  'cost per egg': 'what it costs you for each egg',
  'cost per bag': 'what it costs you for each bag',
  'contribution margin': "what's left from each one",
  'depreciation': 'what your tools and animals lose in value each year',
};

/** Look up a term in the farmer's language. */
function term(key, lang = 'en', vars = {}) {
  const t = TERMS[key];
  if (!t) return key;
  let out = t[lang] || t.en;
  for (const [k, v] of Object.entries(vars)) out = out.replace('{' + k + '}', v);
  return out;
}

/**
 * Guard: returns { ok, hits } for any banned term found in a user-facing string.
 * Called by the test suite on every seed/copy string we ship.
 */
function assertPlain(str, { allowGlossed = false } = {}) {
  const s = String(str || '').toLowerCase();
  const hits = BANNED.filter((b) => s.includes(b));
  if (!allowGlossed) {
    for (const g of Object.keys(GLOSSED)) if (s.includes(g)) hits.push(g);
  }
  return { ok: hits.length === 0, hits };
}

/**
 * Wrap a term that is allowed from the commercial rungs, so it always arrives
 * with its plain-language meaning attached. Never ship the bare term.
 */
function gloss(phrase, lang = 'en') {
  const g = GLOSSED[String(phrase).toLowerCase()];
  if (!g) return phrase;
  return `${phrase} (${g})`;
}

module.exports = { TERMS, BANNED, GLOSSED, term, assertPlain, gloss };
