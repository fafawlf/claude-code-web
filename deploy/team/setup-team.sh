#!/usr/bin/env bash
# One-shot, idempotent setup for the multi-user (Feishu) deployment.
# Run as root on the server:
#   bash deploy/team/setup-team.sh
#
# Required env (or edit the defaults below before running):
#   CCW_FEISHU_APP_ID / CCW_FEISHU_APP_SECRET  — Feishu app credentials
# Optional:
#   CCW_ADMIN_EMAILS  — comma-separated Feishu emails that are always admins.
#                       Leave empty to let the FIRST login become admin.
set -euo pipefail

REPO_DIR=${REPO_DIR:-/root/ccw-multiuser}
DATA_DIR=${DATA_DIR:-/srv/ccw}
PORT=${PORT:-8084}
PUBLIC_ORIGIN=${PUBLIC_ORIGIN:-https://claude.fa-fa.ai}
BRANCH=${BRANCH:-multi-user}
ENV_FILE="$DATA_DIR/ccw.env"

echo "==> 1/5 data dir + shared scaffolding"
mkdir -p "$DATA_DIR/template" "$DATA_DIR/users"
chmod 700 "$DATA_DIR"
if [ ! -f "$DATA_DIR/CLAUDE.md" ]; then
  cat > "$DATA_DIR/CLAUDE.md" <<'EOF'
# 团队共享工作区 — Claude Code Web

这份文件是 /srv/ccw/users/ 下所有同事 workspace 的共享上下文（按目录层级自动加载）。

## 使用约定
- 你的 workspace 在 /srv/ccw/users/<你的名字>/，每个项目放一个子目录
- 共享 skills 在 ~/.claude/skills，全团队可用；个人 skill 放在自己项目的 .claude/skills/ 里
- 大家共用一份 Claude Max 订阅：右上角用量条对所有人可见，跑大任务前先看一眼余量
- 不要读写其他同事的 workspace（/srv/ccw/users/ 下别人的目录）

## 团队上下文
- （管理员可在此补充：常用数据表、内部服务、业务背景等）
EOF
fi
if [ ! -f "$DATA_DIR/template/CLAUDE.md" ]; then
  cat > "$DATA_DIR/template/CLAUDE.md" <<'EOF'
# 我的 workspace

这是你的个人 Claude Code 工作区。建议：
- 每个项目建一个文件夹，再在项目里开会话
- 想要自己的 skill：在项目里建 .claude/skills/<skill-name>/SKILL.md
- 上传的文件存放在项目的 .claudecode-web/uploads/ 下
EOF
fi

echo "==> 2/5 clone + build ($BRANCH)"
if [ ! -d "$REPO_DIR/.git" ]; then
  git clone -b "$BRANCH" https://github.com/fafawlf/claude-code-web.git "$REPO_DIR"
else
  git -C "$REPO_DIR" fetch origin "$BRANCH"
  git -C "$REPO_DIR" checkout "$BRANCH"
  git -C "$REPO_DIR" reset --hard "origin/$BRANCH"
fi
cd "$REPO_DIR"
npm ci
npm run build

echo "==> 3/5 env file"
if [ ! -f "$ENV_FILE" ]; then
  : "${CCW_FEISHU_APP_ID:?set CCW_FEISHU_APP_ID}"
  : "${CCW_FEISHU_APP_SECRET:?set CCW_FEISHU_APP_SECRET}"
  umask 077
  cat > "$ENV_FILE" <<EOF
CCW_AUTH_MODE=feishu
CCW_COOKIE_SECRET=$(openssl rand -hex 32)
CCW_FEISHU_APP_ID=$CCW_FEISHU_APP_ID
CCW_FEISHU_APP_SECRET=$CCW_FEISHU_APP_SECRET
CCW_PUBLIC_ORIGIN=$PUBLIC_ORIGIN
CCW_DATA_DIR=$DATA_DIR
CCW_ADMIN_EMAILS=${CCW_ADMIN_EMAILS:-}
CCW_ALLOWED_EMAIL_DOMAINS=${CCW_ALLOWED_EMAIL_DOMAINS:-}
CLAUDECODE_WEB_TOKEN=$(cat /root/.claudecode-web/token 2>/dev/null || openssl rand -hex 32)
EOF
  echo "    wrote $ENV_FILE"
else
  echo "    $ENV_FILE exists, leaving as is"
fi

echo "==> 4/5 systemd unit"
cat > /etc/systemd/system/ccw-multiuser.service <<EOF
[Unit]
Description=Claude Code Web (team, feishu auth)
After=network.target

[Service]
Type=simple
WorkingDirectory=$REPO_DIR
EnvironmentFile=$ENV_FILE
ExecStart=$(command -v node) $REPO_DIR/server/dist/bin/claudecode-web.js --host 127.0.0.1 --port $PORT --cwd $DATA_DIR/users
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF
systemctl daemon-reload
systemctl enable ccw-multiuser.service
systemctl restart ccw-multiuser.service
sleep 1
systemctl --no-pager --lines=5 status ccw-multiuser.service || true

echo "==> 5/5 nginx site (http only; run certbot after DNS exists)"
HOST=$(echo "$PUBLIC_ORIGIN" | sed -E 's#https?://##')
if [ ! -f "/etc/nginx/sites-available/$HOST" ]; then
  cat > "/etc/nginx/sites-available/$HOST" <<EOF
server {
    listen 80;
    server_name $HOST;

    client_max_body_size 80m;

    location / {
        proxy_pass http://127.0.0.1:$PORT;
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
}
EOF
  ln -sf "/etc/nginx/sites-available/$HOST" "/etc/nginx/sites-enabled/$HOST"
  nginx -t && systemctl reload nginx
else
  echo "    nginx site exists, leaving as is"
fi

echo ""
echo "Done. Next steps:"
echo "  1. DNS: add an A record  $HOST -> this server's IP"
echo "  2. TLS: certbot --nginx -d $HOST   (after DNS resolves)"
echo "  3. Feishu console: add redirect URI  $PUBLIC_ORIGIN/auth/callback"
echo "  4. Open $PUBLIC_ORIGIN and log in (first login becomes admin unless CCW_ADMIN_EMAILS is set)"
