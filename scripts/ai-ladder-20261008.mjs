// ai-ladder-20261008.mjs — the founder: "Integrate the Tiers 1-3 of
// AI-impacted and deeper layered services now into the ladder rungs…
// In user-facing language augment the current ladder rungs."
// Each rung gains an `ai` bilingual array (the farmer-facing capability
// lines), landing() serves it, the app's teaser renders "farmline's
// intelligence" per rung. The aspirational ladder: users and investors
// aspire; the build follows the ladder.
import fs from 'fs';
let s = fs.readFileSync('src/ladder.js', 'utf8');

// The per-rung AI blocks, inserted after each rung's `gets:` close (before commitment).
const AI = {
  farm: [
    'Ask farmline anything about your own records — in plain words',
    'A monthly note from farmline: what your farm is telling you',
  ],
  farmSw: [
    'Uliza farmline chochote kuhusu rekodi zako — kwa maneno rahisi',
    'Taarifa ya mwezi kutoka farmline: shamba lako linasema nini',
  ],
  record: [
    'Your records, spoken back to you — voice notes become entries',
    "The farm's numbers explained, never just shown",
  ],
  recordSw: [
    'Rekodi zako zinazungumzwa — sauti zinakuwa mabano',
    'Namba za shamba zinaelezwa, si kuonyeshwa tu',
  ],
  sharpen: [
    'The acre question answered by your own data',
    "What worked and what didn't — read from your records, not guessed",
  ],
  sharpenSw: [
    'Swali la ekari linajibiwa na data yako mwenyewe',
    'Kilichofanya kazi na kisichofanya — linasomwa kwenye rekodi zako, si kutabiriwa',
  ],
  verdict: [
    "Your daily records by voice — milk, eggs and harvest, spoken not typed",
    'AI Vision: photograph a sick animal or a troubled crop, get the extension officer\'s read',
    "A weekly letter from farmline's intelligence: what your farm is telling you",
    'Photograph a receipt or a coop slip — it becomes a record',
  ],
  verdictSw: [
    'Rekodi za kila siku kwa sauti — maziwa, mayai na mavuno, unazungumza si kuandika',
    'AI Vision: piga pua mnyama mgonjwa au zao linaloharibika, upate ushauri wa afisa wa ugawaji',
    'Barua ya wiki kutoka kwa akili ya farmline: shamba lako linasema nini',
    'Piga pua risiti au slipi ya coop — inakuwa rekodi',
  ],
  plan: [
    'The daily AI brief: what happened, what it means, what to do',
    'Herd audits by photo — the count checked against your records',
    'Market prices for your area, read against your harvest',
    'Voice records without a cap',
  ],
  planSw: [
    'Taarifa ya kila siku ya AI: kilichotokea, kimaanisha nini, nifanye nini',
    'Uchunguzi wa kundi kwa pua — idadi ikilinganishwa na rekodi zako',
    'Bei za soko za eneo lako, zikisomwa dhidi ya mavuno yako',
    'Rekodi za sausi bila kikomo',
  ],
  operate: [
    "The AI extension officer in your pocket — it knows your farm's history",
    'Weather-aware schedules: the rain read against your plan',
    'Priority compute for every photo and every question',
  ],
  operateSw: [
    'Afisa wa ugawaji wa AI mfukoni mwako — anajua historia ya shamba lako',
    'Ratiba zinazotambua hali ya hewa: mvua ikisomwa dhidi ya mpango wako',
    'Kasi ya kipekee kwa kila pua na kila swali',
  ],
  commerce: [
    "A shop that talks: buyers' questions answered from your farm's real data",
    'The early-warning network: pests and diseases seen near you, flagged to you first',
    'First in line for every new intelligence farmline ships',
  ],
  commerceSw: [
    'Duka linalozungumza: maswali ya wanaunuzi yanajibiwa kutoka kwa data halisi ya shamba lako',
    'Mtandao wa tahadhari ya mapema: wadudu na magonjwa yaliyoonekana karibi nawe, wewe ndiye kwanza kujua',
    'Wa kwanza kwenye kila akili mpya inayotoka farmline',
  ],
};
const ORDER = ['farm', 'record', 'sharpen', 'verdict', 'plan', 'operate', 'commerce'];

let placed = 0;
for (const id of ORDER) {
  if (s.includes(`ai: {\n      sw: ['${AI[id + 'Sw'][0]}'.slice(0, 30)]`) || s.includes(`ai: {`)) {
    // the per-rung guard: count the ai blocks already placed
  }
}
// insert per rung: after the rung's gets block's closing "},\n    commitment:"
for (const id of ORDER) {
  const firstEn = AI[id][0];
  if (s.includes(`ai: {\n      sw: ['${AI[id + 'Sw'][0]}`.slice(0, 60))) continue;
  // find this rung's commitment line by its known text
  const rungIdx = s.indexOf(`id: '${id}'`);
  if (rungIdx < 0) { console.log('MISS rung', id); process.exit(1); }
  const commitIdx = s.indexOf('commitment: {', rungIdx);
  if (commitIdx < 0) { console.log('MISS commitment', id); process.exit(1); }
  const swArr = AI[id + 'Sw'].map(x => `'${x}'`).join(', ');
  const enArr = AI[id].map(x => `'${x}'`).join(', ');
  const block = `    // THE AI LADDER (the founder, 2026-10-08: the Tiers 1-3 services live in\n    // the rungs — users and investors aspire, the build follows the ladder).\n    ai: {\n      sw: [${swArr}],\n      en: [${enArr}],\n    },\n`;
  const lineStart = s.lastIndexOf('\n', s.lastIndexOf('  },', commitIdx) === -1 ? commitIdx : s.lastIndexOf('  },', commitIdx));
  // insert BEFORE the commitment's line start
  const insertAt = s.lastIndexOf('\n    commitment:', commitIdx === -1 ? rungIdx : commitIdx);
  if (insertAt < 0) { console.log('MISS insert point', id); process.exit(1); }
  s = s.slice(0, insertAt + 1) + block + s.slice(insertAt + 1);
  placed++;
}
console.log('ai blocks placed:', placed);

// landing() carries it
if (!s.includes('aiLadder')) {
  s = s.replace(
    "    commitment: r.commitment[lang],",
    "    commitment: r.commitment[lang],\n    aiLadder: (r.ai && (r.ai[lang] || r.ai.en)) || [],",
    1,
  );
  console.log('landing() carries aiLadder');
}
fs.writeFileSync('src/ladder.js', s);
console.log('done');