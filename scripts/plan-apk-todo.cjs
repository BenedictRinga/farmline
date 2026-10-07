// scripts/plan-apk-todo.cjs — the APK TODO into the plan (line-anchored).
const fs = require('fs');
let s = fs.readFileSync('PLAN.md', 'utf8');
if (s.includes('THE APK TODO')) { console.log('  ok (already)'); process.exit(0); }
const lines = s.split('\n');
const idx = lines.findIndex((l) => l.includes('./gradlew assembleDebug'));
if (idx === -1) { console.log('  ✗ marker line miss'); process.exit(1); }
const add = [
  '**THE APK TODO (the founder, 2026-10-07: "Access to the apk, pending or in',
  'addition to when we get on PlayStore, should be in the Settings"): (a) the',
  'Settings line is LIVE (Install on Android -> the honest pending alert; when',
  'the APK is signed and hosted, its link lands in that same alert). (b) THE',
  'BUILD+HOST: the founder is Android Studio-phobic - the agent steers the',
  'first signed build (keytool -> gradle assembleRelease), hosts the APK',
  'behind a stable URL, then wires the link into the alert. (c) The Play',
  'Store listing follows the same signed bundle.**',
];
lines.splice(idx + 1, 0, add.join('\n'));
fs.writeFileSync('PLAN.md', lines.join('\n'));
console.log('  APK TODO recorded');
