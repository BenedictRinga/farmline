// scripts/verify-live.cjs — verify a DEPLOYED farmline, over HTTPS.
//
// This is the runbook's verification block, as a script. Run it after every
// deploy; run it from anywhere.
//
//   yarn verify                                  # https://zyppar.com
//   yarn verify https://staging.example.com      # any target
//
// WHAT IT CATCHES THAT A HUMAN MISSES:
//   · the silent API failure — a missing /api/farmline/ path answered by the
//     generic `location /` with the frontend shell at HTTP 200. A 200 for a
//     failed call. This script fails on "JSON expected, HTML received".
//   · DEPLOY DRIFT — the live build number not matching the local package.json.
//     "Did the deploy actually take?" answered without SSH.
//   · the neighbour check — farmline must never break LoopKeeper on the way in.
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const BASE = (process.argv[2] || process.env.FARMLINE_BASE || 'https://zyppar.com').replace(/\/$/, '');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const LOCAL_BUILD = Number(pkg.build) || 0;

let fail = 0;
const ok = (m) => console.log('  PASS  ' + m);
const bad = (m) => { fail++; console.log('  FAIL  ' + m); };
const info = (m) => console.log('  info  ' + m);

async function get(url, opts = {}) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 15000);
  try {
    const r = await fetch(url, { signal: ctrl.signal, redirect: opts.redirect || 'follow' });
    return { status: r.status, headers: r.headers, body: await r.text() };
  } catch (e) {
    return { status: 0, headers: new Headers(), body: '', error: e.message };
  } finally { clearTimeout(t); }
}

