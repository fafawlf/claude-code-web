#!/usr/bin/env bash
# Push self-contained local skills to the team server's shared skill dir.
# Run from your LOCAL machine (the skills live in ~/.claude/skills):
#   bash deploy/team/push-skills.sh
#
# What ships: every skill whose SKILL.md is real content and does NOT resolve
# into the gstack runtime (gstack-derived skills need macOS binaries that do
# not exist on the Linux server). Symlinked skills are dereferenced to real
# files. Sensitive skills listed in EXCLUDE are never pushed.
set -euo pipefail

SRC=${SRC:-$HOME/.claude/skills}
DEST_HOST=${DEST_HOST:-root@134.199.226.3}
DEST_DIR=${DEST_DIR:-/root/.claude/skills}
SSH_KEY=${SSH_KEY:-$HOME/.ssh/id_ed25519}
# Skills carrying private data that should NOT be shared with the whole team.
EXCLUDE=${EXCLUDE:-"emochi-corp-finance"}

STAGE=$(mktemp -d)
trap 'rm -rf "$STAGE"' EXIT

is_excluded() { for x in $EXCLUDE; do [ "$1" = "$x" ] && return 0; done; return 1; }

count=0
for path in "$SRC"/*; do
  name=$(basename "$path")
  [ "$name" = "gstack" ] && continue
  is_excluded "$name" && continue
  # Resolve SKILL.md through any symlinks; skip skills that live inside gstack.
  skillmd=$(readlink -f "$path/SKILL.md" 2>/dev/null || true)
  [ -z "$skillmd" ] || [ ! -f "$skillmd" ] && continue
  case "$skillmd" in */gstack/*) continue;; esac
  cp -RL "$path" "$STAGE/$name"
  count=$((count + 1))
done

# Drop dev cruft that should never reach the server.
find "$STAGE" \( -name .git -o -name node_modules -o -name __pycache__ \) -prune -exec rm -rf {} + 2>/dev/null || true
find "$STAGE" \( -name '*.pyc' -o -name '.DS_Store' \) -delete 2>/dev/null || true

echo "Staged $count portable skills ($(du -sh "$STAGE" | cut -f1)). Syncing to $DEST_HOST:$DEST_DIR"
rsync -az --delete -e "ssh -i $SSH_KEY -o BatchMode=yes" "$STAGE/" "$DEST_HOST:$DEST_DIR/"
echo "Done. Server now has: $(ssh -i "$SSH_KEY" -o BatchMode=yes "$DEST_HOST" "ls $DEST_DIR | wc -l") skills."
