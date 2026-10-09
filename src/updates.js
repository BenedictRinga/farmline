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

/** The LoopKeeper build-94 compose: 0.1.<serverBuild> from this repo's package.json. */
async function serverVersion() {
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