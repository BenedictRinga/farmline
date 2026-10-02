# AGENTS.md — farmline server (AI build instructions)

Mirrors the LoopKeeper (`rolodex-server`) conventions deliberately. Read this before changing anything.

## Repo rules
- **YARN ONLY.** Never use npm here.
- Before committing: `yarn check` (runs `node --check src/index.js`).
- Bump `package.json` `build` counter with every user-visible backend change.
- The server talks to its **own `farmline` Mongo database**. **Never touch the `zyppar` or `rolodex` databases.**
- Plain CommonJS. No TypeScript, no build step, no bundler.
- **Dependencies stay at two** (express, mongoose). Anything else needs the founder's explicit approval.
  The frontend is a single static HTML file with zero dependencies — keep it that way.

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
