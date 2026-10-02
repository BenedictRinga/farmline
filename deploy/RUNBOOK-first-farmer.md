# RUNBOOK — putting farmline live for the first farmer

Everything below is copy-paste. Nothing here is optional except where marked.

**Where we are** (mirrors LoopKeeper):

| Service | Directory | Port | Public path |
|---|---|---|---|
| Zyppar backend | `/opt/zyppar-server` | — | — |
| LoopKeeper backend | `/opt/rolodex-server` | 4411 | `/loopkeeper/` + `/api/loopkeeper/` |
| **farmline backend** | **`/opt/farmline-server`** | **4600** | **`/farmline/` + `/api/farmline/`** |

---

## 1. Put the code on the droplet

```bash
ssh root@<droplet>

# a free port — confirm before committing to 4600
ss -ltnp | grep -E ':(4200|4400|4411|4600)\b' || echo "4600 is free"

cd /opt
git clone <your-farmline-repo-url> farmline-server
cd /opt/farmline-server
yarn install
cp .env.example .env
```

## 2. Fill in .env (this is the only file you must hand-edit)

```bash
cd /opt/farmline-server

# AUTH_SECRET — without it the write gate FAILS OPEN and every farm write is
# unauthenticated. This is the one that matters.
echo "AUTH_SECRET=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")" >> .env

# The admin gate (roster-style). Unset = the door is sealed (403), never open.
echo "FARMLINE_ADMIN_KEY=$(node -e "console.log(require('crypto').randomBytes(16).toString('hex'))")" >> .env

# The droplet has no local mongod — point at the shared paid cluster.
# farmline gets its OWN database: `farmline`, never `zyppar` or `rolodex`.
sed -i 's/^FARMLINE_USE_LOCAL_MONGO=.*/FARMLINE_USE_LOCAL_MONGO=false/' .env
```

Then confirm the Mongo URI is present — `deploy.sh` copies `MONGO_DB_URI_PAID` from
`/opt/zyppar-server/.env` automatically, but check it landed:

```bash
grep -E '^(MONGO_DB_URI_PAID|MONGO_DB_URI_FARMLINE)=' .env | cut -c1-60
```

**Leave `MONEY_MODE=virtual`.** The first farmer runs in ZU. Their customers can
order and the farm can get "paid" before a single real shilling moves — which is
exactly how a hobby farmer should meet the commercial side. `MPESA_*` stays blank
until they're ready, and the rail honestly reports itself unarmed rather than
faking a success.

## 3. Start it

```bash
cd /opt/farmline-server
chmod +x deploy.sh
./deploy.sh
```

Expect `✓ server is up on :4600`. If it fails: `pm2 logs farmline-server`.

## 4. Apply the nginx inserts

Copy the blocks from **`deploy/nginx-farmline-path.conf`** into the existing
`server { server_name zyppar.com; }` block — **before** the generic
`location / { try_files ...; }`.

```bash
sudo nano /etc/nginx/sites-available/zyppar     # or wherever zyppar.com lives
sudo nginx -t
sudo systemctl reload nginx
```

Three things that will bite if skipped:
- **`/api/farmline/` must be proxied.** If it is not, the generic `location /`
  answers the missing API path with the frontend shell at **HTTP 200** — a
  success status for a failed call. LoopKeeper lost time to exactly this.
- **`client_max_body_size 12M`** on the API block (Photo Kit images ride as JSON;
  Node accepts 4 MB, so the door must be wider or nginx 413s first).
- **`/farmline/index.html` pinned to `no-cache`** so a returning farmer never gets
  a stale shell pointing at a mismatched API.

## 5. Verify — all five, from the droplet

```bash
curl -s https://zyppar.com/api/farmline/version          # -> JSON, NOT html
curl -s https://zyppar.com/health | head -c 200          # -> "dbName":"farmline"
curl -sI https://zyppar.com/farmline/ | head -1          # -> HTTP/2 200
curl -sI https://zyppar.com/farmline/index.html | grep -i cache-control
curl -s -o /dev/null -w '%{http_code}\n' https://zyppar.com/farmline/s/test   # -> 200

# AND the neighbours still work — never break the other tenants
curl -s https://zyppar.com/api/loopkeeper/health
curl -sI https://zyppar.com/loopkeeper/ | head -1
```

Rollback is two comments and a reload. The Node process is untouched.

---

## 6. The first farmer — 10 minutes, on their phone

**Register them** at `https://zyppar.com/farmline/`:
their phone number, a PIN, the farm name.

**Then walk them through Rung 0 in this order** (this is the whole test):

1. **Add a plot** — name and acres.
2. **Add their animals** — tap 🐄 / 🐐 / 🐔. *Watch their face here:* the schedule
   appears by itself. 6 dairy cows → 11 events. They configured nothing.
3. **Add a crop** — maize, and set the planting date.
4. **Show them LEO (today).** The work list, and the **baseline bucket**:
   *"when did you last spray / deworm?"* — a question, not a command.
5. **Complete one deworming.** Milk goes on hold and the reason appears.
6. **Switch to Dukani.** Their own shop. The milk is **⛔ not available**, with
   the date it clears. Their eggs are.
7. **Copy the shop link** (*Kiungo cha duka langu*) and send it to one real customer.
8. **That customer orders on their own phone** — no install, no account needed to look.

## 7. What you are actually measuring

Not sign-ups. Two things, and write them down:

- **Does the farmer open farmline tomorrow morning without being reminded?**
  That is the only adoption metric that matters. The Today view has to tell them
  something they'd have forgotten.
- **Can a customer who has never met the farmer order in under 60 seconds?**

If both hold, the foundation is sound and everything above it is winnable.
If the Today view is boring on day two, no amount of the commercial ladder will
save it — and that is worth knowing in week one, not month six.

## 8. What is deliberately NOT switched on

- **M-Pesa.** ZU only. Real money is a later, deliberate step.
- **Rungs 3–6** (VERDICT, PLAN, OPERATE, COMMERCE) are visible on the ladder and
  priced, but the rung mechanics behind them are not built. The farmer can *see*
  where this goes; that is the point.
- **No aggregator marketplace.** Each farm has its own shop and its own link.
