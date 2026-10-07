// scripts/review-list2.cjs — the MANDATORY REVIEW section into the generator.
// v2: the file is CRLF — match and insert with CRLF.
const fs = require('fs');
const f = 'scripts/farmline-nginx-ensure.sh';
let s = fs.readFileSync(f, 'utf8');
if (s.includes('REVIEW BEFORE APPLY')) { console.log('  ok (already)'); process.exit(0); }

const NL = String.fromCharCode(13, 10); // CRLF — the file's real line ending
const OLD = 'diff -u "$NG" "$PROP" | head -80 || true' + NL + 'echo' + NL + 'cat <<EOF';
if (!s.includes(OLD)) { console.log('  ✗ anchor miss (CRLF)'); process.exit(1); }

const q = String.fromCharCode(39); // single quote
const REVIEW = [
  'diff -u "$NG" "$PROP" | head -80 || true',
  'echo',
  '',
  'echo "  ── REVIEW BEFORE APPLY (MANDATORY - the trusted session' + q + 's lesson) ──"',
  'echo "  every farmline line REMAINING in the proposal; each must belong to the"',
  'echo "  ONE canonical set - and there must be NO unquoted {n,} regex anywhere:"',
  'grep -n "farmline" "$PROP" || echo "    (none)"',
  'echo "  unquoted-brace regexes left in the proposal (MUST be none):"',
  'grep -nE ' + q + 'location[^#]*[{][0-9]+,}' + q + ' "$PROP" || echo "    (none - clean)"',
  'echo',
  '',
  'cat <<EOF',
].join(NL);
s = s.replace(OLD, REVIEW);
fs.writeFileSync(f, s);
console.log('  review list added (CRLF-consistent)');
