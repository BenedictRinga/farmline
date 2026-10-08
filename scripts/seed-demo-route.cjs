// scripts/seed-demo-route.cjs — POST /auth/demo (the public demo door) + THE
// DEMO AUTO-REPLY in chat.js (a fictional customer answers in the demo's
// threads ~5s after the visitor posts — the demo is LIVE, not a museum).
const fs = require('fs');

{
  const f = 'src/index.js';
  let s = fs.readFileSync(f, 'utf8');
  if (!s.includes("/auth/demo'")) {
    const anchor = "api.post('/auth/customer', auth.mintRateLimit, wrap(async (req, res) => {";
    if (!s.includes(anchor)) { console.log('  ✗ demo anchor miss'); process.exit(1); }
    s = s.replace(anchor, [
      "// ── THE DEMO DOOR (the founder, 2026-10-08: \"people need to SEE\") ──────────",
      "// Issues a REAL farmer token for the ONE demo farm (Farm.isDemo). No secret",
      "// on the wire — the farm holds only fictional, re-seedable data; the real",
      "// accounts are untouched (a demo token scopes to that farm, exactly like a",
      "// login token). Rate-limited like every mint.",
      "api.post('/auth/demo', auth.mintRateLimit, wrap(async (req, res) => {",
      "  const farm = await Farm.findOne({ isDemo: true });",
      "  if (!farm) return bad(res, 404, 'the demo farm is not seeded yet');",
      "  const member = await Member.findOne({ farmId: farm._id, role: 'owner', active: true });",
      "  if (!member) return bad(res, 404, 'the demo farm is not seeded yet');",
      "  return ok(res, {",
      "    token: auth.mintFarmerToken(farm._id, member._id, member.role),",
      "    farm: { id: farm._id, name: farm.name, slug: farm.slug, rung: farm.rung },",
      "    member: { id: member._id, name: member.name, role: member.role },",
      "    demo: true,",
      "  });",
      "}));",
      "",
      anchor,
    ].join('\n'));
    fs.writeFileSync(f, s);
    console.log('  index: the demo door added');
  } else console.log('  index: ok (already)');
}

{
  const f = 'src/chat.js';
  let s = fs.readFileSync(f, 'utf8');
  if (!s.includes('demoAutoReply')) {
    // Find the postMessage REST handler's tail to hook the auto-reply after a
    // farmer message in a DEMO conversation. Locate the function's final return.
    const anchor = 'async function postMessage(';
    if (!s.includes(anchor)) { console.log('  ✗ chat anchor miss'); process.exit(1); }
    const fnStart = s.indexOf(anchor);
    const close = s.indexOf('\n}', s.indexOf('return', fnStart));
    // Insert the auto-reply INSIDE the function, just before its closing brace:
    const ins = `
  // ── THE DEMO AUTO-REPLY (the founder: the demo must be LIVE) ──
  // In the demo farm's threads a posted farmer message is answered ~5s later
  // by the fictional customer with a canned line — the visitor sees a real
  // conversation working. The schedule leaves nothing behind; the reply rides
  // the same persistence path (postMessage itself).
  try {
    const demoFarm = await Farm.findById(conv.farmId).select('isDemo').lean();
    if (demoFarm && demoFarm.isDemo && me.type === 'farmer') {
      const LINES = [
        'Sawa, noted — asante!',
        'That works for me. See you then.',
        'Perfect. NIMEKUBALI.',
        'Okay — and the eggs are from today?',
        'Thank you! I will confirm in the evening.',
      ];
      const body = LINES[Math.floor(Math.random() * LINES.length)];
      const replyAt = Date.now() + 5000 + Math.floor(Math.random() * 3000);
      const secs = Math.max(1, Math.floor((replyAt - Date.now()) / 1000));
      setTimeout(async () => {
        try {
          const cust = await Customer.findById(conv.customerId).lean();
          await postMessage({
            conversationId: String(conv._id), body,
            clientId: 'demo-reply-' + replyAt + '-' + Math.random().toString(36).slice(2, 7),
          }, { type: 'customer', id: String(conv.customerId) });
        } catch { /* a dead demo reply harms nothing */ }
      }, secs * 1000);
    }
  } catch { /* never let the reply plan break the real send */ }
`;
    s = s.slice(0, close) + ins + s.slice(close);
    fs.writeFileSync(f, s);
    console.log('  chat: the demo auto-reply added');
  } else console.log('  chat: ok (already)');
}
