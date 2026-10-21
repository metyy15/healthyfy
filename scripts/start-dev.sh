#!/usr/bin/env bash
# Starts MongoDB and the Healthyfy dev server, both detached.
#
#   ./scripts/start-dev.sh
#
# Logs land in /tmp/opencode/. Override the log directory with LOG_DIR.
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
LOG_DIR="${LOG_DIR:-/tmp/opencode}"
MONGO_HOME="${MONGO_HOME:-$HOME/.local/mongodb}"
MONGO_DATA="${MONGO_DATA:-$HOME/.local/mongodb-data}"
PORT="${PORT:-3000}"

mkdir -p "$LOG_DIR" "$MONGO_DATA"

# --- MongoDB ---------------------------------------------------------------
if (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -q ':27017'; then
  echo "MongoDB already listening on 27017."
else
  if [ ! -x "$MONGO_HOME/bin/mongod" ]; then
    echo "mongod not found at $MONGO_HOME/bin/mongod" >&2
    exit 1
  fi
  setsid nohup "$MONGO_HOME/bin/mongod" \
    --dbpath "$MONGO_DATA" \
    --logpath "$LOG_DIR/mongod.log" \
    --bind_ip 127.0.0.1 --port 27017 --fork \
    < /dev/null > /dev/null 2>&1 &
  echo "MongoDB starting..."
  for _ in $(seq 1 20); do
    if (ss -ltn 2>/dev/null || netstat -ltn 2>/dev/null) | grep -q ':27017'; then break; fi
    sleep 1
  done
fi

# --- App -------------------------------------------------------------------
OLD_PID=$((ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | grep ":$PORT" | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2 || true)
if [ -n "${OLD_PID:-}" ]; then
  kill "$OLD_PID" 2>/dev/null || true
  sleep 2
fi

cd "$ROOT"
setsid nohup npm run dev > "$LOG_DIR/healthyfy-dev.log" 2>&1 < /dev/null &
echo "Healthyfy starting (logs: $LOG_DIR/healthyfy-dev.log)..."

for _ in $(seq 1 45); do
  if curl -fsS --max-time 2 "http://localhost:$PORT/api/health" > /dev/null 2>&1; then
    echo "Healthyfy is up on http://localhost:$PORT"
    exit 0
  fi
  sleep 1
done

echo "Healthyfy did not come up in time. Check $LOG_DIR/healthyfy-dev.log" >&2
tail -20 "$LOG_DIR/healthyfy-dev.log" >&2 || true
exit 1
