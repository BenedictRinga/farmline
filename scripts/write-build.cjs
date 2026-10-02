// scripts/write-build.cjs — the build stamp.
//
// This is farmline's equivalent of LoopKeeper's `scripts/write-build-json.js`.
// farmline has no bundler (the shell is one hand-written file), so there is
// nothing to compile — but there IS one thing a build must produce: a STAMP, so
// the app can tell whether the copy in a farmer's browser cache is the copy the
// server is actually running.
//
// It writes:
//   public/build.json                    { version, build, at, commit }
//   public/index.html  <meta name="farmline-build"    content="N">
//                      <meta name="farmline-version"  content="X">
//                      <meta name="farmline-commit"   content="abc1234">
//
// The shell reads farmline-build on boot; the server's /api/farmline/version
// reports its own build. If they differ the shell reloads itself once. That is
// the stale-cache guard — and it matters most in the exact case LoopKeeper lost
// five days to: a phone that becomes visible again after a gap and lazily uses
// what it already has.
//
// Idempotent: running it twice changes nothing the second time.
const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
const build = Number(pkg.build) || 0;
const version = String(pkg.version || '0.0.0');

let commit = '';
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: ROOT, stdio: ['ignore', 'pipe', 'ignore'] })
    .toString().trim();
} catch { /* not a git checkout — fine */ }

const at = new Date().toISOString();
const payload = { version, build, at, commit };
fs.writeFileSync(path.join(ROOT, 'public', 'build.json'), JSON.stringify(payload, null, 2) + '\n', 'utf8');

const shellPath = path.join(ROOT, 'public', 'index.html');
let html = fs.readFileSync(shellPath, 'utf8');
const before = html;

const setMeta = (name, content) => {
  const re = new RegExp(`<meta\\s+name="${name}"\\s+content="[^"]*"\\s*/?>`, 'i');
  const tag = `<meta name="${name}" content="${content}">`;
  html = re.test(html) ? html.replace(re, tag) : html.replace('</head>', `  ${tag}\n</head>`);
};

setMeta('farmline-build', build);
setMeta('farmline-version', version);
setMeta('farmline-commit', commit || 'dev');

if (html !== before) {
  fs.writeFileSync(shellPath, html, 'utf8');
  console.log(`  stamped public/index.html → build ${build} (v${version}${commit ? ' @' + commit : ''})`);
} else {
  console.log(`  public/index.html already at build ${build} — unchanged`);
}
console.log(`  wrote public/build.json → build ${build}${commit ? ' @' + commit : ''}`);
