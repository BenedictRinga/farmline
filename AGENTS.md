# AGENTS.md — farmline server (AI build instructions)

Mirrors the LoopKeeper (`rolodex-server`) conventions deliberately. Read this before changing anything.

## Repo rules
- **YARN ONLY.** Never use npm here.
- The full gate before committing: `yarn release` (= `check` → `build` → `smoke`).
- Bump `package.json` `build` counter with every user-visible backend change. `yarn build`
  stamps the new number into `public/index.html` — the app self-heals a stale cache from it.
- The server talks to its **own `farmline` Mongo database**. **Never touch the `zyppar` or `rolodex` databases.**
  `yarn preflight` fails the run if the URI points anywhere else.
- Plain CommonJS. No TypeScript, no build step, no bundler.
- **Dependencies stay at two** (express, mongoose). Anything else needs the founder's explicit approval.
  The frontend is a single static HTML file with zero dependencies — keep it that way.

## DEV — how the two faces are run locally

**farmline is ONE process, not two.** LoopKeeper splits the app (`rolodex-app`, `ng serve` on
:4400) from the server (`rolodex-server`, :4411), because it is an Angular build with a compile
step. farmline has no build step: the Node process serves `public/index.html` itself, so the app
and the API are the **same origin on the same port**. There is no second dev server to start and
no CORS to configure.

```bash
yarn dev          # :4600, nodemon-style watch on src/
                  # then open  http://localhost:4600/farmline/
yarn seed         # fills a farm so you are not debugging an empty one
```

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
| `yarn check` | `node --check` over every source and script file | Every commit |
| `yarn build` | Writes `public/build.json` + stamps `farmline-build`/`-version`/`-commit` meta into `public/index.html`. Idempotent. | Every commit that changes the shell |
| `yarn smoke` | Boots a throwaway server on port **4699**, runs the 67-check suite against it, shuts it down. Refuses to run if 4699 is busy. | Every commit |
| `yarn test` | The suite alone, against `FARMLINE_TEST_BASE` (default `:4600`) | Debugging |
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
