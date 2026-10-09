#!/bin/bash
# fix-chat-floor-20261009.sh — the crash-loop cure: chat.js called the retired
# mandatoryFloor() on every socket connection; each connection killed the fresh
# boot. The floor is retired with the LoopKeeper clone; the connection-time
# emit goes inert; the announce route remains the room's driver.
set -e
cd /opt/farmline-server
sudo -u appuser python3 - <<'PYEOF'
import re
p = 'src/chat.js'
s = open(p, encoding='utf-8').read()
old = """    socket.join('updates');
    const floor = updates.mandatoryFloor();
    if (floor > 0) socket.emit('update:mandatory', { build: floor });"""
new = """    socket.join('updates');
    // 2026-10-09 THE LOOPKEEPER VERBATIM: no mandatory floor in the check —
    // the announce route drives the room push. The connection-time floor emit
    // is retired with the floor itself (the crash its removal exposed dies here).
    const floor = 0;
    if (floor > 0) socket.emit('update:mandatory', { build: floor }); // inert"""
assert old in s, 'the chat floor block not found'
open(p, 'w', encoding='utf-8').write(s.replace(old, new, 1))
print('the chat floor retired')
PYEOF
sudo chown appuser:appuser src/chat.js
sudo -u appuser node --check src/chat.js
sudo -u appuser pm2 restart farmline-server >/dev/null 2>&1
sleep 5
curl -s -o /dev/null -w 'health:%{http_code}\n' -m 6 https://zyppar.com/api/farmline/health