(async () => {
  console.log(`\nfarmline verify-live  ${BASE}\n  local build ${LOCAL_BUILD}\n`);

  // ── 1. the API answers JSON, not the shell ─────────────────────────────────
  console.log('api');
  const ver = await get(`${BASE}/api/farmline/version`);
  if (ver.status !== 200) {
    bad(`/api/farmline/version → ${ver.status}${ver.error ? ' (' + ver.error + ')' : ''}`);
  } else {
    let j = null;
    try { j = JSON.parse(ver.body); } catch { /* not json */ }
    if (!j) {
      bad('/api/farmline/version returned HTML, not JSON — the API prefix is NOT proxied. '
        + 'The generic `location /` is answering with the app shell at HTTP 200 (a success status for a failed call).');
    } else {
      ok(`/api/farmline/version → JSON (version ${j.version}, build ${j.build})`);
      j.build === LOCAL_BUILD
        ? ok(`live build ${j.build} matches local build ${LOCAL_BUILD}`)
        : bad(`DEPLOY DRIFT — live build ${j.build}, local build ${LOCAL_BUILD}. The deploy did not take.`);
    }
  }

  // THE NAMESPACED health, not the root one. /health answers only for direct
  // localhost use (deploy.sh checks it there); on the shared host the root path
  // belongs to zyppar, so fetching it here compared farmline against zyppar's
  // shell — a guaranteed FAIL reported under farmline's own label.
  const health = await get(`${BASE}/api/farmline/health`);
  let hj = null;
  try { hj = JSON.parse(health.body); } catch { /* not json */ }
  if (hj?.ok) {
    ok(`/api/farmline/health → db=${hj.db} dbName=${hj.dbName} auth=${hj.authArmed ? 'ARMED' : 'OPEN'}`);
    if (hj.dbName !== 'farmline') bad(`the server is on database "${hj.dbName}", not "farmline"`);
    if (!hj.authArmed) bad('the write gate is OPEN on a public host (AUTH_SECRET unset)');
    if (hj.build && hj.build !== LOCAL_BUILD) bad(`health reports build ${hj.build}, local is ${LOCAL_BUILD}`);
  } else {
    bad(`/api/farmline/health → ${health.status} (expected JSON). Is the API proxied?`);
  }

  // ── 2. a missing API path must be a REAL 404, never the shell ──────────────
  const missing = await get(`${BASE}/api/farmline/this-route-does-not-exist`);
  if (missing.status === 404 && !/<html/i.test(missing.body)) {
    ok('a missing API path → a real 404 (the shell cannot masquerade as an API)');
  } else if (missing.status === 200 && /<html/i.test(missing.body)) {
    bad('a missing API path → HTTP 200 with the app shell. The belt is not working.');
  } else {
    info(`a missing API path → ${missing.status}`);
  }

  // ── 3. the app, which nginx serves as a STATIC build ──────────────────────
  // This section changed at build 9. Until then Node served the shell and this
  // checked a `<meta name="farmline-build">` stamp. Now the app is farmline-app's
  // Angular bundle, aliased from /var/www/farmline, so the checks are: the bundle
  // is there, it is an Angular app, and — the one that matters — the API is NOT
  // also serving a shell (two frontends on one URL).
  console.log('\napp (static build via nginx)');
  const shell = await get(`${BASE}/farmline/`);
  shell.status === 200 ? ok('/farmline/ → 200') : bad(`/farmline/ → ${shell.status}`);
  if (shell.status === 200) {
    /<app-root/i.test(shell.body)
      ? ok('the served shell is the Angular app (<app-root>)')
      : (/<html/i.test(shell.body)
        ? bad('the served shell is NOT the Angular build — is this still the old vanilla index.html?')
        : bad('the shell does not look like an app at all'));
    /farmline/i.test(shell.body) ? ok('the shell mentions farmline') : info('the shell does not mention farmline');
  }

  const idx = await get(`${BASE}/farmline/index.html`);
  const cc = idx.headers.get('cache-control') || '';
  /no-cache|no-store|must-revalidate/.test(cc)
    ? ok(`/farmline/index.html is not cached (cache-control: ${cc})`)
    : bad(`/farmline/index.html cache-control is "${cc || '(none)'}" — a returning farmer can get a stale shell`);

  // A missing ASSET must be a real 404, never the shell at HTTP 200. This is the
  // ChunkLoadError storm: a deleted chunk answered with HTML passes no MIME check.
  const missingAsset = await get(`${BASE}/farmline/this-chunk-does-not-exist.abc123.js`);
  if (missingAsset.status === 200 && /<html/i.test(missingAsset.body)) {
    bad('a missing asset → HTTP 200 with the shell. That is the ChunkLoadError storm.');
  } else if (missingAsset.status === 404) {
    ok('a missing asset → a real 404 (no shell masquerading as a chunk)');
  } else {
    info(`a missing asset → ${missingAsset.status}`);
  }

  // ── 4. the distribution link ──────────────────────────────────────────────
  console.log('\ndistribution');
  const deep = await get(`${BASE}/farmline/s/verify-probe-farm`);
  deep.status === 200
    ? ok('/farmline/s/<slug> → 200 (the farm share link resolves)')
    : bad(`/farmline/s/<slug> → ${deep.status} — THE DISTRIBUTION LINK IS BROKEN`);

  // ── 5. the neighbours must be untouched ───────────────────────────────────
  // Only meaningful on the SHARED host. Against a standalone local server there
  // are no neighbours, so the check is skipped rather than reported as a failure
  // — a verifier that cries wolf on localhost is a verifier nobody runs.
  const isSharedHost = !/^https?:\/\/(localhost|127\.0\.0\.1|\[::1\])/.test(BASE);
  console.log('\nneighbours');
  if (!isSharedHost) {
    info(`skipped — ${BASE} is a standalone server, there are no neighbours to check`);
  } else {
    const lk = await get(`${BASE}/api/loopkeeper/health`);
    lk.status === 200 ? ok('LoopKeeper API still responding (200)') : bad(`LoopKeeper API → ${lk.status} — DID FARMLINE BREAK IT?`);
    const lkp = await get(`${BASE}/loopkeeper/`);
    lkp.status === 200 ? ok('LoopKeeper app still serving (200)') : bad(`LoopKeeper app → ${lkp.status}`);
  }

  console.log(`\n${fail ? `VERIFY FAILED — ${fail} problem(s).` : 'VERIFY PASSED — the deployment is sound.'}\n`);
  process.exit(fail ? 1 : 0);
})();
