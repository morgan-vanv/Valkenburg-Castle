#!/usr/bin/env bash
# Snapshot all uncommitted work to origin/wip/demo without touching main,
# the index or the working tree. Optional: SCRATCH=<dir> also stores small
# agent helper files from <dir>/tools under wip-scratch/map-tools/.
# The Pages deploy only runs on main, so this never changes the live site.
set -euo pipefail
cd "$(git rev-parse --show-toplevel)"
idx=$(mktemp)
cp .git/index "$idx"
export GIT_INDEX_FILE="$idx"
git add -A
# Agent folders may be excluded locally while in progress; include them anyway.
for p in src/render src/ui src/audio src/data src/main.ts src/style.css index.html scripts/shot.mjs scripts/preview-map.mjs scripts/preview-map.ts; do
  [ -e "$p" ] && git add -f "$p"
done
if [ -n "${SCRATCH:-}" ] && [ -d "$SCRATCH/tools" ]; then
  for f in "$SCRATCH"/tools/*; do
    [ -f "$f" ] || continue
    h=$(git hash-object -w "$f")
    git update-index --add --cacheinfo "100644,$h,wip-scratch/map-tools/$(basename "$f")"
  done
fi
tree=$(git write-tree)
c=$(git commit-tree "$tree" -p "$(git rev-parse HEAD)" -m "WIP snapshot $(date -u +%FT%TZ)")
unset GIT_INDEX_FILE
rm -f "$idx"
git push -q -f origin "$c:refs/heads/wip/demo" 2>/dev/null
echo "snapshot $c"
