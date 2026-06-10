#!/usr/bin/env bash
# Sync the shared scaffolding on the team server: the flowgpt-context business
# library plus the shared CLAUDE.md that points agents at it. Idempotent.
# Run as root ON THE SERVER:
#   bash deploy/team/sync-scaffold.sh
#
# Requires gh to be authenticated as an account that can read the private
# flowgpt-context repo (already the case on this droplet).
set -euo pipefail

DATA_DIR=${DATA_DIR:-/srv/ccw}
CTX="$DATA_DIR/flowgpt-context"
CTX_REPO=${CTX_REPO:-fafawlf/flowgpt-context}

echo "==> flowgpt-context business library"
mkdir -p "$DATA_DIR"
if [ -d "$CTX/.git" ]; then
  git -C "$CTX" fetch --depth 1 origin 2>&1 | tail -1
  git -C "$CTX" reset --hard FETCH_HEAD 2>&1 | tail -1
else
  gh repo clone "$CTX_REPO" "$CTX" -- --depth 1
fi
echo "    $(du -sh "$CTX" | cut -f1) @ $(git -C "$CTX" rev-parse --short HEAD)"

echo "==> shared CLAUDE.md"
cat > "$DATA_DIR/CLAUDE.md" <<'EOF'
# 团队共享工作区 — Claude Code Web

这份文件是 /srv/ccw/users/ 下所有同事 workspace 的共享上下文（按目录层级自动加载）。

## 使用约定
- 你的 workspace 在 /srv/ccw/users/<你的名字>/，每个项目放一个子目录
- 大家共用一份 Claude Max 订阅：右上角用量条对所有人可见，跑大任务前先看一眼余量
- 不要读写其他同事的 workspace（/srv/ccw/users/ 下别人的目录）

## 业务上下文库（做数据分析 / 决策 / 排查前必读）
FlowGPT 数据团队的完整上下文库在 `/srv/ccw/flowgpt-context/`。
**开工前先 `Read /srv/ccw/flowgpt-context/CLAUDE.md`**，再按它的路由查询：
- 写 SQL / 做分析 → `goals/metric-tree.md`、`skills/known-pits.md`（grep 你要用的表名）、`experiments/INDEX.md`
- 趋势异常 / 数对不上 → `registry/datasage-tools.md`、`skills/known-pits.md`
- 决策 / 规划 → `goals/strategy.md`、`decisions/`（历史 ADR，别重新发明或违背）、`grep -r 关键词 log/`
- 找人 → `state/ownership.md`
- 历史考古 → `grep -r '关键词' /srv/ccw/flowgpt-context/log/`

信任规则：`decisions/`、`experiments/`、`skills/known-pits.md`、`GOLDEN_QUESTIONS.md` 为 verified，可直接引用；
`goals/state/registry` 为 draft，引用注明；`log/` 为 raw，只当线索和证据，不可直接当口径/结论。

## 共享 skills
团队共享 skills 已装在 `~/.claude/skills`（方法论 + 数据 / 创意 / 管理 workflow）。
直接用 `/<skill-name>` 触发，或描述任务让我自动调用。常用：
- 数据：flowgpt-semantic-data-analyst、data-request-hub-sync、data-capability-snapshot、tracking-plan
- 思考 / 决策：first-principle、musk-5-step、thinking、grill-me、grill-with-docs
- 工程：tdd、diagnose、improve-codebase-architecture、to-prd、to-issues、triage
- 创意 / 内容：ad-director-storyboard、article-to-comic-adapter、creative-execution-pack、letter-html-prototype、tech-gossip-meme-agent
个人 skill 放自己项目的 `.claude/skills/<name>/SKILL.md`，只对你自己生效。

## 团队上下文
- 公司：FlowGPT / Emochi
- （管理员可在此补充更多团队背景、常用数据表、内部服务等）
EOF
echo "    wrote $DATA_DIR/CLAUDE.md"
echo "Done."
