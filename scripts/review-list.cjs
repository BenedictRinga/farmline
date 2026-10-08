// scripts/review-list.cjs — the generator gains the MANDATORY REVIEW section
// (the trusted session's caught rollback, 2026-10-07: the proposal carried
// the stale unquoted regex at ~:440 and the apply paid one rollback — the
// review list makes that line unmissable BEFORE any apply).
const fs = require('fs');
const f = 'scripts/farmline-nginx-ensure.sh';
let s = fs.readFileSync(f, 'utf8');
if (s.includes('REVIEW BEFORE APPLY')) { console.log('  ok (already)'); process.exit(0); }

const anchor = 'cat <<EOF\n  ── TO APPLY (the founder\'s hand, in order) ──';
if (!s.includes(anchor)) { console.log('  ✗ anchor miss'); process.exit(1); }

const review = [
  'echo "  ── REVIEW BEFORE APPLY (MANDATORY — the trusted session\'s lesson) ──"',
  'echo "  every farmline line REMAINING in the proposal; each must belong to the"',
  'echo "  ONE canonical set — and there must be NO unquoted {n,} regex anywhere:"',
  'grep -n "farmline" "$PROP" || echo "    (none)"',
  'echo "  unquoted-brace regexes left in the proposal (MUST be none):"',
  'grep -nE \'location[^#]*\\{[0-9]+,\\}\' "$PROP" || echo "    (none — clean)"',
  'echo',
  anchor,
].join('\n');
s = s.replace(anchor, review);
fs.writeFileSync(f, s);
console.log('  the review list added to the generator');
