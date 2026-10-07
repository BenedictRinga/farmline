// fl-alert-debug.cjs — see the alert's real input structure.
const { spawn } = require('child_process');
const os = require('os'); const path = require('path'); const fs = require('fs');
const profile = path.join(os.tmpdir(), 'fl-aldbg-' + Date.now());
const browser = spawn(process.env.FL_EDGE || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ['--headless=new', '--disable-gpu', '--remote-debugging-port=9415', '--user-data-dir=' + profile, 'about:blank'], { stdio: 'ignore' });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let id = 0; const p = new Map();
(async () => {
  for (let i = 0; i < 60; i++) { try { const l = await fetch('http://127.0.0.1:9415/json/list').then((r) => r.json()); if (l.find((t) => t.type === 'page')) break; } catch { } await sleep(300); }
  const ws = new WebSocket(await (async () => { const l = await fetch('http://127.0.0.1:9415/json/list').then((r) => r.json()); return l.find((t) => t.type === 'page').webSocketDebuggerUrl; })());
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
    const walk = (root, d) => {
      let out = [];
      root.querySelectorAll('input, ion-input').forEach((el) => out.push(d + ':' + el.tagName + (el.type ? ':' + el.type : '') + (el.getAttribute('name') ? ':name=' + el.getAttribute('name') : '')));
      if (alert.shadowRoot && d === 0) out = out.concat(walk(alert.shadowRoot, 1));
      return out;
    };
    const inputs = walk(alert, 0);
    return JSON.stringify({ lightInputs: inputs.filter(x => x.startsWith('0:')).length, shadowInputs: inputs.filter(x => x.startsWith('1:')).length, all: inputs });
  })()`);
  console.log('ALERT INPUTS:', info);
  browser.kill(); process.exit(0);
})().catch((e) => { console.error('FAIL', e.message); browser.kill(); process.exit(1); });