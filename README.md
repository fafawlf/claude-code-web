# Claude Code Web

A self-hosted web workspace for Claude Code.

Claude Code is excellent in a terminal, but not every workflow fits a TUI:

- You cannot use the local Claude Code desktop/client experience, but you can SSH
  into a machine where Claude Code works.
- You like the power of the TUI, but want a browser UI that is easier to read,
  copy from, upload files into, and recover after refreshes.
- You do not love the default Claude Code UI and want a skinnable interface with
  different visual personalities.

Claude Code Web runs next to Claude Code on your local machine or remote server.
Your browser talks to it over localhost or an SSH tunnel. Claude itself still
runs on the machine where the server is started.

This is an independent open-source project and is not affiliated with Anthropic.

## Highlights

- Web chat UI for local or remote Claude Code
- Experimental local Codex provider, selectable from the same top bar
- Project launcher with recent and pinned projects
- Markdown rendering, copyable code blocks, prompt history, smooth streaming
- Upload files and images by picker, paste, or drag/drop
- Download/open generated files from assistant messages
- Diff cards for edits and writes, with approve/reject controls
- Plan mode and permission prompts
- Background activity badge for live sessions that need attention
- Browser reconnect with event replay
- Viewer mode for historical sessions, with explicit takeover
- Component-level skins: Warm, Cyberpunk, DevChat, Catgirl, and Emochi

## Install

Requirements:

- Node.js 20+
- Claude Code available on the machine running the server
- Claude Code auth already configured, either by `claude login` or the same
  environment variables you use with the Claude CLI
- Optional: Codex CLI available on the machine running the server if you want
  the Codex provider in the engine picker

```bash
git clone https://github.com/fafawlf/claude-code-web.git
cd claude-code-web
npm install
npm run build
```

## Local Usage

Use this when Claude Code works on your own computer.

```bash
cd ~/your-project
node /path/to/claude-code-web/server/dist/bin/claudecode-web.js
```

Open the URL printed by the server. It includes a local auth token:

```text
http://localhost:8080/?t=<token>
```

## Remote Usage

Use this when Claude Code works on a remote machine but your local machine
cannot run it comfortably.

On the remote machine:

```bash
cd ~/your-project
node /path/to/claude-code-web/server/dist/bin/claudecode-web.js
```

The server binds to `127.0.0.1` by default. From your laptop, open an SSH
tunnel:

```bash
ssh -L 8080:127.0.0.1:8080 <user>@<remote-host>
```

Then open the tokenized URL printed by the server:

```text
http://localhost:8080/?t=<token>
```

### Launcher Scripts

The [`launcher/`](./launcher/) folder contains optional laptop-side launchers
for macOS/Linux and Windows. They can:

1. SSH into the remote machine
2. Start the web server in `tmux`
3. Fetch the local token
4. Open the SSH tunnel
5. Open your browser

Edit the placeholder remote host and project path in the launcher before use.
Do not commit real SSH hosts, usernames, or tokens.

## CLI Options

```text
--port, -p <n>   Port to bind, default 8080
--host <addr>    Bind address, default 127.0.0.1
--cwd <path>     Default project directory, default current directory
--help, -h       Show help
```

Keep `--host` on `127.0.0.1` unless you are deliberately putting another
trusted access layer in front of the server.

## Nodes And Engines

Claude Code Web now has a node/engine selector in the top bar. Today:

- `This machine · Claude Code` runs Claude Code on the machine hosting this
  web server.
- `This machine · Codex` appears when the server can find `codex` on `PATH` or
  `CODEX_PATH`.
- Extra SSH nodes can be described with `CCW_NODES_JSON`, but remote execution
  is still guarded behind the next architecture step. Configured SSH host/user
  details are not returned by the public `/api/nodes` response.

Example SSH node config shape:

```bash
export CCW_NODES_JSON='{
  "nodes": [
    {
      "id": "do",
      "label": "DO workspace",
      "kind": "ssh",
      "defaultCwd": "/root/workspace",
      "providers": ["claude", "codex"],
      "ssh": { "host": "your-host", "user": "your-user", "port": 22 }
    }
  ]
}'
```

Do not commit real node configs, hostnames, tokens, or keys.

## Security Model

Claude Code Web is built for a single user over localhost or an SSH tunnel.

- The server binds to `127.0.0.1` by default.
- A random token is generated on first run and stored at
  `~/.claudecode-web/token` with mode `0600`.
- Every REST and WebSocket request requires the token.
- Remote use should happen through SSH port forwarding, not by exposing the
  server directly to the public internet.
- The app can read, edit, create, and delete files in projects that Claude Code
  can access. Treat it with the same trust level as the Claude Code CLI.
- It is not designed for multi-user collaboration yet.

Before publishing forks, check that you did not commit:

- SSH hostnames, IP addresses, usernames, or private keys
- Claude or Anthropic API keys/tokens
- `.claudecode-web/`, `.claude/`, generated uploads, or personal transcripts

## Skins

Skins are component-level themes, not just color swaps. They can change:

- Empty state copy and suggestions
- Status text such as thinking, writing, approval, and tool running states
- Message bubble styling and avatars
- Sidebar, top bar, activity badge, and composer styling

Current skins:

- Warm Dusk: default focused workspace
- Cyberpunk: neon terminal deck
- DevChat: chat app style with a WeChat-inspired mark
- Catgirl: playful pastel skin
- Emochi: bold black/yellow Mochi skin with bundled logo

Skins do not inject persona prompts into Claude. They only affect the web UI.

## Roadmap

- Full SSH node execution/proxying, so one UI can switch between laptop and
  remote workspaces
- Deeper Codex parity: history browsing, approvals, and richer tool events
- Right sidebar for webpage previews and file rendering
- Mobile version
- Richer file explorer and file tree
- More command parity with Claude Code slash commands
- Optional notifications for background activity

## Development

```bash
npm install
npm test
npm run build
```

Useful scripts:

```bash
npm run dev:server
npm run dev:web
```

Project layout:

```text
server/   Fastify backend, WebSocket protocol, Claude session lifecycle
web/      Vite + React + Tailwind client
launcher/ Optional laptop-side SSH launchers
design/   Design notes and tokens
```

## License

MIT. See [LICENSE](./LICENSE).
