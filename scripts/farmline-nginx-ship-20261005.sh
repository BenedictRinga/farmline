#!/usr/bin/env bash
# farmline-nginx-ship-20261005.sh — the nginx block + the atomic bundle swap.
set -euo pipefail
NG=/etc/nginx/sites-available/zyppar.com

echo "── farmline: nginx + ship ──────────────────────────────────────"

# 1. THE NGINX BLOCK (mirrors the LoopKeeper shapes: static alias + API proxy
#    + the WebSocket block — :4600, /socket-farmline/)
if grep -q 'location /api/farmline/' "$NG"; then
    echo "  ✓ nginx block already present"
else
    ANCHOR='# Distribution: podcast/series RSS + sitemap (backend-only, no UA condition)'
    grep -q "$ANCHOR" "$NG" || { echo "  ✗ anchor missing — nginx edit aborted"; exit 1; }
    cat > /tmp/farmline-nginx-block.txt <<'BLOCK'
    # ── 2026-10-05 FARMLINE — the farmer's records app ─────────────────
    # Static Angular bundle (base-href /farmline/) + the Node API (:4600).
    # Mirrors the LoopKeeper architecture exactly.
    location /api/farmline/ {
        proxy_pass http://127.0.0.1:4600/api/farmline/;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
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

    location = /farmline/index.html {
        alias /var/www/farmline/index.html;
        add_header Cache-Control "no-cache";
    }

    location /farmline/ {
        alias /var/www/farmline/;
        try_files $uri $uri/ /farmline/index.html;
    }

BLOCK
    # insert BEFORE the anchor (in-place, with a backup)
    cp "$NG" "$NG.bak-20261005-farmline"
    python3 - "$NG" <<'PYEOF'
import sys
ng = sys.argv[1]
s = open(ng).read()
block = open('/tmp/farmline-nginx-block.txt').read()
anchor = '# Distribution: podcast/series RSS + sitemap (backend-only, no UA condition)'
s = s.replace(anchor, block + anchor, 1)
open(ng, 'w').write(s)
print('  ✓ block inserted')
PYEOF
fi

# 2. THE ATOMIC BUNDLE SWAP (mirrors farmline-app/deploy.sh's ship shape)
if [ -d /opt/farmline-app/www ]; then
    STAGE="/var/www/farmline.new.$$"
    rm -rf "$STAGE"
    mkdir -p "$STAGE"
    cp -r /opt/farmline-app/www/. "$STAGE"/
    if [ -d /var/www/farmline ]; then
        rm -rf /var/www/farmline.prev
        mv /var/www/farmline /var/www/farmline.prev
    fi
    mv "$STAGE" /var/www/farmline
    chown -R www-data:www-data /var/www/farmline 2>/dev/null || true
    echo "  ✓ bundle shipped (previous kept at /var/www/farmline.prev)"
else
    echo "  ✗ /opt/farmline-app/www missing — build first"
    exit 1
fi

# 3. TEST + RELOAD
nginx -t
systemctl reload nginx
echo "  ✓ nginx reloaded"

# 4. VERIFY
sleep 1
curl -s -o /dev/null -w "  /farmline/: %{http_code}\n" https://zyppar.com/farmline/
curl -s -o /dev/null -w "  /api/farmline/health: %{http_code}\n" https://zyppar.com/api/farmline/health
echo "── done ────────────────────────────────────────────────────────"