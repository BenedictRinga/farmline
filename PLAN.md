# FARMLINE — THE PLAN (canonical · 2026-10-05 · written for the successor thread)

> **The founder's order**: this plan replaces the retired thread's invented
> sequences. Work ONLY the rounds below, in order. A round is DONE only when
> its verification gate passes. Anything not in this plan is a PROPOSAL —
> reply with evidence; never code it. The doctrine in AGENTS.md binds
> everything here (git-native deploys, appuser identity, the nginx gates).

## 1. THE PRODUCT (what we are building — the spine)
Farmline is the farmer's records app: the farm's story — herds, plots, crops,
orders — recorded, readable, correctable and reversible in situ, and TRUSTED
by a buyer (the farm's photograph is the trust mechanism). Language: Shamba
(home), Leo (today), Records, Uza (market), Oda (orders), Ujumbe (messages),
the shop + checkout. Two languages: English default, Swahili carried (i18n).
The destination: **VERDICT — the first paid rung** (M-Pesa rails are already
in the server .env). Delivery to FIRST FARMERS is the measure of every round.

## 2. THE SETTLED STATE (live and verified — do not re-litigate)
- **Server build 16** live on the droplet (`/opt/farmline-server`, git-native,
  pm2 `farmline-server` :4600): the photograph persisted (the farm's face),
  Layer 2 records readable/correctable/reversible, the ONE reversal pattern
  (`src/reversal.js` — uniform across every holding), auth ARMED.
- **App build 13 (repaired 94851f5)** live at `zyppar.com/farmline/`
  (`/var/www/farmline`, atomic swaps, `.prev` rollback): breathing margins
  (build 10), help everywhere + English default (build 10), Layer 3 SHARPEN
  on the screen (build 11), the founder's five wounds (build 12: persistence,
  margins, the photo, the splash, soft numbers), the display lines (build 13,
  brace-repaired), the doctrine (e6b079c).
- **Infra settled**: nginx asset blocks (immutable hashed chunks, the real-404
  storm guard, 12M uploads), git-native deploys as **appuser**, health 200,
  the verifier 12/12.
- **Verified not by claims but by**: `/api/farmline/health` 200 · the verifier
  suite · the app harnesses (`click.cjs`, `tabs/records/splash` flows) · a
  full `yarn build:prod` (AOT) · the founder's phone.

## 3. THE LADDERS (the recorded sequence)
**Server ladder** (commit title: `build N: <one line>`): … 14 Layer 2 records →
16 the photograph → 17 the buyer's-guide read surface → (18: the stale-connection
cure — **PROPOSED, NOT SCHEDULED**: it exists only on the retired thread's tree;
the founder reviews it separately. Do not pull, do not reimplement without
approval.)
**App ladder**: … 11 SHARPEN → 12 the five wounds → 13 display lines
(repaired) → 14 the buyer's guide → **next: free-phase completion (ROUND A2)**.

## 4. THE ROUNDS (in order — one at a time, gates before push)

### ROUND A — the buyer's guide (app + a sliver of server)
The trust layer for the BUYER looking at a farm: what a buyer sees when they
open a farm's page — the photograph first, the readable records second, the
contact path third. Rides the buyer section that already exists.
- App: the buyer's-guide view on the farm page (the photo, the readable
  record summary, the ask-to-buy path). The founder's phone review of the
  layout BEFORE the round closes.
- Server: only what the buyer view needs (a read endpoint's permission
  surface — nothing new unless the guide demands it).
- **Gate**: full `yarn build:prod` (AOT) · harnesses green · the founder
  reviews the live page · health 200 · then push/deploy per the doctrine.
- **STATE 2026-10-05: BUILT AND DEPLOYED (server build 17, app build 14,
  verifier 12/12). The only open item is the founder's phone review.**

