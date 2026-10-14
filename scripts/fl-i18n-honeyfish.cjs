// fl-i18n-honeyfish.cjs — the meat/honey/fish keys, born in all five languages.
// File-based (no shell escapes), EOL-agnostic (the CRLF lesson), and the guard
// throws BEFORE any write so a failed match can never leave a half-applied file.
const fs = require('fs');

const BASE = 'D:/MacBook/noGoogle/farmline-app/src/assets/i18n';

// The house translations. The apostrophes are typographic (') where the
// language needs one — the straight-quote trap is a recorded lesson.
const KEYS = {
  en: {
    today: {
      capHoneyWord: 'Honey',
      capFishWord: 'Fish',
      capSoldLiveWord: 'Sold live',
      capFishCountPh: 'How many fish?',
      capFishKgPh: 'kg if you weighed them (optional)',
      soldLiveNoHerd: 'Add an animal group first — a live sale needs a herd',
      soldLiveCountPh: 'How many animals?',
      soldLivePricePh: 'The agreed price (0 if not said)',
      soldLiveNone: 'Nothing sold — nothing recorded',
      soldLiveTooMany: 'The herd holds {n} — you cannot sell more than it holds',
    },
    'record.kind': { honey: 'Honey', fish: 'Fish', 'live-sale': 'Sold live' },
    prod: { fish: 'fish' },
  },
  sw: {
    today: {
      capHoneyWord: 'Asali',
      capFishWord: 'Samaki',
      capSoldLiveWord: 'Imeuzwa hai',
      capFishCountPh: 'Samaki wangapi?',
      capFishKgPh: 'Kilo ikiwa umepima (si lazima)',
      soldLiveNoHerd: 'Ongeza kundi la wanyama kwanza — mauzo ya hai yanahitaji kundi',
      soldLiveCountPh: 'Wanyama wangapi?',
      soldLivePricePh: 'Bei ya makubaliano (0 kama haijataswa)',
      soldLiveNone: 'Hakuna kilichouzwa — hakuna kilichorekodiwa',
      soldLiveTooMany: 'Kundi lina {n} — huwezi kuuza zaidi ya hapo',
    },
    'record.kind': { honey: 'Asali', fish: 'Samaki', 'live-sale': 'Imeuzwa hai' },
    prod: { fish: 'samaki' },
  },
  fr: {
    today: {
      capHoneyWord: 'Miel',
      capFishWord: 'Poisson',
      capSoldLiveWord: 'Vendu vivant',
      capFishCountPh: 'Combien de poissons ?',
      capFishKgPh: 'kg si vous les avez pesés (facultatif)',
      soldLiveNoHerd: 'Ajoutez d’abord un groupe d’animaux — une vente sur pied a besoin d’un troupeau',
      soldLiveCountPh: 'Combien d’animaux ?',
      soldLivePricePh: 'Le prix convenu (0 si non dit)',
      soldLiveNone: 'Rien de vendu — rien d’enregistré',
      soldLiveTooMany: 'Le groupe compte {n} — vous ne pouvez pas en vendre davantage',
    },
    'record.kind': { honey: 'Miel', fish: 'Poisson', 'live-sale': 'Vendu vivant' },
    prod: { fish: 'poisson' },
  },
  ha: {
    today: {
      capHoneyWord: 'Zuma',
      capFishWord: 'Kifi',
      capSoldLiveWord: 'Sayar da rai',
      capFishCountPh: 'Kifi nawa?',
      capFishKgPh: 'kg idan an auna su (ba dole ba)',
      soldLiveNoHerd: 'Farawa da ƙara rukunin dabbobi — sayar da rai tana bukatar rukuni',
      soldLiveCountPh: 'Dabbobi nawa?',
      soldLivePricePh: 'Farashin da aka amince da shi (0 idan ba a faɗi ba)',
      soldLiveNone: 'Ba abin da aka sayar — ba abin da aka rubuta',
      soldLiveTooMany: 'Rukunin yana da {n} — ba za a iya sayar da fiye da haka ba',
    },
    'record.kind': { honey: 'Zuma', fish: 'Kifi', 'live-sale': 'Sayar da rai' },
    prod: { fish: 'kifi' },
  },
  am: {
    today: {
      capHoneyWord: 'ማር',
      capFishWord: 'ዓሳ',
      capSoldLiveWord: 'በሕይወት ተሽጧል',
      capFishCountPh: 'ስንት ዓሳ?',
      capFishKgPh: 'ኪሎ ከተመዘነ (አማራጭ)',
      soldLiveNoHerd: 'መጀመሪያ የእንስሳት ቡድን ያክሉ — በሕይወት ሽያጭ ቡድን ያስፈልገዋል',
      soldLiveCountPh: 'ስንት እንስሳ?',
      soldLivePricePh: 'የተስማማችበት ዋጋ (ካልተነገረ 0)',
      soldLiveNone: 'ምንም አልተሸጠም — ምንም አልተመዘገበም',
      soldLiveTooMany: 'ቡድኑ {n} አሉት — ከዚያ በላይ መሸጥ አይቻልም',
    },
    'record.kind': { honey: 'ማር', fish: 'ዓሳ', 'live-sale': 'በሕይወት ተሽጧል' },
    prod: { fish: 'ዓሳ' },
  },
};

