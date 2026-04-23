# claudecode-web

A tiny self-hosted web UI for driving Claude Code on a remote machine — when
you can't install Claude Code locally and don't want to route traffic through
`claude.ai`.

- Runs on the remote box where Claude Code can already run
- Your laptop opens a browser tab over an **SSH tunnel** — no new ports
  exposed, no third-party relay
- The only outbound Anthropic traffic is the same one Claude Code already
  makes: from the remote machine to `api.anthropic.com`

## Install (on the remote machine)

Requires Node 20+.

```bash
git clone <this repo> claudecode-web
cd claudecode-web
npm install
npm run build
```

Make sure `ANTHROPIC_API_KEY` (or `claude login` credentials in
`~/.claude`) is set in the shell where you launch the server, same as
you'd set it for the `claude` CLI.

## Zero-SSH daily use (recommended)

Once the remote is built (above) and SSH-key login works, grab the right
launcher from [`launcher/`](./launcher/) and run it from your laptop. It
auto-starts the remote server inside `tmux`, sets up the tunnel, and opens
your browser — one double-click, 1–3 seconds. See [launcher/README.md](./launcher/README.md).

## Manual use

On the remote machine, in the directory you want Claude to work in:

```bash
node ./server/dist/bin/claudecode-web.js
```

You'll see:

```
  claudecode-web listening on 127.0.0.1:8080
  project: /path/you/launched/from

  On your laptop:
    ssh -L 8080:127.0.0.1:8080 <your-user>@<your-remote-host>

  Then open:
    http://localhost:8080/?t=<token>
```

Copy the URL into your browser. The token is remembered in `sessionStorage`
for that tab; you can reload the page without pasting it again.

### Running across SSH disconnects

`claudecode-web` is a foreground process. If you want it to survive a dropped
SSH session, run it under `tmux` or `systemd --user`:

```bash
tmux new -d -s ccw 'cd ~/my-project && node /path/to/claudecode-web/server/dist/bin/claudecode-web.js'
```

### Options

```
  --port, -p <n>   Port to bind (default 8080)
  --host <addr>    Bind address (default 127.0.0.1 — leave it)
  --cwd <path>     Default project directory (default: process.cwd())
```

## Security model

- The server binds to **127.0.0.1 only**. Public network cannot reach it.
- A random 32-byte token is generated on first run and stored at
  `~/.claudecode-web/token` (mode 0600). It's required on every request
  and WS connection.
- All browser ↔ server traffic travels inside the SSH tunnel, which is
  already encrypted. No TLS termination is needed on the server.
- The token is what prevents another user on the same remote box from
  hijacking your session (since loopback is shared).
- **Not designed for multi-user.** One token, one user.

## What it supports (v1)

- Streaming assistant output with Stop
- Tool-use rendering (Bash/Read/Edit/Grep/Glob — inputs and outputs)
- Permission prompts with **Allow once / Allow for session / Deny**
- Resume prior sessions (reads Claude Code's own session store)
- Up to 3 concurrent sessions; browser tab reconnect replays buffered events

## Deferred

- Full file tree and diff viewer (tool inputs currently render as JSON)
- Mobile layout, slash-command palette, keybinding parity with the TUI
- Multi-user, non-loopback binding, HTTPS

## Layout

```
server/                  Node/Fastify backend
  src/
    bin/claudecode-web.ts  launcher CLI
    index.ts               server bootstrap
    ws.ts                  WebSocket protocol
    api.ts                 REST (/api/sessions)
    session/
      ClaudeSession.ts     wraps @anthropic-ai/claude-agent-sdk
      SessionManager.ts    concurrent-session registry
    permissions/
      PermissionBroker.ts  bridges SDK canUseTool → browser
    auth.ts, paths.ts, protocol.ts
web/                     Vite + React + Tailwind SPA
  src/
    App.tsx, ws.ts, reducer.ts
    components/*
```

## Why not `claude.ai/code` Remote Control?

Remote Control works great *if your browser can reach `claude.ai`*. From
regions where `claude.ai` is restricted, routing a browser through it can
get your account flagged. This tool keeps all browser traffic inside the
SSH tunnel — `api.anthropic.com` is only ever called from the remote box,
identical to the traffic profile you already have using `claude` over SSH.
