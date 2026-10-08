#!/usr/bin/env python3
# scanner-410-20261006.py — the scanner-noise door-slam: /.git, /.env and kin
# answer 410 Gone (visible death) instead of 404, before `location /`.
# EXACT-COUNT: the anchor must occur exactly once or nothing is written.
import sys

CONF = '/etc/nginx/sites-available/zyppar.com'
ANCHOR = '    location / {'
BLOCK = """    # 2026-10-06 THE SCANNER DOOR-SLAM: /.git, /.env and kin answer 410 Gone
    # (visible death) - the 863-hit probe storms meet nothing to guess at.
    location ~* ^/\\.(git|env|gitignore|htaccess|aws) {
        return 410;
    }

"""

def main():
    s = open(CONF, encoding='utf-8').read()
    n = s.count(ANCHOR)
    if n != 1:
        print(f'ABORT: anchor occurs {n}x (want 1): {ANCHOR}')
        sys.exit(1)
    if '.git|env|gitignore' in s:
        print('SKIP: the 410 block already present')
        return
    s = s.replace(ANCHOR, BLOCK + ANCHOR, 1)
    print('inserted: the 410 door-slam block')
    with open(CONF + '.tmp-410', 'w', encoding='utf-8') as f:
        f.write(s)
    print('WROTE: ' + CONF + '.tmp-410')

main()