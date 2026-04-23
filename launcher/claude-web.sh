#!/usr/bin/env bash
# claude-web launcher (macOS / Linux)
# Run this on YOUR LAPTOP. Double-click or: bash claude-web.sh
#
# What it does:
#   1. SSHes to the remote and makes sure claudecode-web is running (in tmux)
#   2. Fetches the auth token from the remote
#   3. Opens an SSH tunnel in the background
#   4. Opens your browser at the tokenized URL

set -euo pipefail

# ─── Edit these once ──────────────────────────────────────────────────────────
REMOTE="user@your-remote-host"      # e.g. "fafawlf@1.2.3.4" — must be SSH-key auth
REMOTE_REPO="~/claudecode"           # where you cloned claude-code-web on the remote
PROJECT="~/"                          # cwd for Claude on the remote (any project dir)
LOCAL_PORT=8080
REMOTE_PORT=8080
# ──────────────────────────────────────────────────────────────────────────────

TMUX_SESSION="ccw"
SSH_SOCK="/tmp/claude-web-$(echo "$REMOTE" | tr '@:/' '___').sock"

say()  { printf '\033[1;36m[claude-web]\033[0m %s\n' "$*"; }
die()  { printf '\033[1;31m[claude-web] %s\033[0m\n' "$*" >&2; exit 1; }

[[ "$REMOTE" == "user@your-remote-host" ]] && \
  die "Edit $0 first — set REMOTE to your SSH target (e.g. you@1.2.3.4)."

command -v ssh >/dev/null || die "ssh not found on this laptop."

# 1. Ensure server is running on remote (idempotent — tmux has-session returns 0 if alive)
say "Checking remote server…"
START_CMD=$(cat <<EOF
set -e
if ! tmux has-session -t $TMUX_SESSION 2>/dev/null; then
  tmux new-session -d -s $TMUX_SESSION "cd $PROJECT && node $REMOTE_REPO/server/dist/bin/claudecode-web.js --port $REMOTE_PORT"
  # give it a moment to come up
  for i in 1 2 3 4 5 6 7 8 9 10; do
    if curl -sf http://127.0.0.1:$REMOTE_PORT/healthz >/dev/null 2>&1; then break; fi
    sleep 0.5
  done
fi
curl -sf http://127.0.0.1:$REMOTE_PORT/healthz >/dev/null || { echo "server failed to come up"; exit 1; }
cat ~/.claudecode-web/token
EOF
)

TOKEN=$(ssh -o BatchMode=no -o ConnectTimeout=10 "$REMOTE" "$START_CMD" | tail -n1) || \
  die "Could not start / reach the remote server. Check SSH creds and that $REMOTE_REPO is built."

[[ -z "$TOKEN" ]] && die "Got empty token from remote."

# 2. Set up SSH tunnel via ControlMaster (reuses a single connection, only one auth prompt)
if ! ssh -O check -o ControlPath="$SSH_SOCK" "$REMOTE" >/dev/null 2>&1; then
  say "Opening SSH tunnel on localhost:$LOCAL_PORT …"
  ssh -fN \
    -o ControlMaster=yes \
    -o ControlPath="$SSH_SOCK" \
    -o ControlPersist=10m \
    -o ExitOnForwardFailure=yes \
    -L "$LOCAL_PORT:127.0.0.1:$REMOTE_PORT" \
    "$REMOTE"
else
  say "Reusing existing SSH tunnel."
fi

URL="http://localhost:$LOCAL_PORT/?t=$TOKEN"
say "Opening $URL"

# 3. Open browser (macOS / Linux)
if command -v open >/dev/null 2>&1; then open "$URL"
elif command -v xdg-open >/dev/null 2>&1; then xdg-open "$URL"
else say "Could not auto-open. Paste this into your browser:"; echo "$URL"
fi

say "Done. Tunnel stays up for 10 minutes of idle; re-run this script any time."
