# Laptop-side launchers

One-time setup so you never have to SSH manually again.

## First-time setup on the remote machine

```bash
cd ~/
git clone https://github.com/fafawlf/claude-code-web.git claudecode
cd claudecode
npm install
npm run build -w web
npx tsc -p server/tsconfig.json
```

(Credentials: if `claude login` already works on this box, the web UI uses
the same credentials automatically — no `ANTHROPIC_API_KEY` required.)

## One-time setup on your laptop

**SSH keys**: make sure `ssh user@remote` works **without a password prompt**.
If it prompts, set up an SSH key first:

```bash
# on laptop
ssh-keygen -t ed25519            # press enter for defaults
ssh-copy-id user@remote          # then enter remote password ONCE
ssh user@remote "echo ok"         # should say "ok" with no prompt
```

Then download the launcher for your OS and edit the first few lines:

### macOS / Linux laptop

1. Download [`claude-web.sh`](./claude-web.sh)
2. Open it in any editor, edit the `REMOTE`, `REMOTE_REPO`, `PROJECT` lines at the top
3. Make it executable:

   ```bash
   chmod +x ~/Downloads/claude-web.sh
   ```
4. (macOS) Rename to `claude-web.command` so you can double-click it from Finder.

### Windows laptop

1. Download [`claude-web.bat`](./claude-web.bat)
2. Right-click → Edit, edit the `REMOTE`, `REMOTE_REPO`, `PROJECT` lines
3. Double-click `claude-web.bat`. First run may need "Run anyway" on SmartScreen.

   (Requires built-in OpenSSH: Settings → Apps → Optional features → OpenSSH Client.
   It's on by default in Windows 10/11.)

## Daily use

Double-click the script. It:
1. SSHes to your remote machine
2. Starts `claudecode-web` in a `tmux` session if it isn't already running
3. Fetches the auth token
4. Opens an SSH tunnel on `localhost:8080` in the background
5. Opens your browser at `http://localhost:8080/?t=<token>`

Takes 1–3 seconds end-to-end.

## Tearing down

- Browser tab: just close it.
- SSH tunnel: on macOS/Linux the ControlMaster times out after 10 min idle; or kill explicitly:

   ```bash
   ssh -O exit user@remote    # if using ControlMaster socket
   ```
   On Windows, close the minimized "claude-web tunnel" window.
- Remote server: it stays up indefinitely inside `tmux` (survives SSH disconnects). To stop:

   ```bash
   ssh user@remote 'tmux kill-session -t ccw'
   ```

## Changing the project Claude works in

Edit the `PROJECT` line in the script and then:

```bash
ssh user@remote 'tmux kill-session -t ccw'   # next launch will start it in the new dir
```
