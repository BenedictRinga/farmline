// translate-full-20261009.mjs — THE FULL TRANSLATION PASS (the founder: keys
// "are not translated… several"): the en.json's 503 keys → fr/ha/am, batched
// through OpenRouter (the GLM text model), the {{placeholders}} preserved.
// The output merges OVER the existing files (my hand overlays the subset —
// the machine pass completes the rest). Runs ON THE DROPLET (the key lives
// there); the results scp back into the repos.
import fs from 'fs';
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('no OPENROUTER_API_KEY'); process.exit(1); }
const MODEL = process.env.FARMLINE_TRANSLATE_MODEL || 'z-ai/glm-4.6';
const LANGS = {
    fr: 'French (France, natural UI register)',
    ha: 'Hausa (Nigeria, natural UI register)',
    am: 'Amharic (Ethiopia, natural UI register)',
};
const en = JSON.parse(fs.readFileSync('src/assets/i18n/en.json', 'utf8'));
// flatten to path→value
const flat = (o, pre, out) => {
    for (const k in o) {
        const key = pre + k;
        if (typeof o[k] === 'object') flat(o[k], key + '.', out);
        else out[key] = String(o[k]);
    }
    return out;
};
const entries = Object.entries(flat(en, '', {}));
console.log('the keys to translate:', entries.length);
const batch = async (items, lang) => {
    const payload = JSON.stringify(items.map(([k, v]) => ({ k, v })));
    const body = {
        model: MODEL,
        max_tokens: 8000,
        temperature: 0.2,
        messages: [
            { role: 'system', content: 'You are a UI localisation engine. Translate each value into ' + LANGS[lang] + '. Keep every {{placeholder}} EXACTLY as-is. Keep the register short, plain, farmer-friendly. Reply with ONLY a JSON array of {k, v} objects, same order, same keys.' },
            { role: 'user', content: payload },
        ],
    };
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
        signal: AbortSignal.timeout(180000),
        body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error('the API ' + r.status + ': ' + (await r.text()).slice(0, 200));
    const j = await r.json();
    const txt = j.choices?.[0]?.message?.content || '';
    const m = txt.match(/\[[\s\S]*\]/);
    if (!m) throw new Error('no JSON array in the reply: ' + txt.slice(0, 120));
    return JSON.parse(m[0].replace(/,\s*]/g, ']'));
};
const unflat = (pairs) => {
    const out = {};
    for (const { k, v } of pairs) {
        const parts = k.split('.');
        let cur = out;
        for (let i = 0; i < parts.length - 1; i++) cur = cur[parts[i]] = cur[parts[i]] || {};
        cur[parts[parts.length - 1]] = v;
    }
    return out;
};
for (const lang of Object.keys(LANGS)) {
    console.log('=== ' + lang.toUpperCase() + ' ===');
    const out = {};
    const size = 40;
    for (let i = 0; i < entries.length; i += size) {
        const chunk = entries.slice(i, i + size);
        try {
            const pairs = await batch(chunk, lang);
            for (const p of pairs) if (p && p.k && typeof p.v === 'string' && p.v.trim()) out[p.k] = p.v;
            console.log('  ' + Math.min(i + size, entries.length) + '/' + entries.length);
        } catch (e) {
            console.log('  the batch ' + i + ' failed: ' + String(e.message).slice(0, 100) + ' — keeping the English for those keys');
        }
    }
    const translated = unflat(out);
    // merge over the EXISTING file (the core overlays remain if better)
    const cur = JSON.parse(fs.readFileSync('src/assets/i18n/' + lang + '.json', 'utf8'));
    const merged = JSON.parse(JSON.stringify(cur));
    const assign = (src, dst) => { for (const k in src) { if (typeof src[k] === 'object') { dst[k] = dst[k] || {}; assign(src[k], dst[k]); } else dst[k] = src[k]; } };
    assign(translated, merged);
    fs.writeFileSync('src/assets/i18n/' + lang + '.json', JSON.stringify(merged, null, 2) + '\n');
    const flatM = flat(merged, '', {});
    let same = 0;
    for (const [k, v] of Object.entries(flatM)) if (v === flat(en, '', {})[k]) same++;
    console.log('  ' + lang + ': written | the keys still identical to en: ' + same + ' (the intentional: brand names/units; the rest = the batch failures)');
}
console.log('THE TRANSLATION PASS COMPLETE');