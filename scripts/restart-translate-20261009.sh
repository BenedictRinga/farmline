#!/bin/bash
# restart-translate-20261009.sh — kill the slow GLM pass, start the DeepSeek pass.
sudo pkill -f translate-v2 2>/dev/null
sleep 1
echo "the glm pass killed: $(ps aux | grep translate-v2 | grep -v grep | wc -l) remaining"
grep -c 'DEEPSEEK_API_KEY' /opt/zyppar-server/.env 2>/dev/null || echo 'no DEEPSEEK key in the zyppar .env'
sudo -u appuser sh -c 'cd /opt/farmline-server && nohup node --env-file=.env scripts/translate-v2.mjs > /tmp/translate-v2.log 2>&1 & echo the deepseek pass started'
sleep 8
head -3 /tmp/translate-v2.log