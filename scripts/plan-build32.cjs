// scripts/plan-build32.cjs — record builds 21/32 in the plan (both repos).
const fs = require('fs');
let s = fs.readFileSync('PLAN.md', 'utf8');
if (s.includes('31/32 ROUND B + THE PROFILE')) { console.log('  ok (already)'); process.exit(0); }
const marker = 'bb 1px @tertiary ink, shadow none, gradient dead.**';
if (!s.includes(marker)) { console.log('  ✗ marker miss'); process.exit(1); }
const add = marker + `
**31/32 ROUND B + THE PROFILE + THE TRUTHFUL VERSION (the founder's three
directives, 2026-10-07): (1) THE FARM'S PROFILE - Settings carries a Profile
section of its own (avatar, name, location); Edit opens the alert (name
required, area, story); the photo rides the proven downscale -> PATCH hand;
PATCH /farm/:id/profile validates and refuses junk/empty-name plainly
(server build 21); the founder is never stuck with 'Farmline' again.
(2) THE TRUTHFUL VERSION - the version composes 0.1.<build> everywhere
(the updates getter, build.json, the env stamp) and prepare-env.cjs stamps
environment.prod.ts BEFORE ng build - the old after-order landed the number
one build late; Settings reads v0.1.32, never a stale 0.1.3. (3) ROUND B -
capacitor.config + the Android platform + the brand kit's ionic/ set
generated 136 Android assets (mipmaps, adaptive fg/bg, light+dark splashes,
@capacitor/assets); the camera wired into the profile flow (native
camera/gallery on the shell via Camera.getPhoto, the web file picker
unchanged); farm.visionTier (none|advanced) is the AI-VISION entitlement
the advanced packages hang on (compute, count, label, identify, measure)
- set server-side only, surfaced as the locked Settings line with the
Harvest-gold Advanced chip. Live: the profile probe (rename, photo, junk
refused, /me persistence, revert) all green; the Settings probe (profile
renders, the alert pre-filled, the vision chip, the note fold intact).
THE APK BUILD is the one step needing the founder's Android SDK:
cd android && ./gradlew assembleDebug (or npx cap open android).**`;
s = s.replace(marker, add);
fs.writeFileSync('PLAN.md', s);
console.log('  plan updated');
