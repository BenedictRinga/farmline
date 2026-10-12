#!/usr/bin/env python3
# THE MINIMAL SURGERY (the magister, 2026-10-13) — exact line-based operations,
# no brace counting, no regexes against quoted patterns (the failure class the
# Oct-8 script hit twice today). The live conf keeps its proven farmline blocks;
# this script (1) ensures the hashed-asset immutable location exists,
# (2) REPLACES the 4-line SPA block with the canonical one carrying the share
# hook + HSTS + CSP. Every step verified by content checks before the write.
import sys

LIVE = '/etc/nginx/sites-available/zyppar.com'
PROP = '/tmp/farmline-proposed-v3.conf'
BLOCK = '/tmp/farmline-nginx-block-new.conf'

live = open(LIVE).read().splitlines()
block = open(BLOCK).read().splitlines()

def find(lines, exact_prefix):
    for i, l in enumerate(lines):
        if l.strip().startswith(exact_prefix):
            return i
    return -1

# ── 1. the canonical pieces ──────────────────────────────────────────────────
# the hashed-assets location block: from its 'location ~* "' line to its '}'
hi = -1
for i, l in enumerate(block):
    if 'farmline(/.+\\.[0-9a-f]{16,}' in l and l.strip().startswith('location'):
        hi = i
        break
assert hi >= 0, 'the hashed-assets location not found in the canonical block'
hashed = block[hi:]
hashed_end = next(i for i, l in enumerate(hashed) if l.strip() == '}') + 1
hashed = hashed[:hashed_end]

# the canonical SPA block: from 'location /farmline/ {' to the line before the
# API comment
si = find(block, 'location /farmline/ {')
assert si >= 0, 'the canonical SPA block not found'
ei = next(i for i in range(si, len(block)) if 'THE API' in block[i])
spa = block[si:ei]
while spa and spa[-1].strip() == '':
    spa.pop()
assert any('facebookexternalhit' in l for l in spa), 'the share hook missing from the canonical SPA block'
assert any('Strict-Transport-Security' in l for l in spa), 'HSTS missing from the canonical SPA block'

# ── 2. the live edits ────────────────────────────────────────────────────────
out = list(live)
# 2a. replace the live SPA block (4 lines: location /farmline/ { alias; try_files; })
si_live = find(out, 'location /farmline/ {')
assert si_live >= 0, 'the live SPA block not found'
ei_live = next(i for i in range(si_live, len(out)) if out[i].strip() == '}')
out[si_live:ei_live + 1] = spa

# 2b. insert the hashed-assets location right before the SPA block if absent
already = any('{16,}' in l for l in out)
if not already:
    out[si_live:si_live] = hashed + ['']

open(PROP, 'w').write('\n'.join(out) + '\n')

# ── 3. verify the proposal by content ────────────────────────────────────────
txt = '\n'.join(out)
checks = {
    'share hook': 'facebookexternalhit|WhatsApp' in txt,
    'HSTS': 'Strict-Transport-Security' in txt,
    'CSP': 'Content-Security-Policy' in txt,
    'og/s rewrite': 'og/s/$1 last' in txt,
    'hashed assets immutable': '{16,}' in txt and 'immutable' in txt,
    'the quoted line intact': 'location ~* "^/farmline(/.+\\.[0-9a-f]{16,}\\.(?:js|css|woff2?))$"' in txt,
}
bad = [k for k, v in checks.items() if not v]
for k, v in checks.items():
    print(('  OK  ' if v else '  MISS') + ' ' + k)
if bad:
    print('PROPOSAL FAILED CONTENT CHECKS — not applied')
    sys.exit(1)
print('PROPOSAL OK: ' + PROP)