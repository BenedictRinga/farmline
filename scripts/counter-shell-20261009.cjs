// counter-shell-20261009.cjs — the counter law, the NODE-FREE form: the sudo
// PATH lacks the nvm node, so the node -e line silently failed and the stamp
// stayed 41. Pure shell (grep + arithmetic + sed) works in any environment.
const fs = require('fs');
function patch(p) {
    let s = fs.readFileSync(p, 'utf8');
    if (s.includes('COUNTER LAW (SHELL FORM)')) { console.log('SKIP', p); return; }
    // remove the old node-based lines
    s = s.replace(/^# THE COUNTER LAW \(2026-10-09.*\n(#.*\n)*COMMITS=\$\(git rev-list.*\nnode -e.*\n/m, '');
    s = s.replace(/^COMMITS=\$\(git rev-list.*\nnode -e.*\n\n/m, '');
    s = s.replace(/# THE COUNTER LAW \(2026-10-09, the founder: stuck on v0\.1\.41 for 5 deploys\):.*?node -e.*\n{0,2}/s, '');
    const anchor = s.match(/echo "3\/7[^"]*"/);
    if (!anchor) { console.log('MISS anchor', p); process.exit(1); }
    const law = [
        '# THE COUNTER LAW (SHELL FORM, 2026-10-09): the build number climbs on EVERY',
        '# deploy — max(package.json, commit count)+1 — with NO node dependency (the',
        '# sudo PATH lacks the nvm node; the first form failed silently).',
        'CUR_BUILD=$(grep -oE \'"build":[ ]*[0-9]+\' package.json | grep -oE \'[0-9]+\' | head -1)',
        'CUR_BUILD=${CUR_BUILD:-0}',
        'COMMITS=$(git rev-list --count HEAD 2>/dev/null || echo 0)',
        'NEW_BUILD=$(( CUR_BUILD > COMMITS ? CUR_BUILD : COMMITS + 1 ))',
        'sed -i "s/\\"build\\":[ ]*[0-9]*/\\"build\\": $NEW_BUILD/" package.json',
        'echo "  build counter -> $NEW_BUILD"',
        '',
    ].join('\n');
    s = s.replace(anchor[0], law + anchor[0], 1);
    fs.writeFileSync(p, s);
    console.log('OK', p);
}
patch('D:/MacBook/noGoogle/farmline/deploy.sh');
patch('D:/MacBook/noGoogle/farmline-app/deploy-app.sh');