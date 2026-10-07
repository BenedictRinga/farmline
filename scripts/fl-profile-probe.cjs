// fl-profile-probe.cjs — the farm profile, live: PATCH the name (and a tiny
// photo), read /me, assert, revert. The route is the Settings Profile hand.
const base = process.argv[2] || 'http://localhost:4600';
(async () => {
  const login = await fetch(base + '/api/farmline/auth/farmer/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '0700000001', pin: '1234' }),
  });
  const lj = await login.json();
  if (!lj.token) { console.log('LOGIN FAIL'); process.exit(1); }
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + lj.token };
  const me = await (await fetch(base + '/api/farmline/me', { headers: H })).json();
  const farmId = me.farm._id;
  const oldName = me.farm.name;
  const oldArea = me.farm.area || '';
  console.log('before:', JSON.stringify({ name: oldName, area: oldArea, visionTier: me.farm.visionTier }));

  let fail = 0;
  // 1. Rename (the founder's exact pain: stuck with the default).
  const r1 = await fetch(`${base}/api/farmline/farm/${farmId}/profile`, { method: 'PATCH', headers: H, body: JSON.stringify({ name: 'Kiamara Farm', area: 'Limuru, Kiambu' }) });
  const j1 = await r1.json();
  console.log('PATCH name+area →', r1.status, '| name now:', j1.farm?.name, '| area now:', j1.farm?.area);
  if (r1.status !== 200 || j1.farm?.name !== 'Kiamara Farm') { console.log('FAIL rename'); fail++; }

  // 2. A real tiny photo (1x1 JPEG data URL, the shape the app sends).
  const tiny = 'data:image/jpeg;base64,/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwcJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPDs0NDT/wAALCAABAAEBAREA/8QAFAABAQAAAAAAAAAAAAAAAAAAAAv/xAAUEAEAAAAAAAAAAAAAAAAAAAAA/8QAFBEBAAAAAAAAAAAAAAAAAAAAAP/aAAwDAQACEQMRAD8AmAA//9k=';
  const r2 = await fetch(`${base}/api/farmline/farm/${farmId}/profile`, { method: 'PATCH', headers: H, body: JSON.stringify({ photo: tiny }) });
  const j2 = await r2.json();
  console.log('PATCH photo →', r2.status, '| photo set:', String(j2.farm?.photo || '').startsWith('data:image/'));
  if (r2.status !== 200 || !String(j2.farm?.photo || '').startsWith('data:image/')) { console.log('FAIL photo'); fail++; }

  // 3. A malicious/too-large photo is refused plainly.
  const r3 = await fetch(`${base}/api/farmline/farm/${farmId}/profile`, { method: 'PATCH', headers: H, body: JSON.stringify({ photo: 'http://evil/x.png' }) });
  console.log('PATCH junk photo →', r3.status, '(must be 400)');
  if (r3.status !== 400) { console.log('FAIL junk refused'); fail++; }

  // 4. An empty name is refused.
  const r4 = await fetch(`${base}/api/farmline/farm/${farmId}/profile`, { method: 'PATCH', headers: H, body: JSON.stringify({ name: '  ' }) });
  console.log('PATCH empty name →', r4.status, '(must be 400)');
  if (r4.status !== 400) { console.log('FAIL empty name refused'); fail++; }

  // 5. /me carries the change + the vision tier.
  const me2 = await (await fetch(base + '/api/farmline/me', { headers: H })).json();
  console.log('/me now:', JSON.stringify({ name: me2.farm.name, photo: String(me2.farm.photo || '').startsWith('data:image/'), visionTier: me2.farm.visionTier }));
  if (me2.farm.name !== 'Kiamara Farm') { console.log('FAIL /me persistence'); fail++; }
  if (me2.farm.visionTier !== 'none') { console.log('FAIL visionTier default'); fail++; }

  // 6. Revert the seeded farm's name/area/photo to the probe-start state.
  const r5 = await fetch(`${base}/api/farmline/farm/${farmId}/profile`, { method: 'PATCH', headers: H, body: JSON.stringify({ name: oldName, area: oldArea, photo: '' }) });
  const j5 = await r5.json();
  console.log('reverted →', r5.status, '| name back:', j5.farm?.name);

  console.log(fail ? `\n${fail} FAIL` : '\nTHE PROFILE HAND IS LIVE');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });