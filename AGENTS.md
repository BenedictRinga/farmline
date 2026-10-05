# AGENTS.md — farmline server (AI build instructions)

<!-- ═══════════════════════════════════════════════════════════════ -->
# ⚓ BINDING DEPLOY DOCTRINE — READ FIRST, DEFER TO IT (user directive 2026-10-05)

> The founder's order: every thread working on farmline READS this section
> before acting, and DESISTS from imposing its own divergent understanding.
> The architecture below is SETTLED, verified live, and recorded in git.

## THE ARCHITECTURE IS GIT-NATIVE — NO TARBALLS, EVER
- The droplet deploys by PULLING from GitHub. /opt/farmline-server and
  /opt/farmline-app are real git checkouts with origin set (SSH).
- A tarball copy over a checkout DELETES .git and breaks the deploy (the
  2026-10-05 episode: the new 7-step deploy.sh correctly refused "NO origin
  remote"). It was recovered once (git init + origin + fetch + reset --hard
  origin/main, .env preserved). DO NOT REPEAT IT: changes travel as commits →
  push → the droplet pulls. Never scp-overwrite a checkout.

## THE ONLY DEPLOY COMMANDS
- Backend:  sudo -u appuser bash -c 'cd /opt/farmline-server && ./deploy.sh'
- Frontend: sudo -u appuser bash -c 'cd /opt/farmline-app && git pull && yarn && yarn build:prod'
  then the atomic swap (build into www/, swap /var/www/farmline, keep .prev).
- NEVER AS ROOT: root's SSH key is not on GitHub (the fetch fails publickey)
  and root does not own the pm2 daemon. The identity is APPUSER
  (/home/appuser/.ssh/config holds the GitHub key; safe.directory exceptions
  are set for both).

## THE NGINX IS SETTLED (2026-10-05)
- The two asset-alias blocks are LIVE (QUOTED regexes — nginx eats unquoted
  {16,} braces: pcre2_compile fails). Missing hashed chunks return a REAL 404,
  never the shell (the ChunkLoadError storm guard). Hashed chunks carry
  immutable caching.
- The regex API block carries client_max_body_size 12M (it shadows the old
  prefix block — do not "restore" the prefix block's limits elsewhere).
- Backups exist: zyppar.com.bak-20261005-assetfix, .bak-20261005-farmline-fix.
- Any future nginx edit: backup → insert → nginx -t gate → reload;
  auto-restore on test failure. The assetfix script is the pattern
  (scripts/farmline-assetfix-20261005.py in the farmline repo).

## VERIFIED STATE AT THE TIME OF WRITING
- Backend: checkout @35979cd (build 16), deployed by deploy.sh itself,
  /api/farmline/health 200. Frontend: /opt/farmline-app pulled to 4c72aab,
  built, shipped; the served bundle is content-addressed (a src-identical
  delta keeps the same chunk name — that is CORRECT, not a stale build).
- /farmline/ 200; /api/farmline/health 200; missing-hash 404.

## HOW TO DISAGREE
- If you believe a piece of this is wrong: READ the git history of this file
  and the droplet state first (the verification commands are above). If you
  still disagree, PROPOSE in your reply with evidence — do not silently
  re-architecture, re-deploy by tarball, or re-edit nginx around the gates.
<!-- ═══════════════════════════════════════════════════════════════ -->


Mirrors the LoopKeeper (`rolodex-server`) conventions deliberately. Read this before changing anything.

> **THE PRODUCT FRAMEWORK LIVES IN THE OTHER REPO.**
> `D:\MacBook\noGoogle\farmline-app\AGENTS.md` §1 is the anchor: where the product came from (the
> three gaps a real farmer named in FarmKeep), who it is for, the prime directive, the definition of
> the first screen, the seven layers and their build order, the two faces, the trust architecture,
> voice, language and visual language.
>
> **Read that section before designing anything, in either repo.** It outranks this file. Nothing
> here should be built that is not traceable to §1.1 or §1.5 of it — and a screen is not done when a
> route returns 200 (§1.13).

## THE STACK — this repo is the API. The app is a separate repo.

**This process serves the API only.** It has no frontend, no static handler and no
`public/` directory. Until build 8 it also served one hand-written HTML file; the Angular
rewrite moved the frontend to **`farmline-app`** and removed it from here.

| | LoopKeeper | farmline |
|---|---|---|
| Frontend repo | `rolodex-app` (Angular, ionic, capacitor) | **`farmline-app`** — same Angular 18.1.0 / Ionic 8 / Capacitor 6 pins |
| Frontend build | `ng build` → hashed bundle | `yarn build:prod` → `www/`, aliased by nginx from `/var/www/farmline` |
| This repo | `rolodex-server` — API on :4411 | **API only** on :4600 |
| Backend deps | express, mongoose, socket.io, stripe | **express, mongoose, socket.io** (three, approved 2026-10-03 for chat) |

**Why the frontend is NOT in this repo, and must not come back.** Two frontends on one URL is
the failure mode: nginx would serve the Angular build at `/farmline/` in production, and a
direct `:4600` hit would serve whatever this process had — so `yarn dev` would show a different
app from production, and every bug report would depend on which one the reporter hit. `yarn
preflight` FAILS if `public/index.html` reappears here.

Consequence: `scheduled`, `projection`, `protocols`, `ladder`, `money`, `vocab` and `models`
are pure domain logic with no HTTP-framework coupling. Do not introduce frontend concerns
(templating, bundling, view shaping beyond `projection.js`) into this repo.

## Repo rules
- **YARN ONLY.** Never use npm here.
- The full gate before committing: `yarn release` (= `check` → `smoke`).
- Bump `package.json` `build` counter with every user-visible backend change. `/api/farmline/version`
  reports it, and the app compares it to its own build to detect a stale bundle.
- The server talks to its **own `farmline` Mongo database**. **Never touch the `zyppar` or `rolodex` databases.**
  `yarn preflight` fails the run if the URI points anywhere else.
- Plain CommonJS. No TypeScript, no build step, no bundler.
- **Dependencies stay at three** (express, mongoose, socket.io) after the founder's explicit approval
  of chat on 2026-10-03 (build 8). `socket.io-client` is a **devDependency** — it exists only so
  `test/chat-money.js` can prove real-time delivery. A fourth runtime dependency still needs approval.

## CHAT and MONEY — the two doors added in build 8

### Chat (`src/chat.js`, socket.io at `/socket-farmline/`)
Farmer ↔ buyer, one thread per (farm, customer) pair. **Not** LoopKeeper's demo room: that has no
auth and no persistence, and messages die with the tabs. Here every message is **persisted**, every
socket is **authenticated** with the same HMAC token as the REST API, and a participant can only
reach their own threads.

**REST is a peer, not a fallback.** Every message is postable and readable over REST as well as the
socket. Socket chat fails invisibly on a weak connection — the message simply never arrives — so a
phone that lost its socket must still be able to read and send.

The nginx path is **namespaced** (`/socket-farmline/`): Zyppar owns `/socket.io`, LoopKeeper owns
`/socket-rolodex/`, and a shared path would not fail loudly — it would deliver one product's events
to another. The socket block's `Upgrade`/`Connection` headers and long timeouts are load-bearing;
without them chat silently degrades to long-polling.

### M-Pesa (`src/mpesa.js`, called only from `src/money.js`)
Safaricom Daraja: OAuth (cached ~1h), STK push, callback parsing. **Zyppar gave us nothing to copy —
its payments are Stripe/PayPal in USD for topping up ZU, and a Kenyan farmer cannot buy ZU.**

THE RULE THIS FILE EXISTS TO KEEP: **farmline never custodies money.** The STK push pays the FARM's
own shortcode; farmline records the receipt. A farm may carry its own Daraja credentials, and that
is the model to prefer.

**An unarmed rail must never report success.** It returns `pending` with the reason. A fabricated
payment confirmation is the worst bug this codebase could ship — silent, and about somebody's income.
Only the Daraja **callback** settles a payment (`settleByCheckout`, matched on `CheckoutRequestID`).

`FARMLINE_PUBLIC_URL` must be the real public host: Daraja POSTs the result there, and a callback
pointed at localhost silently never arrives while the buyer's money is already gone.

## DEV — running the two halves locally

**Two processes now**, like LoopKeeper: the API here on **:4600**, and the Angular app in
`farmline-app` on **:4700**. The app proxies `/api` and `/socket-farmline` to :4600, so in a
browser everything is same-origin and there is no CORS to configure.

```bash
# terminal 1 — the API
yarn dev          # :4600, watches src/, prints where the app should be
yarn seed         # fills a farm so you are not debugging an empty one

# terminal 2 — the app
cd ../farmline-app && yarn start    # :4700, proxies to :4600, opens the browser
```

`yarn dev` will **not** open a browser at the API — there is no app here to open. If the app is
running it opens :4700; if it is not, it says so rather than opening a dead tab.


`yarn dev` runs `scripts/dev.cjs` — farmline's equivalent of `ng serve --open`. LoopKeeper got that
flag for free; here it had to be written. It starts the watcher, waits for `/health`, prints the
env/db/build, then opens `http://localhost:4600/farmline/`. `NO_OPEN=1 yarn dev` suppresses the
browser.

If a farmline server is **already** on the port, it says so and opens the browser at that one
instead of starting a second — a duplicate server silently answering with old code is the worst dev
failure there is, and it cost real time three times during this build.

`yarn serve` is the plain one (`node src/index.js`): no watch, no browser. Use it for scripts.

| | LoopKeeper | farmline |
|---|---|---|
| App dev server | `yarn start` in `rolodex-app` → :4400 | none — served by the server |
| API server | `yarn start` in `rolodex-server` → :4411 | `yarn dev` → :4600 |
| Dev API target | **the LIVE production API** (`environment.ts` → `zyppar.com/api/loopkeeper`) | **local** mongod, local `farmline` db |
| Cross-origin? | yes (4400 → 4411), hence the ACAO rule | no — same origin |

**farmline's dev is isolated; LoopKeeper's is not.** Running `rolodex-app` in dev writes to the
live LoopKeeper database. Running farmline in dev touches nothing outside your machine. This is
the reason to keep the single-process shape: **debugging can never damage a farmer's records.**

Ports are fixed: **4600 dev** (4200, 4400, 4411 are taken). `yarn smoke` uses **4699**, so it never
fights a dev server.

### Knowing which environment you are looking at

Dev and production serve the **same public path** (`/farmline/`), so the app says which one it is.
Any non-production server renders an amber badge in the bottom-left with the env, database and
build:

```
DEVELOPMENT · farmline · build 6
```

The badge is driven by `GET /api/farmline/version` → `{ env, isProduction, dbName, build }`. It
**cannot** appear on production: it only renders when `isProduction !== true`. `yarn seed` refuses
to run against a target that reports `isProduction: true`, so you cannot accidentally fill a live
farm with debug animals.

Set `ENV_NAME=staging` to label a staging box distinctly from `development`.

### What `yarn seed` gives you

A farm already a week into its life, created **through the real API** (so if seeding breaks, the
app is broken): 2 plots · 6 dairy cattle, 4 goats, 20 layers · 2 acres of maize planted 35 days
ago · 3 days of milk and egg records · milk at KES 60/litre and eggs at KES 450/tray · **a
withdrawal hold** (it completes a deworm deliberately — a tick spray carries no withdrawal and
would demonstrate nothing) · and a customer order waiting.

It prints the shop URL and the sign-in phone/PIN. Re-runnable; `SEED_PHONE` / `SEED_FARM` make
additional farms.

## The script suite — how this repo is automated

Modelled on LoopKeeper's chained `scripts/*.cjs` pipeline. farmline has no bundler, so `build`
produces a **stamp** rather than compiled output — that is the whole difference.

| Script | Does | Run when |
|---|---|---|
| `yarn preflight` | Is this machine able to run farmline? Fails loudly on an unset `AUTH_SECRET` on a prod host, a local-mongo URI on a droplet, a Mongo db name that is not `farmline`, a taken port, an external CDN in the shell. | Before starting, and on the droplet before deploying |
| `yarn check` | `node --check` over every source, script and test file | Every commit |
| `yarn smoke` | Boots a throwaway server on port **4699**, runs all three suites (integration, UI contract, chat+money), shuts it down. Refuses to run if 4699 is busy. | Every commit |
| `yarn test` | The integration suite alone, against `FARMLINE_TEST_BASE` (default `:4600`) | Debugging |
| `yarn verify [url]` | Verifies a **deployed** farmline over HTTPS: `/api/farmline/version` returns JSON (not the shell), deploy-drift, real-404 on a missing API path, shell not cached, the share deeplink, and that LoopKeeper is untouched. | After every deploy |
| `yarn release` | `check` → `build` → `smoke` | The gate |
| `./deploy.sh` | The droplet deploy | On the droplet |

**Why `smoke` uses its own port:** three times during the build, a stale server on 4600 answered with
OLD code and made a correct fix look broken. A script cannot forget to kill the previous process.

**Why the shell is never cached, in TWO places:** nginx pins `/farmline/index.html` to `no-cache`, and
`src/index.js` sets the same header itself. An app that depends on a proxy to keep it honest breaks the
moment the proxy is missing or drifts (staging, a direct `:4600` hit, a future ingress). The app states
its own rule.

**Why `/health` is namespaced:** farmline exposes `/api/farmline/health`, not `/health`. A root-level
path belongs to whoever serves zyppar.com; claiming one is ambiguous today and a collision tomorrow.
`/health` still answers for direct localhost use, which is what `deploy.sh` checks.

## The two standing product rules — these outrank feature requests

### 1. THE FOUNDATION IS FARMER-FIRST (founder, 2026-10-02)
> "Crucial that this is farmer first, from hobby all the way to fulltime commercial… But their
> farming is primary focus. They must feel it. If the foundation is unsound, so also the output."

This binds every decision in this repo:
- The farmer's **work** (today's tasks, treatments, crops, milk, eggs) is the product.
  Money is a **consequence** rendered in plain language, never the front door.
