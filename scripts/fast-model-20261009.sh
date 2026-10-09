#!/bin/bash
# fast-model-20261009.sh — the fast tool correction, the real vehicle: the
# same OpenRouter key, the FLASH-class model (the UI strings need speed, not
# a heavyweight reasoner).
sudo pkill -f translate-v2 2>/dev/null
sleep 1
sudo -u appuser env FARMLINE_TRANSLATE_PROVIDER=openrouter FARMLINE_TRANSLATE_MODEL=google/gemini-2.5-flash sh -c 'cd /opt/farmline-server && nohup node --env-file=.env scripts/translate-v2.mjs > /tmp/translate-v2.log 2>&1 & echo started'
sleep 20
head -6 /tmp/translate-v2.log