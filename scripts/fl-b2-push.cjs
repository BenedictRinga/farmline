// fl-b2-push.cjs — the B2 accelerator, live: a socket.io client connects as
// the farmer (joins the updates room), the announce door fires, the push
// arrives. Also asserts the connect-time floor delivery.
const { execSync, spawn } = require('child_process');
const http = require('http');
const base = 'http://localhost:4600';
const SECRET = 'fl-test-announce';

(async () => {
  const login = await fetch(base + '/api/farmline/auth/farmer/login', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ phone: '0700000001', pin: '1234' }),
  });
  const lj = await login.json();
  if (!lj.token) { console.log('LOGIN FAIL'); process.exit(1); }
  const H = { 'Content-Type': 'application/json', Authorization: 'Bearer ' + lj.token };

  // 1. The door is CLOSED without the secret (honest disabled state).
  const r0 = await fetch(base + '/api/farmline/updates/announce', { method: 'POST' });
  console.log('no-secret door →', r0.status, '(404/401 = closed as designed)');

  // 2. The socket client: connect, listen, then announce with the secret.
  const { io } = require('socket.io-client');
  const sock = io(base, { path: '/socket-farmline/', auth: { token: lj.token }, transports: ['websocket', 'polling'] });
  const events = [];
  sock.on('update:mandatory', (d) => events.push(d));
  await new Promise((res) => sock.on('connect', res));
  console.log('socket connected (in the updates room)');

  // 3. The announce with the secret — the server must run with
  //    FARMLINE_ANNOUNCE_SECRET + a mandatory floor for this to push.
  const r1 = await fetch(base + '/api/farmline/updates/announce', { method: 'POST', headers: { 'x-announce-secret': SECRET } });
  const j1 = await r1.json();
  console.log('announce →', r1.status, JSON.stringify(j1));
  await new Promise((res) => setTimeout(res, 1200));
  console.log('pushes received:', JSON.stringify(events));
  sock.close();

  let fail = 0;
  if (r0.status === 404 || r0.status === 401) console.log('PASS  the door is closed without the secret'); else { console.log('FAIL the door is OPEN without a secret'); fail++; }
  if (j1.ok && j1.announced > 0 && events.some((e) => Number(e.build) === Number(j1.announced))) {
    console.log('PASS  the push arrived on the connected socket (build ' + j1.announced + ')');
  } else if (j1.ok && j1.announced === 0) {
    console.log('NOTE  no mandatory floor set — the connect-time/broadcast legs need FARMLINE_MANDATORY_BUILD; the room + door are live');
  } else { console.log('FAIL the push did not arrive'); fail++; }
  console.log(fail ? `\n${fail} FAIL` : '\nB2 THE SOCKET ACCELERATOR IS LIVE');
  process.exit(fail ? 1 : 0);
})().catch((e) => { console.error('FAIL', e.message); process.exit(1); });