- **Never** make the farmer feel like they are filling in an accounting system.
  See `src/vocab.js` — the accountancy-free vocabulary — and use it for every user-facing string.
- The customer face is a **projection** of farm records. Never a second job for the farmer.
- If a feature makes the farmer work harder for the software's benefit, it is wrong.

### 2. MONEY HAS TWO MODES, ONE SHAPE
`virtual` (**ZU**, Zyppar Units — 1 ZU ≈ $0.01) and `mpesa` (real). The **only** place that knows
the difference is `src/money.js`. Every other module charges and settles through that interface.
- In `mpesa` mode farmline **never custodies money**: the payment goes to the **farm's own**
  Paybill/Till, and farmline records the reference. No float, no escrow, no e-money licence.
- The switch is per-farm, defaulting from env `MONEY_MODE`. Both must always work.

## Privacy & safety copy (inherited standing policy from LoopKeeper)
We do **NOT** give users assurances of safety or privacy in copy — no "safe", "secure",
"your data stays yours", "nobody can see this". State **facts about behaviour**, never reassurance
framings. This binds every server-generated string.

## Never-do list
- Do not add an aggregator marketplace (browse-all-farms, matching, ranking, arbitration).
- Do not add price discovery, bidding or haggling. **The farmer sets the price.**
- Do not let the customer face read operational collections (costs, treatments, animals, other
  customers' orders). It reads the projection in `src/projection.js` and nothing else.
- Do not introduce webfonts, external CDNs or analytics into the frontend. Rural 2G is the target.

## Deploy policy
The ONLY deploy sequence is this repo's own script: `./deploy.sh`
(fetch → reset --hard → pull → yarn → .env checks → pm2 restart farmline-server --update-env → pm2 save).
**Never** type a bare `git pull && pm2 restart farmline-server` — it skips yarn, the .env checks,
`--update-env` and `pm2 save`.

## Mounting
The app is served at **https://zyppar.com/farmline/** and the API at **/api/farmline/**.
nginx handles the path rewrite; Express is mount-agnostic (`BASE_PATH` env, default `/farmline`).
Local dev runs on **port 4600** (4200 and 4400 are taken by other projects).

## Wiring record — 2026-10-02 (live on the droplet)
| What | Where |
|---|---|
| Code | `/opt/farmline-server` — shipped as a tarball; this repo was not git-hosted at wiring time (push it, then deploy.sh's fetch flow takes over) |
| Process | pm2 under the **appuser** daemon: `farmline-server` (src/index.js, port 4600); `pm2 save` done |
| Droplet `.env` | AUTH_SECRET (64-hex, generated at wiring — never printed, never committed), `MONEY_MODE=virtual`, local mongod **`farmline`** db (enforced by name at connect; 14 collections live), MPESA_* deliberately blank — the rail reports itself unarmed |
| nginx | the blocks from `deploy/nginx-farmline-path.conf` inserted **before the generic `location /`** in the zyppar.com server block (backup `.bak-20261002-farmline`) |

**Verified live 2026-10-02**: `/farmline/` 200 · `/farmline/index.html` 200 with `Cache-Control: no-cache, must-revalidate` · `/farmline/s/<slug>` 200 (the distribution link) · `/api/farmline/version` → build 3 · a missing API path → a REAL 404 (the belt, not the shell) · LoopKeeper untouched (200).

## 🌐 DROPLET STATE (2026-10-05 — the git-native deploy is LIVE)

- /opt/farmline-server is now a GIT CLONE of git@github.com:BenedictRinga/farmline.git (HEAD 16b1deb) — the pre-git hand-copy moved aside to /opt/farmline-server.handcopy-20261005. ./deploy.sh (fetch → reset --hard → pull → yarn → env → pm2 restart --update-env → pm2 save) now works as designed, run as **appuser** (the SSH identity lives in /home/appuser/.ssh/config; root's key is NOT authorized on GitHub).
- The founder .env was preserved through the conversion: /root/farmline.env.bak-20261005 (also restored into the clone, 600/appuser).
- pm2 farmline-server (appuser daemon — the systemd-supervised one) runs src/index.js on :4600; health 200.
- nginx (sites-available/zyppar.com, backup .bak-20261005-farmline-fix): the OLD block (the whole /farmline/ path proxied to :4600) is REPLACED by the new architecture — the static bundle at /var/www/farmline/ (atomic swap, .prev rollback) + location ~ ^/api/farmline/ + location /socket-farmline/ proxy to :4600. Both live-verified 200.
- Frontend: /opt/farmline-app is the clone of farmline-app.git (HEAD 441b46e); yarn build:prod runs on the droplet (appuser nvm node v20.18.3); the bundle ships via the atomic swap. Rolling deploy: cd /opt/farmline-app && git pull && yarn && yarn build:prod, then the swap.
- GitHub pull auth from the droplet = appuser (sudo -u appuser git ...); both repos are SSH remotes.

## NGINX ASSET BLOCKS - the insertion FIXED (2026-10-05)

- The two asset-alias blocks (hashed-chunk immutable caching + the real-404-on-a-miss guard) are LIVE in sites-available/zyppar.com.
- The GLM thread failure: nginx QUOTES required around regex locations carrying the {16,} repetition - unquoted, the config parser eats the braces and PCRE gets a truncated pattern (pcre2_compile failed). The repo deploy/nginx-farmline-path.conf carries the quoted fix (1a9e0af).
- ALSO: the regex API block now carries client_max_body_size 12M - it SHADOWED the old prefix block 12M (regex beats prefix; uploads would have been capped at 1M).
- Verified: real chunk 200 + immutable header, missing-hash 404 (never the shell), shell 200, health 200. Backup: zyppar.com.bak-20261005-assetfix.
- The insertion script: scripts/farmline-assetfix-20261005.py (backup, insert, nginx -t gate, reload).
