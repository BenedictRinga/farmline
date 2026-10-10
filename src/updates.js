// src/updates.js — THE UPDATES CHECK, VERBATIM LOOPKEEPER (2026-10-09, the
// founder: "No need for invention or fresh logic. LoopKeeper works. Just do it
// and stop tampering with it… Every aspect, backend behavior/setup, should just
// be cloned").
//
// THE ACTUAL LOOPKEEPER SHAPE (rolodex-server src/services/updates.service.js,
// the build-94 "version that ticks" law):
//   · the SERVER composes `0.1.<serverBuild>` from its own package.json build —
//     the counter law (deploy.sh, the shell form) climbs that build on every
//     deploy, so the advertised version ticks automatically;
//   · the CLIENT sends its STORED version (written only when an update is
//     APPLIED) — never the bundle's stamp — so a stale client reports its true
//     old version and is told the truth instantly, whatever the stamps do;
//   · the server answers { version, type }: invalid client → immediate; the
//     major moved → immediate; otherwise flexible.
// No version.txt, no mandatory floor in the check — the LoopKeeper composition
// exactly, farmline-prefixed.
const fs = require('fs');
const path = require('path');

const UPDATE_CHECK_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  'Pragma': 'no-cache',
  'Expires': '0',
};

function normalizeVersion(version) {
  if (!version) return undefined;
  const m = String(version).match(/\d+\.\d+\.\d+/);
  return m ? m[0] : undefined;
}

// THE SERVED-BUNDLE CLOCK (2026-10-10, the detach cure): the app and the
// server deploy INDEPENDENTLY, so the server's own package.json build is the
// WRONG clock — it froze at 97 while the served app moved 44→45→46, and every
// app deploy after the first successful update was invisible (the founder's
// "detaching after just one successful run"). The served bundle's
// build.json IS the update clock: resolution order = the env override →
// /var/www/farmline/build.json → the sibling checkout → this repo's
// package.json (the last resort on a dev machine).
async function serverVersion() {
  const candidates = [];
  if (process.env.FARMLINE_SERVED_BUNDLE) candidates.push(path.join(process.env.FARMLINE_SERVED_BUNDLE, 'build.json'));
  candidates.push('/var/www/farmline/build.json');
  candidates.push(path.resolve(process.cwd(), '..', 'farmline-app', 'www', 'build.json'));
  for (const p of candidates) {
    try {
      const stamp = JSON.parse(await fs.promises.readFile(p, 'utf8'));
      const n = Number(stamp.build);
      if (Number.isFinite(n) && n > 0) return `0.1.${n}`;
    } catch { /* the next candidate */ }
  }
  try {
    const pkg = JSON.parse(await fs.promises.readFile(path.resolve(process.cwd(), 'package.json'), 'utf8'));
    return `0.1.${Number(pkg.build) || 0}`;
  } catch { return '0.1.0'; }
}

/** The check, verbatim LoopKeeper: clientVersion is the client's STORED version. */
async function getUpdateStatus(clientVersion) {
  const current = await serverVersion();
  const normalizedClientVersion = normalizeVersion(clientVersion);
  const normalizedCurrentVersion = normalizeVersion(current);

  // Invalid client version -> force an update (LoopKeeper's rule).
  if (!normalizedClientVersion) {
    return {
      version: normalizedCurrentVersion || current,
      type: 'immediate',
      timestamp: new Date().toISOString(),
    };
  }

  const isMajorUpdate =
    normalizedClientVersion.split('.')[0] !== normalizedCurrentVersion?.split('.')[0];

  return {
    version: normalizedCurrentVersion || current,
    type: isMajorUpdate ? 'immediate' : 'flexible',
    timestamp: new Date().toISOString(),
  };
}

module.exports = { getUpdateStatus, UPDATE_CHECK_HEADERS };