for (const lang of Object.keys(KEYS)) {
  const p = `${BASE}/${lang}.json`;
  const raw = fs.readFileSync(p, 'utf8');
  const eol = raw.includes('\r\n') ? '\r\n' : '\n';
  const doc = JSON.parse(raw);

  // THE GUARD BEFORE THE WRITE: every target section must exist, and every
  // NEW key must not already exist with a DIFFERENT value (an overwrite here
  // would be a silent edit of someone's words — never allowed).
  // A dotted section name ('record.kind') is a NESTED path in the house files.
  const sectionOf = (name) => name.split('.').reduce((o, k) => (o ? o[k] : undefined), doc);
  for (const section of Object.keys(KEYS[lang])) {
    const target = sectionOf(section);
    if (!target) throw new Error(`${lang}: the ${section} section is missing — the anchor has drifted`);
    for (const k of Object.keys(KEYS[lang][section])) {
      if (target[k] !== undefined && target[k] !== KEYS[lang][section][k]) {
        throw new Error(`${lang}: ${section}.${k} already exists with a different value — refusing to overwrite`);
      }
    }
  }

  for (const section of Object.keys(KEYS[lang])) {
    const parts = section.split('.');
    let target = doc;
    for (let i = 0; i < parts.length - 1; i++) target = target[parts[i]];
    Object.assign(target[parts[parts.length - 1]], KEYS[lang][section]);
  }

  // Re-serialize with the SAME indentation the file carries (2 spaces in the
  // house files), preserving key order as much as JSON.parse allows.
  const out = JSON.stringify(doc, null, 2) + eol;
  fs.writeFileSync(p, out, 'utf8');
  console.log(`${lang}: written — today +record.kind +prod.fish`);
}

// THE SELF-CHECK: every new key must now exist and be equal in all five.
const wanted = ['capHoneyWord', 'capFishWord', 'capSoldLiveWord', 'capFishCountPh', 'capFishKgPh', 'soldLiveNoHerd', 'soldLiveCountPh', 'soldLivePricePh', 'soldLiveNone', 'soldLiveTooMany'];
for (const lang of Object.keys(KEYS)) {
  const doc = JSON.parse(fs.readFileSync(`${BASE}/${lang}.json`, 'utf8'));
  for (const k of wanted) if (doc.today[k] === undefined) throw new Error(`${lang}: today.${k} MISSING after write`);
  for (const k of ['honey', 'fish', 'live-sale']) if (doc.record.kind[k] === undefined) throw new Error(`${lang}: record.kind.${k} MISSING after write`);
  if (doc.prod.fish === undefined) throw new Error(`${lang}: prod.fish MISSING after write`);
}
console.log('ALL FIVE CARRY THE NEW KEYS — honey, fish, and the honest live-sale label');
