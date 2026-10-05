// append-droplet-note-20261005.mjs — the durable record of the droplet state.
import fs from 'fs';
const note = [
    '',
    '## 🌐 DROPLET STATE (2026-10-05 — the git-native deploy is LIVE)',
    '',
    '- /opt/farmline-server is now a GIT CLONE of git@github.com:BenedictRinga/farmline.git (HEAD 16b1deb) — the pre-git hand-copy moved aside to /opt/farmline-server.handcopy-20261005. ./deploy.sh (fetch → reset --hard → pull → yarn → env → pm2 restart --update-env → pm2 save) now works as designed, run as **appuser** (the SSH identity lives in /home/appuser/.ssh/config; root\'s key is NOT authorized on GitHub).',
    '- The founder .env was preserved through the conversion: /root/farmline.env.bak-20261005 (also restored into the clone, 600/appuser).',
    '- pm2 farmline-server (appuser daemon — the systemd-supervised one) runs src/index.js on :4600; health 200.',
    '- nginx (sites-available/zyppar.com, backup .bak-20261005-farmline-fix): the OLD block (the whole /farmline/ path proxied to :4600) is REPLACED by the new architecture — the static bundle at /var/www/farmline/ (atomic swap, .prev rollback) + location ~ ^/api/farmline/ + location /socket-farmline/ proxy to :4600. Both live-verified 200.',
    '- Frontend: /opt/farmline-app is the clone of farmline-app.git (HEAD 441b46e); yarn build:prod runs on the droplet (appuser nvm node v20.18.3); the bundle ships via the atomic swap. Rolling deploy: cd /opt/farmline-app && git pull && yarn && yarn build:prod, then the swap.',
    '- GitHub pull auth from the droplet = appuser (sudo -u appuser git ...); both repos are SSH remotes.',
    '',
].join('\n');
fs.appendFileSync('AGENTS.md', note);
console.log('note appended');