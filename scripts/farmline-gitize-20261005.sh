#!/usr/bin/env bash
# farmline-gitize-20261005.sh — /opt/farmline-server goes from hand-copy to GIT
# (remote: git@github.com:BenedictRinga/farmline.git — appuser is the SSH
# identity, matching the pm2 daemon). The .env NEVER-OVERWRITE guarantee.
set -euo pipefail

echo "── farmline backend: hand-copy → git ───────────────────────────"
if [ -d /opt/farmline-server/.git ]; then
    echo "already a git repo — nothing to do"
    exit 0
fi

# 1. PRESERVE the founder's .env (AUTH_SECRET, FARMLINE_ADMIN_KEY, MPESA_*)
cp /opt/farmline-server/.env /root/farmline.env.bak-20261005
echo "  ✓ .env preserved → /root/farmline.env.bak-20261005"

# 2. the hand-copy moves aside (rollback-able, not deleted)
mv /opt/farmline-server /opt/farmline-server.handcopy-20261005
echo "  ✓ hand-copy moved aside → /opt/farmline-server.handcopy-20261005"

# 3. the GIT CLONE (as appuser — the SSH identity)
sudo -u appuser git clone git@github.com:BenedictRinga/farmline.git /opt/farmline-server
echo "  ✓ cloned (HEAD: $(sudo -u appuser git -C /opt/farmline-server log --oneline -1))"

# 4. .env restored into the clone
cp /root/farmline.env.bak-20261005 /opt/farmline-server/.env
chown appuser:appuser /opt/farmline-server/.env
chmod 600 /opt/farmline-server/.env
echo "  ✓ .env restored (600, appuser)"

# 5. deps
cd /opt/farmline-server
sudo -u appuser bash -c 'export PATH=/home/appuser/.nvm/versions/node/v20.18.3/bin:$PATH; yarn install --frozen-lockfile --production 2>&1 | tail -2'
echo "  ✓ yarn done"

# 6. pm2 (appuser's daemon — the one systemd supervises)
sudo -u appuser bash -c 'export PATH=/home/appuser/.nvm/versions/node/v20.18.3/bin:$PATH; cd /opt/farmline-server && pm2 delete farmline-server 2>/dev/null; pm2 start src/index.js --name farmline-server --time && pm2 save' 2>&1 | grep -E "farmline|saved|error" | head -5
echo "  ✓ pm2 farmline-server started"

sleep 3
curl -s -o /dev/null -w "  health: %{http_code}\n" http://127.0.0.1:4600/api/farmline/health || echo "  health: no answer yet"
echo "── done ────────────────────────────────────────────────────────"