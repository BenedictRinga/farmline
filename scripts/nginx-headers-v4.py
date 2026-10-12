#!/usr/bin/env python3
# THE HEADER-INHERITANCE PATCH: the shell's fallback response is served by
# `location = /farmline/index.html`, which defines its own add_header — nginx
# does not inherit add_header from the outer location into it, so HSTS/CSP
# never reached the HTML. The two lines join that location as well.
import sys
LIVE = '/etc/nginx/sites-available/zyppar.com'
PROP = '/tmp/farmline-proposed-v4.conf'
lines = open(LIVE).read().splitlines()
HSTS = '        add_header Strict-Transport-Security "max-age=31536000; includeSubDomains" always;'
CSP = '        add_header Content-Security-Policy "default-src \'self\'; img-src \'self\' data: blob:; style-src \'self\' \'unsafe-inline\'; script-src \'self\'; connect-src \'self\' https://openrouter.ai; frame-ancestors \'none\'" always;'
idx = next(i for i, l in enumerate(lines) if 'location = /farmline/index.html' in l)
# find the location's closing brace
end = next(i for i in range(idx, len(lines)) if lines[i].strip() == '}')
block = lines[idx:end + 1]
if any('Strict-Transport' in l for l in block):
    print('already patched')
    sys.exit(0)
# insert the two headers before the closing brace
new_block = block[:-1] + [HSTS, CSP, block[-1]]
out = lines[:idx] + new_block + lines[end + 1:]
open(PROP, 'w').write('\n'.join(out) + '\n')
txt = '\n'.join(out)
print('HSTS count:', txt.count('Strict-Transport-Security'))
print('CSP count:', txt.count('Content-Security-Policy'))
print('PROPOSAL OK:', PROP)