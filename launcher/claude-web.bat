@echo off
:: claude-web launcher (Windows)
:: Requires: OpenSSH client (built into Windows 10/11). Double-click to run.

setlocal enabledelayedexpansion

:: === Edit these once =========================================================
set "REMOTE=user@your-remote-host"
set "REMOTE_REPO=~/claudecode"
set "PROJECT=~/"
set "LOCAL_PORT=8080"
set "REMOTE_PORT=8080"
:: =============================================================================

set "TMUX_SESSION=ccw"

if "%REMOTE%"=="user@your-remote-host" (
  echo Edit this file first - set REMOTE to your SSH target.
  pause
  exit /b 1
)

where ssh >nul 2>&1
if errorlevel 1 (
  echo OpenSSH not found. Install via: Settings - Apps - Optional features - OpenSSH Client
  pause
  exit /b 1
)

echo [claude-web] Ensuring server is running on %REMOTE% ...

set "START_CMD=if ! tmux has-session -t %TMUX_SESSION% 2^>/dev/null; then tmux new-session -d -s %TMUX_SESSION% ""cd %PROJECT% ^&^& node %REMOTE_REPO%/server/dist/bin/claudecode-web.js --port %REMOTE_PORT%""; for i in 1 2 3 4 5 6 7 8 9 10; do curl -sf http://127.0.0.1:%REMOTE_PORT%/healthz ^>/dev/null 2^>^&1 ^&^& break; sleep 0.5; done; fi; curl -sf http://127.0.0.1:%REMOTE_PORT%/healthz ^>/dev/null ^|^| exit 1; cat ~/.claudecode-web/token"

for /f "usebackq delims=" %%T in (`ssh -o ConnectTimeout=10 %REMOTE% "%START_CMD%"`) do set "TOKEN=%%T"

if "!TOKEN!"=="" (
  echo [claude-web] Could not get token. Check SSH creds and that %REMOTE_REPO% is built on remote.
  pause
  exit /b 1
)

echo [claude-web] Opening SSH tunnel on localhost:%LOCAL_PORT% (background) ...
start "claude-web tunnel" /min ssh -N -L %LOCAL_PORT%:127.0.0.1:%REMOTE_PORT% %REMOTE%

:: Give the tunnel a beat to come up
timeout /t 2 /nobreak >nul

set "URL=http://localhost:%LOCAL_PORT%/?t=!TOKEN!"
echo [claude-web] Opening %URL%
start "" "!URL!"

echo [claude-web] Done. A minimized terminal window keeps the tunnel alive. Close it to disconnect.
