#!/usr/bin/env python3
# farmline-assetfix-20261005.py — insert the two ASSET-ALIAS blocks (QUOTED —
# nginx eats unquoted {16,} braces: the GLM thread's failure) before the SPA
# fallback, + restore the 12M upload limit my regex API block shadowed.
# Backup → insert → nginx -t → reload; auto-restore if the test fails.
import subprocess, shutil, sys

NG = '/etc/nginx/sites-available/zyppar.com'
BAK = NG + '.bak-20261005-assetfix'

shutil.copy(NG, BAK)
print('backup:', BAK)

s = open(NG, encoding='utf-8').read()

# already inserted?
if 'location ~* "^/farmline(' in s:
    print('ALREADY-PRESENT')
    sys.exit(0)

BLOCK = '''    # Hashed bundles are content-addressed — immutable for a week.
    # (The regex is QUOTED: nginx eats unquoted {16,} braces — the parser
    # failure the 2026-10-05 insertion hit.)
    location ~* "^/farmline(/.+\\.[0-9a-f]{16,}\\.(?:js|css|woff2?))$" {
        alias /var/www/farmline$1;
        add_header Cache-Control "public, max-age=604800, immutable";
    }

    # Unhashed assets: a real 404 on a miss — never the shell (the
    # ChunkLoadError storm guard).
    location ~* "^/farmline(/.+\.(?:js|mjs|css|map|woff2?|png|jpe?g|gif|svg|ico|webmanifest|json|txt))$" {
        alias /var/www/farmline$1;
        add_header Cache-Control "no-cache";
    }

'''
# the anchor: MY new-architecture SPA fallback (the only `location /farmline/ {`)
anchor = '    location /farmline/ {\n        alias /var/www/farmline/;'
if anchor not in s:
    anchor = '    location /farmline/ {\r\n        alias /var/www/farmline/;'
    BLOCK = BLOCK.replace('\n', '\r\n')
if anchor not in s:
    print('ANCHOR-MISSING')
    sys.exit(1)
s = s.replace(anchor, BLOCK + anchor, 1)

# the shadowed upload limit: my regex API block gets the 12M the old prefix
# block carries (regex beats prefix — the 12M was bypassed)
s = s.replace('''    location ~ ^/api/farmline/ {
        proxy_pass http://127.0.0.1:4600;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_intercept_errors off;
    }''', '''    location ~ ^/api/farmline/ {
        proxy_pass http://127.0.0.1:4600;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_intercept_errors off;
        client_max_body_size 12M;
    }''', 1)

open(NG, 'w', encoding='utf-8').write(s)
print('inserted (quoted) + 12M restored to the regex API block')

# THE GATE: test; auto-restore if broken
t = subprocess.run(['nginx', '-t'], capture_output=True, text=True)
if t.returncode != 0:
    shutil.copy(BAK, NG)
    print('NGINX-TEST-FAILED — RESTORED THE BACKUP')
    print(t.stderr[-400:])
    sys.exit(1)
print('nginx -t OK')
subprocess.run(['systemctl', 'reload', 'nginx'], check=True)
print('RELOADED')