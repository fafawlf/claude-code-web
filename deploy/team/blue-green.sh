#!/usr/bin/env bash
# Repeatable two-slot blue/green deployment for the Feishu multi-user service.
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
BLUE_PORT=${BLUE_PORT:-8084}
GREEN_PORT=${GREEN_PORT:-8085}
LEGACY_SERVICE=${LEGACY_SERVICE:-ccw-multiuser.service}
SITE_FILE=${SITE_FILE:-/etc/nginx/sites-available/$HOST}
ACTIVE_STATE=$DEPLOY_STATE_DIR/active.env
CANDIDATE_STATE=$DEPLOY_STATE_DIR/candidate.env
PROMOTION_STATE=$DEPLOY_STATE_DIR/promotion.env

require_root() {
  if [ "$(id -u)" -ne 0 ]; then
    echo "Run as root." >&2
    exit 1
  fi
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

validate_service() {
  case "$1" in
    ''|*[!A-Za-z0-9@_.-]*)
      echo "Unsafe systemd service name." >&2
      exit 1
      ;;
  esac
}

validate_port() {
  case "$1" in
    "$BLUE_PORT"|"$GREEN_PORT") ;;
    *)
      echo "Port $1 is not a configured deployment slot." >&2
      exit 1
      ;;
  esac
}

load_active() {
  ACTIVE_PORT=$BLUE_PORT
  ACTIVE_SERVICE=$LEGACY_SERVICE
  ACTIVE_SHA=legacy
  ACTIVE_REF=multi-user
  ACTIVE_RELEASE=$REPO_DIR
  if [ -f "$ACTIVE_STATE" ]; then
    # shellcheck disable=SC1090
    source "$ACTIVE_STATE"
  fi
  validate_port "$ACTIVE_PORT"
  validate_service "$ACTIVE_SERVICE"
}

require_candidate() {
  if [ ! -f "$CANDIDATE_STATE" ]; then
    echo "No candidate is recorded. Run: $0 candidate <git-ref>" >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  source "$CANDIDATE_STATE"
  validate_port "$CANDIDATE_PORT"
  validate_service "$CANDIDATE_SERVICE"
  validate_cookie "$CANDIDATE_COOKIE"
  validate_cookie "$CANDIDATE_ROLLBACK_COOKIE"
}

slot_service() {
  validate_port "$1"
  echo "ccw-multiuser-slot-$1.service"
}

inactive_port() {
  if [ "$1" = "$BLUE_PORT" ]; then echo "$GREEN_PORT"; else echo "$BLUE_PORT"; fi
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
  echo "Health check failed on port $port for commit $expected_sha." >&2
  return 1
}

random_cookie() {
  local cookie
  cookie=$(openssl rand -hex 24)
  validate_cookie "$cookie"
  echo "$cookie"
}

write_active_state() {
  local port=$1 service=$2 sha=$3 ref=$4 release=$5
  local tmp
  mkdir -p "$DEPLOY_STATE_DIR"
  tmp=$(mktemp "$DEPLOY_STATE_DIR/.active.XXXXXX")
  cat > "$tmp" <<EOF
ACTIVE_PORT=$port
ACTIVE_SERVICE=$service
ACTIVE_SHA=$sha
ACTIVE_REF=$ref
ACTIVE_RELEASE=$release
EOF
  chmod 0600 "$tmp"
  mv "$tmp" "$ACTIVE_STATE"
}

