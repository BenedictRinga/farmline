#!/usr/bin/env bash
# install-watch.sh — ONE command on the droplet: install the farmline watch
# (the every-minute self-heal + early warning) as a root cron entry.
# Idempotent: the marker line guards a second install.
#
#   sudo bash /opt/farmline-server/scripts/install-watch.sh
set -euo pipefail

MARKER="# farmline-watch (self-heal + early warning)"
CRON_LINE="* * * * * root /opt/farmline-server/scripts/farmline-watch.sh >/var/log/farmline-watch.log 2>&1"

mkdir -p /var/lib/farmline
chmod +x /opt/farmline-server/scripts/farmline-watch.sh 2>/dev/null || true
touch /var/log/farmline-watch.log

CRON_FILE=/etc/cron.d/farmline-watch
if [ -f "$CRON_FILE" ] && grep -q "farmline-watch" "$CRON_FILE"; then
  echo "  ✓ the watch is already installed ($CRON_FILE)"
else
  {
    echo "$MARKER"
    echo "$CRON_LINE"
  } > "$CRON_FILE"
  chmod 644 "$CRON_FILE"
  echo "  ✓ installed: $CRON_FILE (every minute)"
fi

# First run now, so the state file exists and any CURRENT outage heals at once.
bash /opt/farmline-server/scripts/farmline-watch.sh || true
echo "  ✓ first check ran — see /var/log/farmline-watch.log"
echo "  (alerts: add FARMLINE_ALERT_WEBHOOK=<url> to /opt/zyppar-server/.env to get pinged)"