### ROUND A2 — free-phase completion (the founder's law, 2026-10-05)
> **"At the very least there should be none in the free phase. Why deliver
> half-baked."** No farmline screen is presented — to the founder's circle,
> a buyer, or a farmer — while ANY gap below stands. This round closes every
> inventoried free-phase gap before anything else proceeds.
- **Language integrity batch** (free customer face):
  1. The shop fetch carries the app's language (`?lang=`) and REFETCHES on
     toggle — farm-authored labels (shelf + the readable-records lines) must
     follow the switch like every other word.
  2. `checkout.page.ts`: the two hardcoded Swahili payment notes go through
     the translate pipe (§1.10 — a string built in TS is a bug that survives
     the language switch).
  3. The preflight scanner stops flagging HTML-comment prose (the 4 false
     positives), so the real i18n gate stays loud.
- **Order cold-reload**: `/order/:id` fetches the buyer's own order from the
  EXISTING public GET (`/shop/:slug/order/:id`, server build 15) on deep
  link — no more empty state on refresh; the in-memory handoff stays the
  fast path.
- **Leo wording**: `in 0 d` reads as **"Due today"** (`shamba.dueToday`
  exists; the shape just never uses it).
- **Per-animal detail screen** (Layer 1 depth): a tracked animal's chip opens
  its story — identity, status, records, next due. Animals as things they
  manage, not rows.
- **Crops-half planning** (Layer 1 depth): planting/season planning on the
  plot — a crop cycle's story and its next actions, equal to the animals'.
- **Harness portability**: the Edge path and OS become configuration, so the
  §1.13 gate can run wherever the founder works.
- **Gate**: full `yarn build:prod` (AOT) per tranche · harnesses green ·
  every closed item re-verified on the founder's phone · AGENTS.md §2 ends
  the round with **"Not built in the free layers: NONE."**

### ROUND B — Capacitor init (app)
The farmer's phone: wrap the app for Android so the photo capture is native
and the install is one link.
- Capacitor init, the Android platform, the camera plugin wired to the
  EXISTING `fl-photo-input` flow (the web flow keeps working — the native
  camera is an upgrade, not a replacement), icons + splash from the brand.
- Server: untouched.
- **Gate**: the Android build installs on the founder's phone; the photo
  capture works on-device; the web flow unchanged; health 200.

