// scripts/seed-vision-route.cjs — POST /farm/:farmId/vision — THE AI-VISION
// COMPUTE (the founder's expansion directive). Inserted after the profile
// route. Node 22 fetch, no new dependency; the entitlement gates it.
const fs = require('fs');
const f = 'src/index.js';
let s = fs.readFileSync(f, 'utf8');
if (s.includes('/farm/:farmId/vision')) { console.log('  ok (already)'); process.exit(0); }

const OLD = [
  "  if (!Object.keys(set).length) return bad(res, 400, 'nothing to update');",
  '  const farm = await Farm.findByIdAndUpdate(req.auth.sub, { $set: set }, { new: true }).lean();',
  "  if (!farm) return bad(res, 404, 'farm not found');",
  '  return ok(res, { farm });',
  '}));',
].join('\n');
if (!s.includes(OLD)) { console.log('  ✗ anchor miss'); process.exit(1); }

const BT = String.fromCharCode(96); // backtick
const vision = [
  "  if (!Object.keys(set).length) return bad(res, 400, 'nothing to update');",
  '  const farm = await Farm.findByIdAndUpdate(req.auth.sub, { $set: set }, { new: true }).lean();',
  "  if (!farm) return bad(res, 404, 'farm not found');",
  '  return ok(res, { farm });',
  '}));',
  '',
  '// ── AI VISION — THE COMPUTE (the founder\u2019s expansion directive, 2026-10-07:',
  '// \u201cAI to \u2018see\u2019 the farm through the device camera — compute, count, label,',
  '// identify, measure — under advanced subscription packages\u201d). The',
  "// ENTITLEMENT lives on the farm (visionTier === 'advanced', server-side only",
  '// — nothing on the wire can flip it). The COMPUTE rides the OpenRouter chat',
  '// API with a vision model — plain fetch, no new dependency (the cap is three).',
  '// Not armed (no OPENROUTER_API_KEY) means an honest 503, never a silent',
  '// failure. The photo travels as the same client-downsized data URL the',
  '// profile photo uses; a bigger allowance than the profile (a herd shot',
  '// carries detail), still bounded.',
  "api.post('/farm/:farmId/vision', auth.requireAuth('farmer'), auth.requireFarmScope, wrap(async (req, res) => {",
  '  const farm = await Farm.findById(req.auth.sub).lean();',
  "  if (!farm) return bad(res, 404, 'farm not found');",
  "  if (farm.visionTier !== 'advanced') {",
  "    return bad(res, 403, 'AI Vision is part of the Advanced package');",
  '  }',
  '  const key = process.env.OPENROUTER_API_KEY;',
  "  if (!key) return bad(res, 503, 'AI Vision is not armed on this server');",
  '  const b = req.body || {};',
  "  const photo = String(b.photo || '');",
  "  if (!photo.startsWith('data:image/')) return bad(res, 400, 'send a photo of the farm');",
  "  if (photo.length > 1200000) return bad(res, 400, 'the photo is too large — pick a smaller one');",
  "  const question = String(b.question || '').trim().slice(0, 500);",
  '',
  "  const model = process.env.FARMLINE_VISION_MODEL || 'z-ai/glm-4.5v';",
  '  const system = [',
  "    'You are farmline" + BT + "s farm-vision assistant for smallholder farms in Kenya and East Africa.',",
  "    'Look at the photo and answer with what a good extension officer would say: COUNT animals or produce if visible; IDENTIFY breeds, plants, pests or diseases; LABEL what you see; ESTIMATE measures where possible.',",
  "    'Be concrete and brief (at most 120 words). If the photo is unclear, say exactly what is unclear.',",
  "  ].join(' ');",
  "  const userText = question ? 'The farmer asks: ' + question : 'Look at this photo from my farm. Count, identify, label and estimate what you see.';",
  '',
  '  try {',
  "    const r = await fetch('https://openrouter.ai/api/v1/chat/completions', {",
  "      method: 'POST',",
  "      headers: { 'Content-Type': 'application/json', Authorization: " + BT + 'Bearer ${key}' + BT + ' },',
  '      signal: AbortSignal.timeout(60000),',
  '      body: JSON.stringify({',
  '        model,',
  '        max_tokens: 400,',
  '        messages: [',
  "          { role: 'system', content: system },",
  "          { role: 'user', content: [",
  "            { type: 'text', text: userText },",
  "            { type: 'image_url', image_url: { url: photo } },",
  '          ] },',
  '        ],',
  '      }),',
  '    });',
  '    const j = await r.json().catch(() => null);',
  '    const insight = j && j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content;',
  '    if (!r.ok || !insight) {',
  "      console.warn('[farmline] vision:', r.status, JSON.stringify(j).slice(0, 200));",
  "      return bad(res, 502, 'the vision service did not answer — try again');",
  '    }',
  '    return ok(res, { insight });',
  '  } catch (e) {',
  "    console.warn('[farmline] vision error:', e.message);",
  "    return bad(res, 502, 'the vision service did not answer — try again');",
  '  }',
  '}));',
].join('\n');
s = s.replace(OLD, vision);
fs.writeFileSync(f, s);
console.log('  the vision compute route added');
