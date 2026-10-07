// scripts/fl-alert-debug3.cjs — recursive shadow walk: where are the inputs?
const { spawn } = require('child_process');
const os = require('os'); const path = require('path'); const fs = require('fs');
const profile = path.join(os.tmpdir(), 'fl-aldbg3-' + Date.now());
const browser = spawn(process.env.FL_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', '--disable-gpu', '--remote-debugging-port=9417', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let id = 0; const p = new Map();
(async () => {
  for (let i = 0; i < 60; i++) { try { const l = await fetch('http://127.0.0.1:9417/json/list').then((r) => r.json()); if (l.find((t) => t.type === 'page')) break; } catch { } await sleep(300); }
  const ws = new WebSocket(await (async () => { const l = await fetch('http://127.0.0.1:9417/json/list').then((r) => r.json()); return l.find((t) => t.type === 'page').webSocketDebuggerUrl; })());
  ws.onmessage = (m) => { const d = JSON.parse(m.data); if (d.id && p.has(d.id)) { p.get(d.id)(d); p.delete(d.id); } };
  await new Promise((r) => { ws.onopen = r; });
  const send = (me, pa) => new Promise((res) => { const i = ++id; p.set(i, res); ws.send(JSON.stringify({ id: i, method: me, params: pa })); });
  const ev = (e) => send('Runtime.evaluate', { expression: e, returnByValue: true, awaitPromise: true }).then((r) => r.result?.result?.value);
  const token = fs.readFileSync('C:/Users/mTrustQ Kenya No1/AppData/Local/Temp/fl-token.txt', 'utf8').trim();
  await send('Page.enable', {});
  await send('Page.addScriptToEvaluateOnNewDocument', { source: `localStorage.setItem('CapacitorStorage.fl.token.farmer', ${JSON.stringify(token)});` });
  await send('Page.navigate', { url: 'http://localhost:4700/farmer/farm' });
  await sleep(9500);
  await ev(`(() => { const b = Array.from(document.querySelectorAll('page-farm .track-btn')); return b.length ? (b[0].click(), 'ok') : 'none'; })()`);
  await sleep(1000);
  const info = await ev(`(() => {
    const alert = document.querySelector('ion-alert');
    if (!alert) return 'NO ALERT';
    const found = [];
    const walk = (root, depth) => {
      if (depth > 6) return;
      root.querySelectorAll('input, ion-input').forEach((el) => found.push(depth + ':' + el.tagName.toLowerCase()));
      root.querySelectorAll('*').forEach((el) => { if (el.shadowRoot) walk(el.shadowRoot, depth + 1); });
    };
    walk(alert, 0);
    walk(document, 0);
    return JSON.stringify(found);
  })()`);
  console.log('INPUT NODES (depth:tag):', info);
  browser.kill(); process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); browser.kill(); process.exit(1); });