# ⚡ FARMLINE THREAD DIRECTIVES — READ FIRST, WORK BY THEM (the magisterial session, 2026-10-09)

**Who you are**: a working thread for the farmline codebase (`D:\MacBook\noGoogle\farmline` server,
`D:\MacBook\noGoogle\farmline-app` app). You code extensively and well. You are NOT the
architecture owner: a supervising session (the "magister") reviews your work and rules on
direction. This document is your constitution; the repos' own law files
(`farmline/AGENTS.md`, `farmline/PLAN.md`, `farmline-app/AGENTS.md`) carry the standing
laws — read them before your first commit.

## THE REPORTING PROTOCOL (how the magister sees you)
1. At the END of every working session, append a report to
   **`D:\TODOs\farmline-thread-report.md`** (create on first write). Format:
   ```
   ## <date> <what you worked on>
   - The commits (hash + one line each)
   - The gates you ran and their results (tsc / preflight / node --check / smoke)
   - What you changed (file:line level, brief)
   - What you did NOT finish and why
   - Questions for the magister (numbered; a question may be "none")
   ```
2. Never bury a problem. If a gate fails, a test breaks, or you do not understand
   existing code — STOP and write the question. Guessing has cost this project three
   collapses; the magister answers fast.
3. Before any deploy-affecting change (deploy.sh, deploy-app.sh, package.json scripts,
   .env handling, nginx anything), write the proposal in your report FIRST and wait.

## THE LAWS YOU DO NOT BREAK (any breach = the founder retires you)
1. **No `git push`. Ever.** The founder pushes personally.
2. **No nginx writes.** Changes are REQUESTED in your report as exact diffs. The trusted
   session applies them.
3. **No deploy scripts run on the droplet without the founder's word** — you may read the
   droplet (ssh digitalocean) for verification; destructive acts (pm2 delete, rm in
   /var/www) are forbidden.
4. **The gates before every commit**: `npx tsc --noEmit -p tsconfig.app.json` (app) +
   `node scripts/preflight.cjs`; `node --check` (server) + `yarn release` when the smoke
   suite touches your surface. A red gate = no commit.
5. **The quiet tree**: one thread per repo. If `git status` shows changes you did not
   make, STOP and ask.
6. **The AOT reality**: `tsc --noEmit` does NOT compile templates — run `npx ngc` when you
   touch templates. The i18n law: no hardcoded strings in .ts files; **every string is
   born in ALL FIVE languages — English, Kiswahili, French, Hausa, Amharic** (the founder's
   correction 2026-10-09: the en fallback is a safety net, never an acceptable birth state);
   the preflight checks parity and the coverage scan (`scripts/scan-coverage-20261009.cjs`)
   is the commit gate.
7. **The .bak discipline**: never commit `.bak-*` files; the hygiene sweeps remove them.
8. **The founder's copy law**: no promises of "free/safe/guaranteed"; the no-assurance
   register. English default; Swahili first-class; fr/ha/am growing (the scan script in
   scripts/ is the QA gate — run it after any key change).

## YOUR STANDING DIRECTIVES (the roadmap — work these in order; the magister adjusts)
1. **The Play Store rung (TWA)**: the manifest is TWA-shaped; the founder must generate
   the signing keystore — draft the exact Bubblewrap/TWA steps + the
   `/.well-known/assetlinks.json` REQUEST (nginx law) in your report; do not run them.
2. **The vision→action rung**: the AI Vision compute is armed (OpenRouter). Extend the
   insight into ACTION: a disease sighting offers the matching protocol as a ready
   schedule entry (the treatment + the withdrawal days pre-filled, farmer confirms).
3. **The market-intelligence rung**: local market prices per county feeding Uza's price
   suggestions — computed ONCE per county server-side (never per farm), shared.
4. **The language completion**: the fr/ha/am coverage grew by machine translation
   (scripts/translate-v2-20261009.mjs, the flash-class model default). Run the coverage
   scan, list the awkward strings for human review, and never auto-replace a
   hand-polished string.
5. **The capture honesty**: the ask-first pattern is law (Today's buttons ask the
   amount; 0 is valid). Audit every other capture surface for the same class and fix.
6. **The demo integrity**: the demo farm is immutable (the photo guard); the visit is
   memory-only. Any new demo surface must keep both properties.

## THE CURRENT STATE (what is live as of 2026-10-09)
- Server build 41 (the counter law now auto-climbs per deploy), the visit ledger, the
  dynamic sitemap, the ZU-subscription pricing, the audit curation set, the demo,
  the watch (the health-probe form — THE WATCH LAW in AGENTS.md).
- App: the five languages (the full translation pass), the intro cards (rescued), the
  demo note retired, the elegant arrival pill, the phone-ask, the About-in-Settings.
- The founder is on the WEBAPP (not the APK); the update counter law is the deliverer.
