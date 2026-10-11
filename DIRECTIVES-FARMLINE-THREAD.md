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

## THE ZU SESSION — THE MONEY DOCTRINE CLOSED (2026-10-11; full report in the thread report, the doctrine in `D:\TODOs\farmline-zu-doctrine-20261011.md`)

**The four rulings taken, in order:**
1. **Farmline never sits between a farmer and a buyer.** Money moves ONE WAY: the farmer pays US, claims it, we confirm. No rail, no provider in the money path.
2. **ZU ONLY** — "no local currency to Farmline direct, just ZU for paid rungs." Packs exist so the first paid rung is reachable in a SMALL step.
3. **The daily allowance is ported from Zyppar's `claimTopUp`** — but it ACCUMULATES here, deliberately, because ZU's only job is to open a rung: 8 ZU/day, 12 for a farm logging on 7+ distinct days (VERDICT in ~30 days, or $2.49 today). One per farm per day, locked by a unique index, and claimable even while the collection door is closed — otherwise no farmer has any route to ZU at all.
4. **The insight is PAID (5 ZU per answered vision call); the rung is NOT granted.** `grantProvisional` is DORMANT and uncalled — the carrot is one line away if the founder ever wants it, and `effectiveRung` already understands it.

**Laws newly in force:**
- **GATE ON SUCCESS, AND PRICE THE WORK.** The vision charge is checked before the call and taken only after the model ANSWERS; a 502 bills nothing. The demo is never charged.
- **READINESS MUST BE EARNED, NEVER BOUGHT.** The mid-season estimate's back-calculated records are BORN MARKED (`estimated: true`), and `farmFacts` counts only `estimated: false`. *The setup may be declared; the history must be earned.*
- **NOTHING IS A STORED OPINION.** `confidence` is DERIVED from real records (21 distinct days → medium, 30 → high). It was read by readiness and written by nobody — which is why the honest path to a paid rung was dead code, and why the shortcut looked like the only way in.
- **A PAID RUNG IS A PERIOD, RESOLVED ON READ** (`ladder.effectiveRung`): a lapsed period or an expired provisional falls to the free ceiling (2); a 60-day-stale farm PAUSES rather than bills; **the demo is exempt by construction** — money rules must name their exemptions.
- **THE ACCOUNTING LAW (the CommandCenter class): a missing number is NEVER rendered as 0.** `sources` reports `ok` / `unreachable` / `unreadable`. A zero must mean zero.
- **ONE KIND PER DOOR:** the shell beacon hard-codes `kind:'shell'`; a caller-supplied kind would let anyone edit the founder's funnel from outside.

**Closed by this session — do not re-open:**
- **A1, N1, N2**: not fixed — DELETED with the rail. `src/mpesa.js` is gone and the callback routes with it.
- **`access_log off`**: RETIRED. The last secret-bearing URL (`GET /zu/claims?key=`) is header-only now.
- **The rung expiry** (recorded, never enforced): closed by `effectiveRung`.
- **The "illusory" CommandCenter wire**: closed at the source (the diagnosis with its evidence is in the thread report).

**Still on the founder:** `FARMLINE_ZU_COLLECTION` in both `.env` files (the door is shut without it — the money path's last lock) · the deploy · the two nginx diffs (verbatim in the thread report; the CSP line needs a browser test, because the app's inline `style=` attributes make `'unsafe-inline'` load-bearing) · the **`visionTier` decision** (recommendation: grant at registration — the 5 ZU charge is the real gate now, and a tier on top makes the funnel impossible) · a native pass over the new `ha`/`am` money copy.

**Next thread round, in the founder's priority order:** the ladder screen's 402-with-a-pack, then the `payTo` editor + its shop display, then CommandCenter's card display.

**SUPERSEDES the state lines above where they differ:** the money is ZU-only, the virtual/mpesa mode is deleted, and the M-Pesa callback no longer exists.

## THE UPDATES FREEZE ZONE (2026-10-10, the founder: "it has once again stopped working — time to protect it with caveats")
- THE PAIR: farmline-app/src/app/core/updates.service.ts + farmline/src/updates.js. THE SHAPE: the verbatim LoopKeeper clone (the founder explicit order), with the SERVED-BUNDLE CLOCK (the server reads /var/www/farmline/build.json — the app and the server deploy independently; the server own counter is NOT the clock).
- THE LAW: DO NOT TOUCH either file without the founder explicit word. No refactor, no tidy-up, no "improvement", no renaming, no shared-helper extraction. The mechanism was broken and repaired three times; every alteration since has regressed it.
- EVERY SESSION: diff-audit both files at start and end; any change not in your commit history = report it immediately as a suspected foreign alteration, do not absorb it.
- THE COUNTER LAW (the version tick) is the only sanctioned neighbour: package.json build climbs per deploy; never hand-edit the stored-version flow.
