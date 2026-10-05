// append-reorigin-note-20261005.mjs — the tarball→checkout recovery record.
import fs from 'fs';
const note = [
    '',
    '## THE DEPLOY RECOVERY - the tarball episode (2026-10-05)',
    '',
    '- The other thread\\'s workflow replaced /opt/farmline-server with a TARBALL copy (no .git) — the new 7-step deploy.sh correctly refused ("This checkout has NO origin remote").',
    '- THE RECOVERY (run once): git init + remote add origin git@github.com:BenedictRinga/farmline.git + chown -R appuser:appuser + fetch + reset --hard origin/main. .env survives (untracked). safe.directory exceptions added for root AND appuser.',
    '- THE DEPLOY COMMAND FROM NOW ON: sudo -u appuser bash -c \\'cd /opt/farmline-server && ./deploy.sh\\' — NEVER as root: root\\'s SSH key is not on GitHub and root does not own the pm2 daemon.',
    '- Verified: checkout at 35979cd (build 16, the farm\\'s photograph feature), deployed and verified by the script itself, health 200.',
    '- The frontend pulled 4c72aab + rebuilt + shipped: the served bundle unchanged (that delta touched no app source — content-addressed caching working as designed).',
    '',
].join('\n');
fs.appendFileSync('AGENTS.md', note);
console.log('note appended');