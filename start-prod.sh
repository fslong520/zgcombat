#!/usr/bin/env bash
# CodeCombat 生产服务器一键启动脚本
# 用法: ./start-prod.sh           # 检测到 development 构建时自动执行生产构建
#       REBUILD=1 ./start-prod.sh # 强制重新生产构建
# 幂等: 已运行的组件自动跳过，可重复执行
set -u

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONGO_DBPATH="$HOME/Documents/01-Projects/ope-codecombat/data/db"
MONGO_LOG="$MONGO_DBPATH/mongod.log"
COCO_LOG="$PROJECT_DIR/logs/codecombat.log"
BUILD_LOG="$PROJECT_DIR/logs/webpack-build.log"
BUILD_MARKER="$PROJECT_DIR/public_coco/javascripts/app.js"
PORT=1145

mkdir -p "$PROJECT_DIR/logs"

# 1. MongoDB (端口 27017)
if pgrep -x mongod >/dev/null 2>&1; then
  echo "[mongod] 已在运行，跳过"
else
  echo "[mongod] 启动中..."
  /usr/local/bin/mongod --dbpath "$MONGO_DBPATH" --bind_ip 127.0.0.1 --port 27017 \
    --fork --logpath "$MONGO_LOG"
  sleep 2
  if pgrep -x mongod >/dev/null 2>&1; then
    echo "[mongod] 已启动"
  else
    echo "[mongod] 启动失败，见 $MONGO_LOG" >&2
    exit 1
  fi
fi

# 1.5 前端生产构建（terser 压缩；development 构建 eval+未压缩，浏览器解析慢是卡顿之源）
NEEDS_BUILD=0
if [ "${REBUILD:-}" = "1" ]; then
  NEEDS_BUILD=1
elif [ ! -f "$BUILD_MARKER" ]; then
  NEEDS_BUILD=1
elif grep -q 'The "eval" devtool has been used' "$BUILD_MARKER" 2>/dev/null; then
  echo "[build] 检测到 development 构建（eval 未压缩）"
  NEEDS_BUILD=1
fi
if [ "$NEEDS_BUILD" = "1" ]; then
  echo "[build] 执行生产构建（耗时较长，日志见 $BUILD_LOG）..."
  cd "$PROJECT_DIR"
  if ! BRUNCH_ENV=production NODE_OPTIONS='--max-old-space-size=8192' npx webpack >> "$BUILD_LOG" 2>&1; then
    echo "[build] 生产构建失败，见 $BUILD_LOG" >&2
    tail -20 "$BUILD_LOG" >&2
    exit 1
  fi
  # 校验产物确为生产构建，防 404/半成品
  if grep -q 'The "eval" devtool has been used' "$BUILD_MARKER" 2>/dev/null; then
    echo "[build] 构建后仍为 development 产物，异常" >&2
    exit 1
  fi
  echo "[build] 生产构建完成"
fi

# 2. CodeCombat (端口 $PORT)
if ss -ltn 2>/dev/null | grep -q ":$PORT "; then
  echo "[codecombat] 已在端口 $PORT 运行，跳过"
else
  echo "[codecombat] 启动中 (端口 $PORT)..."
  cd "$PROJECT_DIR"
  setsid nohup node ./index.js >> "$COCO_LOG" 2>&1 &
  # 等待端口就绪，给 node 完成 setsid 脱离的时间；最多 60s
  for _ in $(seq 1 60); do
    if ss -ltn 2>/dev/null | grep -q ":$PORT "; then
      break
    fi
    sleep 1
  done
  if ss -ltn 2>/dev/null | grep -q ":$PORT "; then
    echo "[codecombat] 已启动，端口 $PORT 就绪"
  else
    echo "[codecombat] 启动失败，见 $COCO_LOG" >&2
    tail -20 "$COCO_LOG" >&2
    exit 1
  fi
fi

echo "----------------------------------------"
echo "MongoDB:  127.0.0.1:27017"
echo "CodeCombat: http://localhost:$PORT"
echo "服务日志: $COCO_LOG"