### ROUND B2 — the updates service (server + app; scheduled at the founder's word)
> The founder, 2026-10-05: users get notifications, and in the beta phase we
> can FORCE some updates. Today only the passive half exists: the boot guard
> (`/version` build vs the bundle's own stamped build → reload once) means a
> fresh open always lands the new code. Nothing reaches a user while the app
> is OPEN, and nothing can force an update. This round builds the active half.
- **Server** (small; no new dependency, no nginx change):
  1. `.env` gains `UPDATES_LATEST_BUILD` + `UPDATES_MANDATORY_BUILD`
     (founder-edited, ops-consistent with the existing .env discipline);
     `/api/farmline/version` carries both beside `build`.
  2. One PUBLIC broadcast room on the EXISTING namespaced chat socket
     (`updates`); when the mandatory floor moves, the server emits
     `update:mandatory {build}`. The socket is the accelerator — a client
     that missed the broadcast learns the truth from `/version` on next boot.
- **App**:
  3. The EXISTING boot guard (`guardStaleBundle`) grows the mandatory leg:
     `mandatoryBuild > myBuild` → the **"Important Update" splash** (the
     founder's zyppar wording law — Important, never Mandatory) with ONE
     action, "Update now" → reload once; loop-safe via the healed flag that
     already exists, keyed by build.
  4. The socket listener shows the same splash mid-session. Beta "force" is
     a BLOCKING HONEST SCREEN, never a silent reload loop — the thrown
     update that looked like nothing happened is the regression this shape
     exists to prevent.
  5. The splash is the recovery surface for a stale tab's dead lazy-chunk
     (an open tab across a deploy): a failed route load routes to the same
     update surface instead of a dead nav.
- **The APK leg (designed here, because Round B precedes it)**: an installed
  APK serves its own bundled copy — a web reload cannot deliver updates to
  it. B2 decides the mechanism (repackage-and-reinstall flow vs a live
  download lane) and documents it in AGENTS.md before Round C.
- **Gate**: the founder's phone shows the splash when the floor is raised ·
  web force end-to-end · verifier + harnesses green · the APK decision
  recorded.

### ROUND C — VERDICT (the first paid rung; server + app)
The founder decides the shape of the first paid feature in conversation —
the scaffold this plan guarantees: the M-Pesa rails in `.env`, the ledger
pattern from the records work, and the reversal discipline apply to money
too (a payment is correctable/reversible like any record).
- **Gate**: one real paid rung end-to-end on the founder's phone (STaging
  push first), the records ledger carries it, the verifier + harnesses green.

### AFTER VERDICT — first farmers
The distribution round: the install link to the first farmers, the founder's
phone-test loop, the recorded feedback → the next ladder (planned THEN, not
invented now).

## 5. THE WORKING RULES (the gates that keep the thread honest)
1. **Read first**: AGENTS.md (the doctrine) + this PLAN before any work.
   The droplet state is verifiable — verify, don't assume.
2. **One round at a time.** The round's name comes from THIS file. If you find
   yourself writing a round name that isn't here, you are off-plan — stop and
   propose.
3. **The AOT gate**: every template/style-touching build passes a FULL
   `yarn build:prod` before push. `tsc --noEmit` alone has already shipped
   one broken build (the single-brace NG5002 — repair 94851f5). The harnesses
   (`click.cjs`, tabs/records/splash flows) run after the AOT gate.
4. **Build-number discipline**: bump `package.json`'s build counter with each
   build round; commit title `build N: <one line>`; the stamp must show the
   CURRENT sha (a stamp showing an old sha means the tree didn't move — find
   out why before shipping).
5. **The founder's review gate**: anything user-visible is reviewed on the
   founder's phone before the round closes. No coding sprees past a gate.
6. **Deploys only per the doctrine** (appuser, the doctrine's commands, the
   atomic swap). Never scp/tarball a checkout; never hand-edit the droplet's
   tree; never edit nginx outside the backup → insert → `nginx -t` → reload
   gate.
7. **Propose, don't impose**: ideas beyond this plan are a reply paragraph
   with evidence, waiting for the founder's word.
8. **THE FREE-PHASE LAW (founder, 2026-10-05): no presentation with free-phase
   gaps.** The free layers (FARM, RECORD, SHARPEN) and the free customer face
   are COMPLETE — every §2 rough edge and free-layer gap scheduled and closed —
   before anything is presented to a buyer or a farmer. Half-baked is not
   delivered. ROUND A2 exists because of this law and runs BEFORE Round B.

## 6. THE REGRESSION LEDGER (what already went wrong — the gates exist because of these)
- **The single-brace build** (build 13 pushed uncompiled): the AOT gate (rule 3).
- **The tarball copy** (deleted .git, broke the deploy): rule 6 + the doctrine.
- **The stuck tree** (the app served build 9 for hours while the remote was
  three builds ahead): verify the droplet HEAD before AND after every deploy
  (`git -C /opt/farmline-app log --oneline -1`).
- **The stale incremental build** (a 6.7s build shipped old chunks): when in
  doubt `rm -rf .angular` — a full build is 40-70s; the gates (rule 3's
  photo/margins greps) run on the BUILT output, never on trust.
- **The stale-checkout ship** (build 13 shipped TWICE while build 14 sat on
  origin — 2026-10-05): the app deploy.sh had no pull step; it rebuilt the
  checked-out tree and reported success. Fixed: the script fetches and
  resets to origin/main before building. Trust no step the script does not
  perform itself.
- **The free-phase gaps that survived to deployment** (2026-10-05): the
  founder read the outstanding list and ruled — no more. Rule 8 + ROUND A2
  are the structural cure: gaps are scheduled rounds, never a living list
  the next thread can skip.
