#!/usr/bin/env bash
# Blue/green deployment helper for the Feishu multi-user service.
#
# Usage on the server:
#   blue-green.sh candidate <git-ref>
#   blue-green.sh canary
#   CONFIRM_IDLE=1 blue-green.sh promote
#   blue-green.sh rollback
#   CONFIRM_IDLE=1 blue-green.sh drain
#   blue-green.sh status
set -euo pipefail

COMMAND=${1:-status}
RELEASE_REF=${2:-}

REPO_DIR=${REPO_DIR:-/root/ccw-multiuser}
RELEASES_DIR=${RELEASES_DIR:-/srv/ccw/releases}
DEPLOY_STATE_DIR=${DEPLOY_STATE_DIR:-/srv/ccw/deploy}
DATA_DIR=${DATA_DIR:-/srv/ccw}
ENV_FILE=${ENV_FILE:-$DATA_DIR/ccw.env}
HOST=${HOST:-claude.fa-fa.ai}
STABLE_PORT=${STABLE_PORT:-8084}
CANDIDATE_PORT=${CANDIDATE_PORT:-8085}
STABLE_SERVICE=${STABLE_SERVICE:-ccw-multiuser.service}
CANDIDATE_SERVICE=${CANDIDATE_SERVICE:-ccw-multiuser-candidate.service}
SITE_FILE=${SITE_FILE:-/etc/nginx/sites-available/$HOST}
CANDIDATE_STATE=$DEPLOY_STATE_DIR/candidate.env
PROMOTION_STATE=$DEPLOY_STATE_DIR/promotion.env

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "Run as root." >&2
    exit 1
  fi
}

require_candidate() {
  if [ ! -f "$CANDIDATE_STATE" ]; then
    echo "No candidate is recorded. Run: $0 candidate <git-ref>" >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  source "$CANDIDATE_STATE"
}

validate_cookie() {
  case "$1" in
    ''|*[!A-Za-z0-9._-]*)
      echo "Unsafe canary cookie value." >&2
      exit 1
      ;;
  esac
}

validate_git_ref() {
  case "$1" in
    ''|*[!A-Za-z0-9._/-]*)
      echo "Unsafe git ref." >&2
      exit 1
      ;;
  esac
}

health_json() {
  curl --fail --silent --show-error --max-time 5 "http://127.0.0.1:$1/healthz"
}

wait_for_health() {
  local port=$1
  local expected_sha=$2
  local response=''
  for _ in $(seq 1 30); do
    if response=$(health_json "$port" 2>/dev/null); then
      if node -e '
        const body = JSON.parse(process.argv[1]);
        if (body?.ok !== true || body?.build?.commit !== process.argv[2]) process.exit(1);
      ' "$response" "$expected_sha"; then
        echo "$response"
        return 0
      fi
    fi
    sleep 1
  done
  echo "Candidate health check failed on port $port." >&2
  return 1
}

render_nginx() {
  local default_port=$1
  local canary_port=$2
  local canary_cookie=$3
  local tmp
  validate_cookie "$canary_cookie"
  tmp=$(mktemp)

  cat > "$tmp" <<EOF
server {
    server_name $HOST;
    client_max_body_size 100m;

    set \$ccw_backend http://127.0.0.1:$default_port;
    if (\$cookie_ccw_canary = "$canary_cookie") {
        set \$ccw_backend http://127.0.0.1:$canary_port;
    }

    location = /__ccw_canary {
        if (\$arg_key != "$canary_cookie") { return 404; }
        add_header Set-Cookie "ccw_canary=$canary_cookie; Path=/; Secure; HttpOnly; SameSite=Lax" always;
        return 302 /;
    }

    location = /__ccw_stable {
        add_header Set-Cookie "ccw_canary=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax" always;
        return 302 /;
    }

    location / {
        proxy_pass \$ccw_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600;
        proxy_send_timeout 3600;
        proxy_buffering off;
    }

    listen 443 ssl;
    ssl_certificate /etc/letsencrypt/live/$HOST/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$HOST/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;
}

server {
    listen 80;
    server_name $HOST;
    return 301 https://\$host\$request_uri;
}
EOF

  mkdir -p "$DEPLOY_STATE_DIR"
  if [ -f "$SITE_FILE" ]; then
    cp -p "$SITE_FILE" "$DEPLOY_STATE_DIR/nginx-$(date -u +%Y%m%dT%H%M%SZ).conf"
  fi
  nginx -t -c /etc/nginx/nginx.conf
  install -m 0644 "$tmp" "$SITE_FILE"
  if ! nginx -t; then
    echo "Generated nginx configuration is invalid; restoring the previous file." >&2
    local latest
    latest=$(find "$DEPLOY_STATE_DIR" -maxdepth 1 -name 'nginx-*.conf' -type f | sort | tail -1)
    [ -n "$latest" ] && install -m 0644 "$latest" "$SITE_FILE"
    rm -f "$tmp"
    exit 1
  fi
  systemctl reload nginx
  rm -f "$tmp"
}

