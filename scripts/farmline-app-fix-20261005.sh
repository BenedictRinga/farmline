#!/usr/bin/env bash
# farmline-app-fix-20261005.sh — the app tree is stuck at 441b46e (build 9)
# with mechanical CLI noise blocking the pull. Clean → pull → full rebuild →
# verify the photo code IN the build → atomic ship → verify served.
set -euo pipefail
D=/opt/farmline-app
export PATH=/home/appuser/.nvm/versions/node/v20.18.3/bin:$PATH

echo "── farmline-app: unstuck → latest → rebuilt ────────────────────"
cd "$D"

# 1. discard the mechanical CLI edits (analytics id, version stamp, file mode)
sudo -u appuser git checkout -- angular.json deploy.sh src/environments/environment.prod.ts
echo "  ✓ mechanical edits discarded"

# 2. pull the latest remote (4c72aab → 3d7839b → e6b079c: the margins, the
#    photo, the doctrine)
sudo -u appuser git pull origin main 2>&1 | tail -2
echo "  ✓ HEAD: $(sudo -u appuser git log --oneline -1)"

# 3. deps + a FULL rebuild (no incremental cache)
sudo -u appuser rm -rf .angular
sudo -u appuser yarn install --frozen-lockfile 2>&1 | tail -1
sudo -u appuser yarn build:prod 2>&1 | tail -2

# 4. THE GATE: the photo code must be IN the built output
if grep -rq 'fl-photo-input' www/*.js; then
    echo "  ✓ photo code present in the built chunks"
else
    echo "  ✗ PHOTO CODE MISSING FROM THE BUILD — aborting the ship"
    exit 1
fi
if grep -q 'padding-inline' www/styles.*.css; then
    echo "  ✓ margins present in the built styles"
else
    echo "  ✗ MARGINS MISSING FROM THE BUILD — aborting the ship"
    exit 1
fi

# 5. the atomic ship
STAGE="/var/www/farmline.new.$$"
rm -rf "$STAGE"; mkdir -p "$STAGE"
cp -r www/. "$STAGE"/
rm -rf /var/www/farmline.prev
mv /var/www/farmline /var/www/farmline.prev
mv "$STAGE" /var/www/farmline
chown -R www-data:www-data /var/www/farmline
echo "  ✓ shipped (previous kept at /var/www/farmline.prev)"

# 6. verify SERVED
systemctl reload nginx
sleep 1
SCH=$(grep -l 'fl-photo-input' /var/www/farmline/*.js | head -1)
echo "  ✓ served photo chunk: $(basename "${SCH:-MISSING}")"
CSS=$(ls /var/www/farmline/styles.*.css)
echo "  ✓ served margins: $(grep -c 'padding-inline' "$CSS")"
curl -s -o /dev/null -w "  shell: %{http_code}\n" https://zyppar.com/farmline/
curl -s -o /dev/null -w "  health: %{http_code}\n" https://zyppar.com/api/farmline/health
echo "── done ────────────────────────────────────────────────────────"