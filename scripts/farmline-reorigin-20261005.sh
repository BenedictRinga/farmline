#!/usr/bin/env bash
# farmline-reorigin-20261005.sh — the tarball copy becomes a real checkout:
# git init + origin (SSH) + fetch + reset --hard origin/main — .env untouched
# (untracked). Then the deploy runs as APPUSER (the SSH identity pm2 uses).
set -euo pipefail
D=/opt/farmline-server

echo "── farmline-server: tarball → checkout ────────────────────────"
cd "$D"

if [ ! -d .git ]; then
    git init -q
    git remote add origin git@github.com:BenedictRinga/farmline.git
    echo "  ✓ git init + origin (SSH)"
else
    git remote remove origin 2>/dev/null || true
    git remote add origin git@github.com:BenedictRinga/farmline.git
    echo "  ✓ origin re-pointed (SSH)"
fi

# appuser owns everything (the pm2 identity; the SSH key lives in its .ssh)
chown -R appuser:appuser "$D"

# fetch + align the working tree with the remote (untracked .env survives)
sudo -u appuser git -C "$D" fetch origin 2>&1 | tail -1
sudo -u appuser git -C "$D" reset --hard origin/main
echo "  ✓ checkout at $(sudo -u appuser git -C "$D" log --oneline -1)"

# the deploy — as APPUSER (its pm2 daemon; its GitHub key)
sudo -u appuser bash -c 'export PATH=/home/appuser/.nvm/versions/node/v20.18.3/bin:$PATH; cd /opt/farmline-server && ./deploy.sh' 2>&1 | tail -8

sleep 2
curl -s -m 5 -o /dev/null -w "health: %{http_code}\n" http://127.0.0.1:4600/api/farmline/health
echo "── done ────────────────────────────────────────────────────────"