deploy_candidate() {
  if [ -z "$RELEASE_REF" ]; then
    echo "Usage: $0 candidate <git-ref>" >&2
    exit 1
  fi
  if [ ! -d "$REPO_DIR/.git" ]; then
    echo "Missing source repository at $REPO_DIR." >&2
    exit 1
  fi
  if [ ! -f "$ENV_FILE" ]; then
    echo "Missing environment file at $ENV_FILE." >&2
    exit 1
  fi
  validate_git_ref "$RELEASE_REF"

  git -C "$REPO_DIR" fetch --prune origin
  local sha
  sha=$(git -C "$REPO_DIR" rev-parse "$RELEASE_REF^{commit}")
  local release_dir=$RELEASES_DIR/$sha
  local build_time
  build_time=$(date -u +%Y-%m-%dT%H:%M:%SZ)

  if [ -d "$release_dir" ] && [ ! -f "$release_dir/server/dist/bin/claudecode-web.js" ]; then
    echo "Incomplete release already exists at $release_dir; inspect and remove it before retrying." >&2
    exit 1
  fi

  if [ ! -f "$release_dir/server/dist/bin/claudecode-web.js" ]; then
    local staging=$RELEASES_DIR/.staging-$sha-$$
    rm -rf "$staging"
    mkdir -p "$staging"
    git -C "$REPO_DIR" archive "$sha" | tar -x -C "$staging"
    (
      cd "$staging"
      npm ci
      npm test
      npm run build
    )
    mv "$staging" "$release_dir"
  fi

  local unit_tmp
  unit_tmp=$(mktemp)
  cat > "$unit_tmp" <<EOF
[Unit]
Description=Claude Code Web candidate ($sha)
After=network.target

[Service]
Type=simple
WorkingDirectory=$release_dir
EnvironmentFile=$ENV_FILE
Environment=CCW_BUILD_SHA=$sha
Environment=CCW_BUILD_BRANCH=$RELEASE_REF
Environment=CCW_BUILD_TIME=$build_time
ExecStart=/usr/bin/node $release_dir/server/dist/bin/claudecode-web.js --host 127.0.0.1 --port $CANDIDATE_PORT --cwd $DATA_DIR/users
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  install -m 0644 "$unit_tmp" "/etc/systemd/system/$CANDIDATE_SERVICE"
  rm -f "$unit_tmp"
  systemctl daemon-reload
  systemctl enable --now "$CANDIDATE_SERVICE"
  systemctl restart "$CANDIDATE_SERVICE"
  wait_for_health "$CANDIDATE_PORT" "$sha"

  mkdir -p "$DEPLOY_STATE_DIR"
  local cookie=qa-${sha:0:12}
  cat > "$CANDIDATE_STATE" <<EOF
CANDIDATE_SHA=$sha
CANDIDATE_REF=$RELEASE_REF
CANDIDATE_RELEASE=$release_dir
CANDIDATE_COOKIE=$cookie
CANDIDATE_STARTED_AT=$(date +%s)
EOF
  chmod 0600 "$CANDIDATE_STATE"
  echo "Candidate ready on port $CANDIDATE_PORT. Enable routing with: $0 canary"
}

enable_canary() {
  require_candidate
  render_nginx "$STABLE_PORT" "$CANDIDATE_PORT" "$CANDIDATE_COOKIE"
  echo "Canary route enabled: https://$HOST/__ccw_canary?key=$CANDIDATE_COOKIE"
}

promote_candidate() {
  require_candidate
  if [ "${CONFIRM_IDLE:-}" != "1" ]; then
    echo "Confirm there are no running tasks, then run: CONFIRM_IDLE=1 $0 promote" >&2
    exit 1
  fi
  wait_for_health "$CANDIDATE_PORT" "$CANDIDATE_SHA" >/dev/null
  local rollback_cookie=rollback-${CANDIDATE_SHA:0:12}
  render_nginx "$CANDIDATE_PORT" "$STABLE_PORT" "$rollback_cookie"
  cat > "$PROMOTION_STATE" <<EOF
PROMOTED_SHA=$CANDIDATE_SHA
PROMOTED_AT=$(date +%s)
ROLLBACK_COOKIE=$rollback_cookie
EOF
  chmod 0600 "$PROMOTION_STATE"
  echo "Candidate promoted for new connections. Old WebSockets remain on port $STABLE_PORT while they drain."
}

rollback_candidate() {
  require_candidate
  render_nginx "$STABLE_PORT" "$CANDIDATE_PORT" "$CANDIDATE_COOKIE"
  rm -f "$PROMOTION_STATE"
  echo "New connections rolled back to port $STABLE_PORT. Candidate remains available through its canary cookie."
}

drain_stable() {
  if [ "${CONFIRM_IDLE:-}" != "1" ]; then
    echo "Confirm there are no old-server tasks, then run: CONFIRM_IDLE=1 $0 drain" >&2
    exit 1
  fi
  if [ ! -f "$PROMOTION_STATE" ]; then
    echo "No active promotion is recorded." >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  source "$PROMOTION_STATE"
  local age=$(( $(date +%s) - PROMOTED_AT ))
  if [ "$age" -lt 1800 ]; then
    echo "Keep the old service for at least 30 minutes; $((1800 - age)) seconds remain." >&2
    exit 1
  fi
  systemctl stop "$STABLE_SERVICE"
  echo "Old stable service stopped after the drain window. Rollback now requires restarting $STABLE_SERVICE first."
}

show_status() {
  echo "stable-service=$(systemctl is-active "$STABLE_SERVICE" 2>/dev/null || true)"
  echo "candidate-service=$(systemctl is-active "$CANDIDATE_SERVICE" 2>/dev/null || true)"
  echo "stable-health=$(health_json "$STABLE_PORT" 2>/dev/null || echo unavailable)"
  echo "candidate-health=$(health_json "$CANDIDATE_PORT" 2>/dev/null || echo unavailable)"
  [ -f "$CANDIDATE_STATE" ] && sed -n '1,20p' "$CANDIDATE_STATE"
  [ -f "$PROMOTION_STATE" ] && sed -n '1,20p' "$PROMOTION_STATE"
}

require_root
case "$COMMAND" in
  candidate) deploy_candidate ;;
  canary) enable_canary ;;
  promote) promote_candidate ;;
  rollback) rollback_candidate ;;
  drain) drain_stable ;;
  status) show_status ;;
  *)
    echo "Unknown command: $COMMAND" >&2
    exit 2
    ;;
esac
