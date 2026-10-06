#!/usr/bin/env python3
# farmline-nginx-surgery.py - the idempotent block surgery behind
# scripts/farmline-nginx-ensure.sh. Run by the ensure script only.
#
# WHAT IT DOES (in order):
#   1. REMOVES every farmline location block currently in the conf - any block
#      whose header matches `location ...farmline...` (all three historical
#      shapes: the ship block, the fix block, the canonical). Brace-balanced
#      walking, so nested blocks come out whole. A farmline marker comment
#      directly above a removed block goes with it.
#   2. INSERTS the canonical block (deploy/farmline-nginx-block.conf) before
#      the first anchor that exists - never appended blindly.
#   3. Writes the conf back. nginx -t and the reload live in the shell wrapper
#      (with the backup + auto-restore there).
import re
import sys


def remove_farmline_blocks(text: str) -> tuple[str, int]:
    """Cut every farmline location block (brace-balanced) out of the conf."""
    out = text
    removed = 0
    pattern = re.compile(r'^[ \t]*location[^{]*farmline[^{]*\{', re.MULTILINE)
    while True:
        m = pattern.search(out)
        if not m:
            break
        start = m.start()
        # Walk to the matching closing brace of this location block.
        depth = 0
        i = out.index('{', m.start())
        j = i
        while j < len(out):
            if out[j] == '{':
                depth += 1
            elif out[j] == '}':
                depth -= 1
                if depth == 0:
                    break
            j += 1
        end = j + 1  # just past the closing brace
        # A marker comment line directly above the block goes with it.
        line_start = out.rfind('\n', 0, start) + 1
        prev_line_start = out.rfind('\n', 0, line_start - 1) + 1 if line_start > 0 else 0
        prev_line = out[prev_line_start:line_start]
        if 'FARMLINE' in prev_line.upper() or 'farmline' in prev_line:
            start = prev_line_start
        out = out[:start] + out[end:]
        removed += 1
    return out, removed


def insert_canonical(text: str, block: str) -> str:
    """Insert the canonical block before the first anchor found."""
    anchors = [
        '# Distribution: podcast/series RSS + sitemap (backend-only, no UA condition)',
        'location /api/loopkeeper/',
        'location /socket-rolodex/',
        'location / {',
    ]
    for a in anchors:
        idx = text.find(a)
        if idx != -1:
            line_start = text.rfind('\n', 0, idx) + 1
            return text[:line_start] + block + text[line_start:]
    raise SystemExit('  X no anchor found - the conf has none of the known anchors; aborting without writing')


def main() -> None:
    conf_path = sys.argv[1]
    block_path = sys.argv[2]
    with open(conf_path, encoding='utf-8') as f:
        text = f.read()
    with open(block_path, encoding='utf-8') as f:
        block = f.read()

    text, removed = remove_farmline_blocks(text)
    text = insert_canonical(text, block)
    with open(conf_path, 'w', encoding='utf-8') as f:
        f.write(text)
    print(f'  OK surgery done - removed {removed} stale farmline block(s), inserted the canonical set')


if __name__ == '__main__':
    main()
