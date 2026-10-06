// src/updates.js — THE UPDATES CHECK (build 18).
//
// CLONED from LoopKeeper's ZYPPAR-STYLE update service (rolodex-server
// src/services/updates.service.js + controllers/updates.controller.js), adapted
// to farmline's ONE truth: the build counter. LoopKeeper composes 0.3.<build>
// from package.json and compares version strings; farmline's app already stamps
// its build into the bundle (write-build.cjs) and guards on it at boot, so the
// check compares BUILDS directly — no normalization needed, no version.txt
// (that file was LoopKeeper's stale past, and it is not imported here).
//
// THE SHAPE THE APP READS:
//   GET /api/farmline/updates/check?clientBuild=17
//     → { version, build, isUpdateAvailable, mandatory, type, at }
//   · isUpdateAvailable — the server build has moved past the client's.
//   · mandatory         — the founder's beta lever: env FARMLINE_MANDATORY_BUILD
//                         sets a floor; any client below it MUST update.
//   · type              — 'immediate' when mandatory, 'flexible' otherwise
//                         (the LoopKeeper split, carried over).
//
// THE BETA FORCE LAW (founder, 2026-10-06): the app never SILENTLY reloads on
// this answer — it shows the "Important Update" surface and the user taps.
// A thrown update that looked like nothing happened is the regression this
// shape exists to prevent (the zyppar lesson, carried in the AGENTS doctrine).
const fs = require('fs');
const path = require('path');
const config = require('./config');

const UPDATE_CHECK_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate, private',
  'Pragma': 'no-cache',
  'Expires': '0',
};

function serverBuild() {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8'));
    return Number(pkg.build) || 0;
  } catch { return 0; }
}

function mandatoryFloor() {
  const n = Number(process.env.FARMLINE_MANDATORY_BUILD);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

/** The check, as the controller serves it. clientBuild is the app's own stamp. */
function getUpdateStatus(clientBuild) {
  const build = serverBuild();
  const floor = mandatoryFloor();
  const cb = Number(clientBuild);
  const client = Number.isFinite(cb) && cb > 0 ? cb : null;
  const isUpdateAvailable = client === null ? true : build > client;
  const mandatory = client === null ? true : client < floor;
  return {
    version: '0.1.' + build,
    build,
    isUpdateAvailable,
    mandatory,
    mandatoryBuild: floor,
    type: mandatory ? 'immediate' : 'flexible',
    env: config.envName,
    at: new Date().toISOString(),
  };
}

module.exports = { getUpdateStatus, UPDATE_CHECK_HEADERS, serverBuild, mandatoryFloor };
