#!/usr/bin/env bash
# farmline-nginx-fix-20261005.sh — REPLACE the old farmline block (the whole
# path proxied to :4600 — the pre-git architecture) with the NEW one (the
# static bundle from /var/www/farmline + the API/socket proxies).
set -euo pipefail
NG=/etc/nginx/sites-available/zyppar.com
cp "$NG" "$NG.bak-20261005-farmline-fix"

python3 - "$NG" <<'PYEOF'
import sys, re
ng = sys.argv[1]
s = open(ng).read()

NEW = '''    # ── 2026-10-05 FARMLINE — the NEW architecture ─────────────────────
    # Static Angular bundle (base-href /farmline/) served from disk;
    # only /api/farmline and /socket-farmline proxy to farmline-server (:4600).
    location = /farmline {
        return 301 /farmline/;
    }

    location = /farmline/index.html {
        alias /var/www/farmline/index.html;
        add_header Cache-Control "no-cache";
    }

    location /farmline/ {
        alias /var/www/farmline/;
        try_files $uri $uri/ /farmline/index.html;
    }

    location ~ ^/api/farmline/ {
        proxy_pass http://127.0.0.1:4600;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_intercept_errors off;
    }

    location /socket-farmline/ {
        proxy_pass http://127.0.0.1:4600;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection $connection_upgrade;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_read_timeout 86400;
        proxy_connect_timeout 86400;
        proxy_send_timeout 86400;
        proxy_buffering off;
        proxy_buffers 8 32k;
        proxy_buffer_size 64k;
        chunked_transfer_encoding off;
    }
'''

# cut from "location = /farmline {" through the last farmline-related block
start = s.find('    location = /farmline {')
if start < 0:
    print('START-MISS'); sys.exit(1)
# the end: the end of the LAST farmline location block — find the /api/farmline/ block and its closing
api_idx = s.find('location ~ ^/api/farmline/ {', start)
if api_idx < 0:
    print('API-MISS'); sys.exit(1)
# the closing brace of the api block: count braces from api_idx
depth = 0
i = s.find('{', api_idx)
end = None
while i < len(s):
    if s[i] == '{': depth += 1
    elif s[i] == '}':
        depth -= 1
        if depth == 0:
            end = i + 1
            break
    i += 1
if not end:
    print('END-MISS'); sys.exit(1)
# extend to the end of the line
end = s.find('\n', end)
s = s[:start] + NEW + s[end + 1:]
open(ng, 'w').write(s)
print('  ✓ old block replaced with the NEW architecture')
PYEOF

nginx -t
systemctl reload nginx
echo "  ✓ nginx reloaded"
sleep 1
curl -s -o /dev/null -w "  /farmline/: %{http_code}\n" https://zyppar.com/farmline/
curl -s -o /dev/null -w "  /api/farmline/health: %{http_code}\n" https://zyppar.com/api/farmline/health
curl -s https://zyppar.com/farmline/ | head -c 200 | grep -oE "<title>[^<]*</title>" || true
echo "── done ────────────────────────────────────────────────────────"