// scripts/scan-coverage-20261009.cjs — THE COVERAGE SCAN (the i18n commit gate).
//
// The law (DIRECTIVES-FARMLINE-THREAD.md §6, the founder's correction 2026-10-09:
// "every string born en+sw is an inaccuracy with weight"): every user-facing string
// is born in ALL FIVE languages — English, Kiswahili, French, Hausa, Amharic. The
// en fallback is a safety net, never an acceptable birth state — a string that ships
// untranslated in any of the five is an unfinished string.
//
// This scan is that law made mechanical: it flattens all five i18n files and fails
// on ANY key present in one language but absent in another, in either direction.
// The app's own preflight checks en↔sw only; this one is the five-language gate
// the thread runs before every commit that touches a string.
//
// The i18n files live in the APP repo (farmline-app/src/assets/i18n); this script
// lives in the SERVER repo's scripts/ (where the constitution named it) and reaches
// across by the sibling-directory convention the demo seed already uses.
//
// Run: node scripts/scan-coverage-20261009.cjs   → exit 0 on parity, 1 on any gap.
const fs = require('fs');
const path = require('path');

const APP_I18N = path.join(__dirname, '..', '..', 'farmline-app', 'src', 'assets', 'i18n');
const LANGS = ['en', 'sw', 'fr', 'ha', 'am'];

function flat(o, prefix = '') {
  const out = [];
  for (const [k, v] of Object.entries(o || {})) {
    const key = prefix + k;
    if (v && typeof v === 'object' && !Array.isArray(v)) out.push(...flat(v, key + '.'));
    else out.push(key);
  }
  return out;
}

const sets = new Map();
const counts = new Map();
let hardFail = 0;

for (const lang of LANGS) {
  const file = path.join(APP_I18N, lang + '.json');
  try {
    const doc = JSON.parse(fs.readFileSync(file, 'utf8'));
    const keys = flat(doc);
    sets.set(lang, new Set(keys));
    counts.set(lang, keys.length);
  } catch (e) {
    console.error(`  FAIL  ${lang}.json could not be read/parsed: ${e.message}`);
    hardFail++;
    sets.set(lang, new Set());
    counts.set(lang, 0);
  }
}

console.log(`\nfarmline i18n coverage — five languages (the 2026-10-09 birth law)\n`);
for (const lang of LANGS) console.log(`  ${lang}: ${counts.get(lang)} keys`);

const base = sets.get('en');
let gaps = 0;
for (let i = 0; i < LANGS.length; i++) {
  for (let j = 0; j < LANGS.length; j++) {
    if (i === j) continue;
    const a = LANGS[i]; const b = LANGS[j];
    const missing = [...sets.get(a)].filter((k) => !sets.get(b).has(k));
    if (missing.length) {
      gaps += missing.length;
      console.error(`  FAIL  ${missing.length} key(s) in ${a}.json missing from ${b}.json: ${missing.slice(0, 8).join(', ')}${missing.length > 8 ? ' …' : ''}`);
    }
  }
}
// The placeholders must survive every language — a lost {{param}} renders a raw
// sentence. A key present everywhere but carrying different placeholders in one
// translation is its own quiet breakage.
const perLangParams = new Map();
for (const lang of LANGS) {
  const doc = JSON.parse(fs.readFileSync(path.join(APP_I18N, lang + '.json'), 'utf8'));
  const m = new Map();
  const walk = (o, prefix) => {
    for (const [k, v] of Object.entries(o || {})) {
      const key = prefix + k;
      if (v && typeof v === 'object') { walk(v, key + '.'); continue; }
      const params = (String(v).match(/\{\{\s*\w+\s*\}\}/g) || []).sort().join(',');
      if (params) m.set(key, params);
    }
  };
  walk(doc, '');
  perLangParams.set(lang, m);
}
const enParams = perLangParams.get('en');
for (const lang of LANGS) {
  if (lang === 'en') continue;
  for (const [key, params] of enParams) {
    const got = perLangParams.get(lang).get(key);
    if (got !== undefined && got !== params) {
      console.error(`  FAIL  ${key}: placeholders differ (en has {${params}}, ${lang} has {${got}})`);
      gaps++;
    }
  }
}

if (gaps || hardFail) {
  console.error(`\nCOVERAGE FAILED — ${gaps + hardFail} gap(s). A string that ships untranslated in any of the five is an unfinished string.\n`);
  process.exit(1);
}
console.log(`\nCOVERAGE PASSED — ${base.size} keys, born in all five languages, placeholders intact.\n`);
process.exit(0);