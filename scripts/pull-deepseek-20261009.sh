#!/bin/bash
# pull-deepseek-20261009.sh — the DeepSeek key lives in the RUNNING zypparserver's
# environment (the .env's copy is empty; pm2 carries the real one). Pull it from
# /proc, run the translation pass with it, wipe the temp copy.
set -e
ZPID=$(sudo -u appuser pm2 pid zypparserver 2>/dev/null | head -1)
echo "the zypparserver pid: $ZPID"
KEY=$(sudo cat /proc/$ZPID/environ 2>/dev/null | tr '\0' '\n' | grep '^DEEPSEEK_API_KEY=' | cut -d= -f2-)
if [ -z "$KEY" ]; then echo "the key not found in the process env"; exit 1; fi
echo "the key pulled (${#KEY} chars)"
sudo -u appuser env DEEPSEEK_API_KEY="$KEY" sh -c 'cd /opt/farmline-server && nohup node --env-file=.env scripts/translate-v2.mjs > /tmp/translate-v2.log 2>&1 & echo the deepseek pass restarted'
sleep 15
head -4 /tmp/translate-v2.log
echo "NOTE: the key was never written to disk — it lived only in the env of this command."