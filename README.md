# farmline — the API

A trust-first farm management product for East Africa's side-hustle
professional class: a farmer's daily work companion for **animals and crops
alike**, with schedules that log treatments, records a non-accountant can
read, and a withdrawal-integrity signal that protects buyers.

The farmer's **work is the product**; money is a consequence. Built in layer
order, each layer working and seen before the next:

| Layer | Question | Status |
|-------|----------|--------|
| 1 · HAVE | What do I have? (animals, plots, crops) | shipped |
| 2 · RECORD | What did I do, and what happened? (records — correctable and reversible in situ) | shipped |
| 3 · TRADE | Selling, orders, payments | next |

See `AGENTS.md` for the product doctrine and hard-won engineering laws
(vocabulary law, reversibility law, §1.13 verification).

## Stack

Node (CommonJS, no framework lock-in beyond Express) · MongoDB (Mongoose) ·
socket.io for chat · M-Pesa (Daraja) with a virtual-money practice mode ·
Jest-free plain integration suites (`test/`).

## Run it

```bash
yarn install
cp .env.example .env      # then set AUTH_SECRET (required to arm the write gate)
yarn dev                  # the API on :4600  (the app is the farmline-app repo, :4700)
node scripts/seed.cjs     # optional demo farm
```

## Verify

```bash
yarn release              # syntax checks + the full smoke suite
```

## Deploy

`deploy.sh` — the droplet pulls and restarts; secrets live only in the
server's own `.env` (never committed; see `.env.example` for the shape).

## Repo layout

- `src/` — index (routes), models, schedule (protocols + today + completion),
  projection (shop availability from the records), reversal (in-situ undo),
  money, mpesa, chat, ladder, vocab (the plain-language guard)
- `test/` — integration (the server's behaviour), ui-contract (what the app
  reads), chat-money (the two doors and the honest payment rail)
- `scripts/` — dev, seed, smoke, preflight

Private product of farmline. No license; all rights reserved.