render_nginx() {
  local default_port=$1
  local canary_port=$2
  local canary_cookie=$3
  local auth_port=$4
  local tmp backup=''
  validate_port "$default_port"
  validate_port "$canary_port"
  validate_port "$auth_port"
  validate_cookie "$canary_cookie"
  tmp=$(mktemp)

  cat > "$tmp" <<EOF
server {
    server_name $HOST;
    client_max_body_size 80m;

    set \$ccw_backend http://127.0.0.1:$default_port;
    if (\$cookie_ccw_canary = "$canary_cookie") {
        set \$ccw_backend http://127.0.0.1:$canary_port;
    }

    location = /__ccw_canary {
        proxy_pass http://127.0.0.1:$auth_port;
        proxy_set_header Cookie \$http_cookie;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location = /__ccw_stable {
        add_header Set-Cookie "ccw_canary=; Path=/; Max-Age=0; Secure; HttpOnly; SameSite=Lax" always;
        return 302 /;
    }

    # User-registry mutations always go to the default slot. During a canary
    # this prevents two independently loaded processes from writing users.json.
    location = /auth/callback {
        proxy_pass http://127.0.0.1:$default_port;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location ^~ /api/admin/ {
        proxy_pass http://127.0.0.1:$default_port;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
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
  nginx -t
  if [ -f "$SITE_FILE" ]; then
    backup="$DEPLOY_STATE_DIR/nginx-$(date -u +%Y%m%dT%H%M%S)-$$.conf"
    cp -p "$SITE_FILE" "$backup"
  fi
  install -m 0644 "$tmp" "$SITE_FILE"
  if ! nginx -t; then
    echo "Generated nginx configuration is invalid; restoring the previous file." >&2
    if [ -n "$backup" ]; then install -m 0644 "$backup" "$SITE_FILE"; fi
    nginx -t
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
  validate_git_ref "$RELEASE_REF"
  if [ -f "$PROMOTION_STATE" ]; then
    echo "A previous promotion is still draining. Run drain or rollback before replacing a slot." >&2
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

  load_active
  local candidate_port candidate_service
  candidate_port=$(inactive_port "$ACTIVE_PORT")
  candidate_service=$(slot_service "$candidate_port")
  if [ "$candidate_service" = "$ACTIVE_SERVICE" ]; then
    echo "Refusing to restart the active service." >&2
    exit 1
  fi

  local sha release_dir build_time
  git -C "$REPO_DIR" fetch --prune origin
  if sha=$(git -C "$REPO_DIR" rev-parse "$RELEASE_REF^{commit}" 2>/dev/null); then
    :
  else
    # Production clones may intentionally fetch only multi-user. Explicitly
    # fetch a release branch/ref without widening that persistent refspec.
    git -C "$REPO_DIR" fetch origin "$RELEASE_REF"
    sha=$(git -C "$REPO_DIR" rev-parse 'FETCH_HEAD^{commit}')
  fi
  release_dir=$RELEASES_DIR/$sha

  if [ -d "$release_dir" ] && [ ! -f "$release_dir/server/dist/bin/claudecode-web.js" ]; then
    echo "Incomplete release already exists at $release_dir; inspect and remove it before retrying." >&2
    exit 1
  fi

  if [ ! -f "$release_dir/server/dist/bin/claudecode-web.js" ]; then
    mkdir -p "$RELEASES_DIR"
    local staging
    staging=$(mktemp -d "$RELEASES_DIR/.staging-$sha.XXXXXX")
    git -C "$REPO_DIR" archive "$sha" | tar -x -C "$staging"
    build_time=$(date -u +%Y-%m-%dT%H:%M:%SZ)
    echo "$build_time" > "$staging/.ccw-build-time"
    (
      cd "$staging"
      npm ci
      npm audit --omit=dev
      npm test
      npm run build
    )
    mv "$staging" "$release_dir"
  fi
  build_time=$(cat "$release_dir/.ccw-build-time" 2>/dev/null || date -u +%Y-%m-%dT%H:%M:%SZ)

  local unit_tmp cookie rollback_cookie
  cookie=$(random_cookie)
  rollback_cookie=$(random_cookie)
  unit_tmp=$(mktemp)
  cat > "$unit_tmp" <<EOF
[Unit]
Description=Claude Code Web slot $candidate_port ($sha)
After=network.target

[Service]
Type=simple
WorkingDirectory=$release_dir
EnvironmentFile=$ENV_FILE
Environment="CCW_BUILD_SHA=$sha"
Environment="CCW_BUILD_BRANCH=$RELEASE_REF"
Environment="CCW_BUILD_TIME=$build_time"
Environment="CCW_CANARY_TOKEN=$cookie"
Environment="CCW_ROLLBACK_TOKEN=$rollback_cookie"
ExecStart=/usr/bin/node $release_dir/server/dist/bin/claudecode-web.js --host 127.0.0.1 --port $candidate_port --cwd $DATA_DIR/users
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
  install -m 0644 "$unit_tmp" "/etc/systemd/system/$candidate_service"
  rm -f "$unit_tmp"
  systemctl daemon-reload
  systemctl enable "$candidate_service"
  systemctl restart "$candidate_service"
  wait_for_health "$candidate_port" "$sha"

  mkdir -p "$DEPLOY_STATE_DIR"
  local state_tmp
  state_tmp=$(mktemp "$DEPLOY_STATE_DIR/.candidate.XXXXXX")
  cat > "$state_tmp" <<EOF
CANDIDATE_SHA=$sha
CANDIDATE_REF=$RELEASE_REF
CANDIDATE_RELEASE=$release_dir
CANDIDATE_COOKIE=$cookie
CANDIDATE_ROLLBACK_COOKIE=$rollback_cookie
CANDIDATE_PORT=$candidate_port
CANDIDATE_SERVICE=$candidate_service
CANDIDATE_STARTED_AT=$(date +%s)
EOF
  chmod 0600 "$state_tmp"
  mv "$state_tmp" "$CANDIDATE_STATE"
  echo "Candidate ready on port $candidate_port. Enable routing with: $0 canary"
}

enable_canary() {
  load_active
  require_candidate
  if [ "$CANDIDATE_PORT" = "$ACTIVE_PORT" ] || [ "$CANDIDATE_SERVICE" = "$ACTIVE_SERVICE" ]; then
    echo "Candidate points at the active slot; deploy a new candidate first." >&2
    exit 1
  fi
  wait_for_health "$CANDIDATE_PORT" "$CANDIDATE_SHA" >/dev/null
  render_nginx "$ACTIVE_PORT" "$CANDIDATE_PORT" "$CANDIDATE_COOKIE" "$CANDIDATE_PORT"
  echo "Admin-only canary route enabled: https://$HOST/__ccw_canary?key=$CANDIDATE_COOKIE"
}

write_promotion_state() {
  local phase=$1
  local state_tmp
  state_tmp=$(mktemp "$DEPLOY_STATE_DIR/.promotion.XXXXXX")
  cat > "$state_tmp" <<EOF
PROMOTION_PHASE=$phase
PREVIOUS_PORT=$ACTIVE_PORT
PREVIOUS_SERVICE=$ACTIVE_SERVICE
PREVIOUS_SHA=$ACTIVE_SHA
PREVIOUS_REF=$ACTIVE_REF
PREVIOUS_RELEASE=$ACTIVE_RELEASE
PROMOTED_PORT=$CANDIDATE_PORT
PROMOTED_SERVICE=$CANDIDATE_SERVICE
PROMOTED_SHA=$CANDIDATE_SHA
PROMOTED_REF=$CANDIDATE_REF
PROMOTED_RELEASE=$CANDIDATE_RELEASE
PROMOTED_CANARY_COOKIE=$CANDIDATE_COOKIE
ROLLBACK_COOKIE=$CANDIDATE_ROLLBACK_COOKIE
PROMOTED_AT=$(date +%s)
EOF
  chmod 0600 "$state_tmp"
  mv "$state_tmp" "$PROMOTION_STATE"
}

promote_candidate() {
  if [ "${CONFIRM_IDLE:-}" != "1" ]; then
    echo "Confirm there are no running tasks, then run: CONFIRM_IDLE=1 $0 promote" >&2
    exit 1
  fi
  load_active
  require_candidate
  if [ "$CANDIDATE_PORT" = "$ACTIVE_PORT" ] || [ "$CANDIDATE_SERVICE" = "$ACTIVE_SERVICE" ]; then
    echo "Candidate is already active." >&2
    exit 1
  fi
  wait_for_health "$CANDIDATE_PORT" "$CANDIDATE_SHA" >/dev/null

  # Record a recoverable transaction before changing live routing. If this
  # process is interrupted at any later point, `rollback` has every value it
  # needs to restore the previous upstream.
  write_promotion_state prepared
  render_nginx "$CANDIDATE_PORT" "$ACTIVE_PORT" "$CANDIDATE_ROLLBACK_COOKIE" "$CANDIDATE_PORT"
  write_active_state "$CANDIDATE_PORT" "$CANDIDATE_SERVICE" "$CANDIDATE_SHA" "$CANDIDATE_REF" "$CANDIDATE_RELEASE"
  write_promotion_state complete
  echo "Candidate promoted for new connections. Old WebSockets remain on port $ACTIVE_PORT while they drain."
}

rollback_candidate() {
  if [ ! -f "$PROMOTION_STATE" ]; then
    load_active
    require_candidate
    render_nginx "$ACTIVE_PORT" "$CANDIDATE_PORT" "$CANDIDATE_COOKIE" "$CANDIDATE_PORT"
    echo "Default routing remains on port $ACTIVE_PORT; candidate is still available to admins."
    return
  fi

  # shellcheck disable=SC1090
  source "$PROMOTION_STATE"
  validate_port "$PREVIOUS_PORT"
  validate_port "$PROMOTED_PORT"
  validate_service "$PREVIOUS_SERVICE"
  validate_service "$PROMOTED_SERVICE"
  validate_cookie "$PROMOTED_CANARY_COOKIE"
  if [ "$(systemctl is-active "$PREVIOUS_SERVICE" 2>/dev/null || true)" != "active" ]; then
    systemctl start "$PREVIOUS_SERVICE"
  fi
  health_json "$PREVIOUS_PORT" >/dev/null
  render_nginx "$PREVIOUS_PORT" "$PROMOTED_PORT" "$PROMOTED_CANARY_COOKIE" "$PROMOTED_PORT"
  write_active_state "$PREVIOUS_PORT" "$PREVIOUS_SERVICE" "$PREVIOUS_SHA" "$PREVIOUS_REF" "$PREVIOUS_RELEASE"
  rm -f "$PROMOTION_STATE"
  echo "New connections rolled back to port $PREVIOUS_PORT. The promoted build remains admin-canaryable."
}

drain_previous() {
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
  load_active
  if [ "$ACTIVE_SERVICE" != "$PROMOTED_SERVICE" ] || [ "$ACTIVE_PORT" != "$PROMOTED_PORT" ]; then
    echo "Promotion state does not match the active slot; refusing to stop anything." >&2
    exit 1
  fi
  local age=$(( $(date +%s) - PROMOTED_AT ))
  if [ "$age" -lt 1800 ]; then
    echo "Keep the old service for at least 30 minutes; $((1800 - age)) seconds remain." >&2
    exit 1
  fi
  if [ "$PREVIOUS_SERVICE" = "$ACTIVE_SERVICE" ]; then
    echo "Refusing to stop the active service." >&2
    exit 1
  fi
  local retired_cookie
  retired_cookie=$(random_cookie)
  render_nginx "$ACTIVE_PORT" "$ACTIVE_PORT" "$retired_cookie" "$ACTIVE_PORT"
  systemctl stop "$PREVIOUS_SERVICE"
  rm -f "$PROMOTION_STATE" "$CANDIDATE_STATE"
  echo "Previous service $PREVIOUS_SERVICE stopped after the drain window. The inactive slot is ready for the next release."
}

show_status() {
  load_active
  echo "active-port=$ACTIVE_PORT"
  echo "active-service=$ACTIVE_SERVICE"
  echo "active-sha=$ACTIVE_SHA"
  echo "legacy-service=$(systemctl is-active "$LEGACY_SERVICE" 2>/dev/null || true)"
  echo "blue-service=$(systemctl is-active "$(slot_service "$BLUE_PORT")" 2>/dev/null || true)"
  echo "green-service=$(systemctl is-active "$(slot_service "$GREEN_PORT")" 2>/dev/null || true)"
  echo "blue-health=$(health_json "$BLUE_PORT" 2>/dev/null || echo unavailable)"
  echo "green-health=$(health_json "$GREEN_PORT" 2>/dev/null || echo unavailable)"
  [ -f "$CANDIDATE_STATE" ] && sed -n '1,20p' "$CANDIDATE_STATE"
  [ -f "$PROMOTION_STATE" ] && sed -n '1,30p' "$PROMOTION_STATE"
}

if [ "${CCW_DEPLOY_LIB_ONLY:-}" != "1" ]; then
  require_root
  case "$COMMAND" in
    candidate) deploy_candidate ;;
    canary) enable_canary ;;
    promote) promote_candidate ;;
    rollback) rollback_candidate ;;
    drain) drain_previous ;;
    status) show_status ;;
    *)
      echo "Unknown command: $COMMAND" >&2
      exit 2
      ;;
  esac
fi
