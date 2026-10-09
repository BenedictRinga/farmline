// translate-v2-20261009.mjs — THE RESUMABLE TRANSLATION PASS: the per-batch
// results append to a durable JSONL (the batch results survive a crash); the
// resume skips the done keys; the timeout 300s; the final write from the JSONL.
import fs from 'fs';
const KEY = process.env.OPENROUTER_API_KEY;
if (!KEY) { console.error('no OPENROUTER_API_KEY'); process.exit(1); }
const MODEL = process.env.FARMLINE_TRANSLATE_MODEL || 'z-ai/glm-4.6';
const I18N = '/opt/farmline-app/src/assets/i18n';
const WORK = '/tmp/fl-translate';
fs.mkdirSync(WORK, { recursive: true });
const LANGS = {
    fr: 'French (France, natural UI register)',
    ha: 'Hausa (Nigeria, natural UI register)',
    am: 'Amharic (Ethiopia, natural UI register)',
};
const en = JSON.parse(fs.readFileSync(I18N + '/en.json', 'utf8'));
const flat = (o, pre, out) => {
    for (const k in o) {
        const key = pre + k;
        if (typeof o[k] === 'object') flat(o[k], key + '.', out);
        else out[key] = String(o[k]);
    }
    return out;
};
const entries = Object.entries(flat(en, '', {}));
const batch = async (items, lang) => {
    const payload = JSON.stringify(items.map(([k, v]) => ({ k, v })));
    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + KEY },
        signal: AbortSignal.timeout(300000),
        body: JSON.stringify({
            model: MODEL, max_tokens: 8000, temperature: 0.2,
            messages: [
                { role: 'system', content: 'You are a UI localisation engine. Translate each value into ' + LANGS[lang] + '. Keep every {{placeholder}} EXACTLY as-is. Keep the register short, plain, farmer-friendly. Reply with ONLY a JSON array of {k, v} objects, same order, same keys.' },
                { role: 'user', content: payload },
            ],
        }),
    });
    if (!r.ok) throw new Error('the API ' + r.status);
    const j = await r.json();
    const m = (j.choices?.[0]?.message?.content || '').match(/\[[\s\S]*\]/);
    if (!m) throw new Error('no JSON array');
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
    const jsonl = WORK + '/' + lang + '.jsonl';
    const done = new Map();
    if (fs.existsSync(jsonl)) {
        for (const line of fs.readFileSync(jsonl, 'utf8').split('\n')) {
            if (!line.trim()) continue;
            try { for (const p of JSON.parse(line)) done.set(p.k, p.v); } catch { }
        }
    }
    const remaining = entries.filter(([k]) => !done.has(k));
    console.log('=== ' + lang.toUpperCase() + ' === done ' + done.size + ' | remaining ' + remaining.length);
    const size = 30;
    for (let i = 0; i < remaining.length; i += size) {
        const chunk = remaining.slice(i, i + size);
        try {
            const pairs = await batch(chunk, lang);
            fs.appendFileSync(jsonl, JSON.stringify(pairs.filter(p => p && p.k && typeof p.v === 'string' && p.v.trim())) + '\n');
            for (const p of pairs) if (p && p.k && p.v) done.set(p.k, p.v);
            console.log('  ' + Math.min(i + size, remaining.length) + '/' + remaining.length);
        } catch (e) {
            console.log('  the batch failed: ' + String(e.message).slice(0, 80) + ' — resumable');
        }
    }
    // the final write
    const translated = unflat([...done.entries()].map(([k, v]) => ({ k, v })));
    const cur = JSON.parse(fs.readFileSync(I18N + '/' + lang + '.json', 'utf8'));
    const assign = (src, dst) => { for (const k in src) { if (typeof src[k] === 'object') { dst[k] = dst[k] || {}; assign(src[k], dst[k]); } else dst[k] = src[k]; } };
    assign(translated, cur);
    fs.writeFileSync(I18N + '/' + lang + '.json', JSON.stringify(cur, null, 2) + '\n');
    console.log('  ' + lang + ' WRITTEN: ' + done.size + '/' + entries.length);
}
console.log('THE PASS COMPLETE');