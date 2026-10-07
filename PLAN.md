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

**THE PAID-WALL RULING (founder, 2026-10-05):** the plan-ahead — what to
plant, when, on how much land; breeding decisions; plan-versus-actual —
belongs to the PAID ladder (the PLAN rung, Layer 5), NOT the free phase.
The free phase ends at SHARPEN ("what is working"); VERDICT ("can this pay
me?") and PLAN ("how do I get there?") are the wall. While unactivated, the
GATE to the paid rungs is VISIBLE on the Steps screen, lists what lies
beyond (the rungs' own what-you-get lines, bilingual), and is UNOPENABLE —
availability and teaser are essential; activation arrives with the paid
rounds. Half-baked is not delivered; withheld-but-shown is the design.

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
16 the photograph → 17 the buyer's-guide read surface → **18 the updates
service + photos in chat (deployed 2026-10-06, verified 12/12; the sibling
thread's review verdict: KEEP — one 66-line module + one public GET, no new
dependencies, no silent reload; the mandatory lever is OFF unless
FARMLINE_MANDATORY_BUILD is set; chat photos activate only from the UI) →
18b THE NGINX GUARANTEE (the canonical block + the idempotent ensure; the
sibling thread hardened ^~ conf-wide and installed it root-owned with
sudoers — the conf now self-heals on every deploy) → **19 THE FULL SHAMBA
LINE (the founder's "Go", 2026-10-06): the protocol library grown from 9
species to 36 — all 27 picker crops and 9 animal groups carry real,
bilingual care schedules (204 templates; annuals stage-only, perennials
interval-care with stage-anchored first harvests; sheep/rabbits/bees/fish
were HARD-BLOCKED by the species gate and are now unlocked; guessSpecies
fixed — sheep-before-goats, cow(?!pea); the live probe materialised an
avocado cycle at 7 steps and a sheep flock at 8 and reversed clean).**
**23 THE PER-ANIMAL STORY (the note's promise made true): GET
/farm/:id/animal/:animalId — the animal's identity is its own; the CARE and
the RECORDS belong to the group (materialise is group-level — the page says
so, never invented per-animal history); the money is what exists (her listed
price + the group's open care costs). The app: /farmer/animal/:id — the
inline panel's 'whole story' tap opens it; Edge 7/7 (Zawadi the probe ewe:
identity, 38 kg, the flock's 8 events, KES 330 upcoming, no raw keys). THE
NGINX GUARANTEE REPAIRED: the 18:03 deploy's nginx -t failure traced to the
INSTALLED package carrying an old UNQUOTED {16,} regex — the ensure now reads
the block from the repo checkout (reset to origin/main before 6.5 runs),
never from a stale installed copy.**
**24 THE TRACK ENTRY (app + server): POST /farm/:id/animals — the farmer
adds an individual to a group (name/tag/sex/birth/weight; only the name is
required), the always-present track button on every group card, the new chip
opens the story page. The note now FOLDS under a click (the founder's
ruling). Live-verified: the POST, the chip on the inventory, the fold's
tap-open-tap-close; the alert's physical tap-through lands with the
founder's phone review (headless cannot fill Ionic's nested-shadow inputs).**
**25/26 THE UPDATE TRUTH + THE FLAT HEADERS (the founder's 4-item report,
2026-10-07): the "up to date forever" illusion killed at its root — the
server's check compared ITS OWN package.json counter (19) against the APP's
stamp (24): "19 > 24" false forever. serverBuild() now reads the SERVED
BUNDLE's stamp (/var/www/farmline/build.json; the sibling checkout on the
dev machine; the env override FARMLINE_SERVED_BUNDLE) — live-probed:
client 1 → available, client 25 → up to date, client 19 → available. The
verify ladder gains the update-truth probes (build.json reachable, the
check's build EQUALS it, both no-store/no-cache). The Settings version line
carries the build. Headers FLAT app-wide (the MD ::after gradient dead, one
hairline border); the two farm captions' computed typography PROVEN
identical (22px/700/26.4px/-0.44px — the illusion was the surrounding row).**
**27 THE BRAND KIT IN (the founder’s farmline-brand/farmline-brand, 54 files,
2026-10-07): the new mark — a field line (the “line” in farmline) with a
sprout through it, the dominant leaf the hook of an f — replaces the generic
seedling everywhere: favicon.ico (16/32/48) + favicon.svg, icon-192/512,
BOTH maskables (192 + 512), apple-touch 180, og-1200x630, Safari mask-icon;
the manifest recoloured (theme Field #176B3A, background Paper #F3F1EA);
the in-HTML splash redraws the new mark (the field line draws, the stem
rises, the f-hook leaf unfolds, the young leaf in #8FBF55); ONE GREEN
EVERYWHERE — --fl-action and Ionic primary migrate to Field (the buttons
match the icon and the browser chrome). Edge 21/21 (every asset serves, the
head carries the README spec, the icon pixels are Field+cream+mist). The
ionic/ source set (icon 1024 full-bleed, adaptive fg/bg, splashes 2732 +
dark/light) waits for ROUND B’s capacitor-assets run. Harvest #E2B34A
respected as OG-rule-only.**
**28 CARRY THE WHOLE BRAND (the founder’s ruling, 2026-10-07: “I want
everything good — add everything we can carry now and use later if current
utility is unclear”): the kit’s full vocabulary lives as ready tokens
(--fl-field / field-deep / cream / young-leaf / leaf-mist / harvest /
brand-ink / paper) so no future surface re-invents a colour; the HARVEST
RULE — the kit’s OG-only gold — makes its first app appearance crowning the
What’s-new card (3px news rule; never in the icon); and the DEPLOY-SCRIPT
FIX the founder’s deploy log exposed: the Angular analytics (y/N) prompt can
hang a non-interactive deploy — NG_CLI_ANALYTICS=false + CI=true now prefix
the build in deploy.sh and cli.analytics=false lives in angular.json. The
“branch behind origin/main” note in the deploy log is the fetch-then-reset
sequence working as designed: the droplet’s branch pointer lags between
deploys; every deploy resets to origin/main (the pushed truth) and builds
it — HEAD is now at <tip> is the proof line.**
**29 ZERO PAINT AT THE BOUNDARY (the founder’s second flat-header ruling,
2026-10-07): the build-26 hairline still read as a shadow strip on her
phone — at fractional DPRs (2.75-4) a 1px logical border renders as a
blurry 3-4 physical-pixel band of 12% ink. The deep band probe (every
element in the top 130px) proved the hairline was the ONLY boundary paint;
it is now 0 — no gradient, no shadow, no line; separation comes from the
content’s own top margin. The only paint left in the band is the help
button’s own pill outline (a button, not the header).**
**22 THE VERSION NOTE (app): a letter to the first farmer, OPEN at the
render-top of Settings - her whole shamba now carries schedules (27 crops,
9 animal groups, four of them just unlocked), the season laid out on Today
with shilling estimates, the trees honest about year three, the milk hold
still guarding her name, and what comes next (the per-animal page, then the
Play Store). Bilingual; the investors on standby read it in their language.**
**App ladder**: … 11 SHARPEN → 12 the five wounds → 13 display lines
(repaired) → 14 the buyer's guide → 15/16 the sign-out confirm + the pickers
opened → 17 the stamp → **18 the updates surfacing + chat photos → next:
free-phase completion (ROUND A2) — the Settings page, the augmented guide
(About farmline first; the chat, Hatua and updates explained; Start in an
ion-footer) and the verify ladder's app-contract probes are tranche 5.**

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
- **THE PAID WALL + THE TEASER (first tranche — essential now, founder's
  word)**: the Steps screen becomes the gate. Each commercial rung is
  visible with its question, price and lock, and EXPANDS to list what lies
  beyond — the rung's own what-you-get lines, what it asks of you, and the
  commitment (the server's landing blocks already carry all of it,
  bilingual, at `/meta/ladder`). Expandable, never openable: no activation
  exists until the paid rounds. Every tap acknowledged; --fl-alert
  untouched; EN/SW at parity.
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
- **Harness portability**: the Edge path and OS become configuration, so the
  §1.13 gate can run wherever the founder works.
- **Moved OUT (the founder's ruling)**: crops-half planning is NOT free-phase
  work — it is the paid PLAN rung's substance (ROUND D below). The free
  inventory must still end "Not built in the free layers: NONE" — with the
  plan-ahead listed behind the wall, not missing.
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

### ROUND D — PLAN, the plan-ahead (the paid rung behind the wall)
The founder's ruling (2026-10-05): the completion of the planning half
belongs HERE, not to the free phase. Built behind the activated wall:
- **The season decision** — what to plant, when, on how much land: the plan
  built from the farm's OWN records (what each plot grew, what it yielded,
  what the work cost in days), stated with confidence bands — never hard
  verdicts on soft data.
- **Breeding decisions** — the animals' equivalent: which group to expand,
  which to hold, what the records say.
- **Plan-versus-actual** — the season as planned beside the season as it
  happened; every correction reversible like any record.
- The teaser lines listed at the gate (the PLAN rung's what-you-get at
  `/meta/ladder`) are the contract this round must deliver.
- **Gate**: activated on the founder's phone (on Round C's M-Pesa rails) ·
  the plan reads from real seeded records · AOT + harnesses + verifier ·
  founder review on a real screen.

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

- **The bare-path probe rollback** (2026-10-06): the emergency rollback to
  build 16 was decided from INVENTED probe paths (a bare /records that was
  never a route); build 18 carried every route plus additions, and the
  rollback itself created the real mismatch (app 18 vs server 16). RULE:
  before any rollback, verify the route table from the REPO — never from
  probe guesses. The app-contract probe list rides the verify ladder.

- **The conf owned by no one** (2026-10-06, cured): the shared nginx conf
  grew farmline blocks by hand-ship; every API/socket prefix in it was a
  plain location (any future regex could shadow a whole API). Applied:
  ^~ on EVERY API/socket prefix (zyppar, oauth, openloop, loopkeeper,
  rolodex, socket.io, farmline), the regex twin removed, and the ensure
  package installed ROOT-OWNED (/opt/farmline-nginx-guarantee) with the
  sudoers line — deploy step 6.5 self-heals the conf on every deploy.
