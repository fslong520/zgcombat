#!/usr/bin/env bash
# CodeCombat 生产服务器一键启动脚本
# 用法: ./start-prod.sh
# 幂等: 已运行的组件自动跳过，可重复执行
set -u

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
MONGO_DBPATH="$HOME/Documents/01-Projects/ope-codecombat/data/db"
MONGO_LOG="$MONGO_DBPATH/mongod.log"
COCO_LOG="$PROJECT_DIR/logs/codecombat.log"
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
