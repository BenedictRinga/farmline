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
    const r = await fetch(url, {
      signal: ctrl.signal,
      redirect: opts.redirect || 'follow',
      // The app-contract probes need POST + a body (the auth-door check).
      method: opts.method || 'GET',
      body: opts.body,
      headers: opts.headers,
    });
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

  // ── 4b. THE APP CONTRACT (2026-10-06, the bare-path-probe lesson) ──────────
  // The ladder above probes SERVER-known routes; an app calling a renamed or
  // removed route would still pass while every farmer 404s. This section probes
  // THE PATHS THE APP ACTUALLY CALLS — the fixed list, asserted JSON-not-HTML —
  // so the app↔server contract is verified from BOTH directions at deploy time.
  // A 401/400 here is a PASS (the route exists and answers properly); a 404 or
  // an HTML body is the failure today's outage class looks like.
  console.log('\napp contract (the paths the app calls)');
  const contract = [
    { name: 'GET /updates/check (boot, visibility, 5-min poll)', path: '/api/farmline/updates/check?clientBuild=1', statuses: [200], jsonNeeds: ['isUpdateAvailable', 'mandatory', 'type'] },
    { name: 'GET /meta/ladder (the teaser blocks)', path: '/api/farmline/meta/ladder?lang=en', statuses: [200], jsonNeeds: ['foundation', 'commercial'] },
    { name: 'GET /farm/:id/inventory (auth shape)', path: '/api/farmline/farm/abc/inventory', statuses: [401], jsonNeeds: null },
    { name: 'POST /auth/farmer/login (the door answers)', path: '/api/farmline/auth/farmer/login', statuses: [400, 401], jsonNeeds: null, method: 'POST', body: '{}' },
  ];
  for (const c of contract) {
    const r = await get(`${BASE}${c.path}`, {
      method: c.method || 'GET',
      body: c.body,
      headers: c.body ? { 'Content-Type': 'application/json' } : undefined,
    });
    const isHtml = /<html/i.test(r.body);
    const statusOk = c.statuses.includes(r.status);
    const jsonOk = !c.jsonNeeds || (() => { try { const j = JSON.parse(r.body); return c.jsonNeeds.every((k) => k in j); } catch { return false; } })();
    if (statusOk && jsonOk && !isHtml) {
      ok(`${c.name} → ${r.status} JSON (the route exists and is proxied)`);
    } else {
      bad(`${c.name} → ${r.status}${isHtml ? ' HTML (the shell answered — the route is GONE or the proxy lost it)' : ''}${statusOk && !jsonOk ? ' (shape changed — the app may break)' : ''}`);
    }
  }

  // ── THE UPDATE TRUTH (2026-10-07: the check must read the SERVED BUNDLE, not
  // the server's own counter) ─────────────────────────────────────────────────
  // /farmline/build.json IS the served bundle's stamp (write-build.cjs at
  // deploy); the check's build must EQUAL it — if the check still reads the
  // server's package.json the answer lies forever (the founder's "up to date
  // forever" illusion). A cached build.json is the other lie: the header must
  // forbid caching, or a reload never sees the new stamp.
  console.log('\nthe update truth (the served bundle is the clock)');
  try {
    const stamp = await get(`${BASE}/farmline/build.json`);
    const sj = (() => { try { return JSON.parse(stamp.body); } catch { return null; } })();
    const cacheHeader = String((stamp.headers && stamp.headers.get ? stamp.headers.get('cache-control') : (stamp.headers || {})['cache-control']) || '');
    if (stamp.status === 200 && sj && Number(sj.build) > 0) {
      ok(`/farmline/build.json → build ${sj.build} (@${String(sj.commit || '').slice(0, 7)})`);
      const chk = await get(`${BASE}/api/farmline/updates/check?clientBuild=1`);
      const cj = (() => { try { return JSON.parse(chk.body); } catch { return null; } })();
      if (cj && Number(cj.build) === Number(sj.build)) {
        ok(`/updates/check answers the SERVED bundle's build (${cj.build}) — the truth`);
      } else if (cj) {
        bad(`/updates/check answers build ${cj.build}, the served bundle is ${sj.build} — the check is reading the WRONG clock (the "up to date forever" illusion)`);
      } else {
        bad('/updates/check did not answer JSON');
      }
      if (/no-store|no-cache|must-revalidate/i.test(cacheHeader)) {
        ok(`build.json forbids caching (${cacheHeader.slice(0, 40)}...)`);
      } else {
        bad(`build.json is CACHEABLE (${cacheHeader || 'no header'}) — a reload may never see the new stamp`);
      }
      const chkRes = await get(`${BASE}/api/farmline/updates/check?clientBuild=1`);
      const chkCache = String((chkRes.headers && chkRes.headers.get ? chkRes.headers.get('cache-control') : '') || '');
      if (/no-store|no-cache/i.test(chkCache)) {
        ok('the check answer itself is no-store (a cached answer is a lie)');
      } else {
        bad(`the check answer is CACHEABLE (${chkCache || 'no header'}) — the manual check can repeat a stale answer`);
      }
    } else {
      bad(`/farmline/build.json → ${stamp.status}${sj ? '' : ' (not JSON)'} — the update check has no served-bundle clock`);
    }
  } catch (e) {
    bad(`the update-truth probes threw: ${e.message}`);
  }

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
