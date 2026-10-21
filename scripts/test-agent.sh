#!/usr/bin/env bash
# Verifies the uAgent end to end without needing an ASI:One key.
#
# Starts a mock ASI:One endpoint, points the agent at it, and checks
# that the agent resolves the family member, calls the Healthyfy tools
# and returns an answer grounded in the real records.
#
#   ./scripts/test-agent.sh
#
# The Healthyfy backend must already be running (npm run start:dev).
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_DIR="$ROOT/services/healthyfy-agent"
VENV="$AGENT_DIR/.venv/bin/python"
LOG_DIR="${LOG_DIR:-/tmp/opencode}"
MOCK_PORT="${MOCK_PORT:-4142}"
AGENT_PORT="${AGENT_PORT:-8000}"

if ! curl -fsS --max-time 3 http://localhost:3000/api/health > /dev/null 2>&1; then
  echo "The Healthyfy backend is not running. Start it with: npm run start:dev" >&2
  exit 1
fi

if [ ! -x "$VENV" ]; then
  echo "No virtualenv at $AGENT_DIR/.venv. Create it and install requirements." >&2
  exit 1
fi

cleanup() {
  [ -n "${MOCK_PID:-}" ] && kill "$MOCK_PID" 2>/dev/null
  [ -n "${AGENT_PID:-}" ] && kill "$AGENT_PID" 2>/dev/null
  return 0
}
trap cleanup EXIT

# Stop anything already holding the ports, otherwise the requests below
# would be answered by a different agent than the one this test starts.
for PORT_TO_FREE in "$AGENT_PORT" "$MOCK_PORT"; do
  EXISTING=$((ss -ltnp 2>/dev/null || netstat -ltnp 2>/dev/null) | grep ":$PORT_TO_FREE" | grep -o 'pid=[0-9]*' | head -1 | cut -d= -f2)
  if [ -n "${EXISTING:-}" ]; then
    echo "Stopping the process on port $PORT_TO_FREE (pid $EXISTING)"
    kill "$EXISTING" 2>/dev/null
    sleep 1
  fi
done

echo "Starting the mock ASI:One endpoint on $MOCK_PORT..."
node "$ROOT/scripts/agent-mock.mjs" "$MOCK_PORT" > "$LOG_DIR/agent-mock.log" 2>&1 &
MOCK_PID=$!
sleep 2

echo "Starting the uAgent..."
(
  cd "$AGENT_DIR" &&
  ASI1_API_KEY=test-key \
  ASI1_BASE_URL="http://localhost:$MOCK_PORT/v1" \
  HEALTHYFY_AGENT_PORT="$AGENT_PORT" \
  "$VENV" agent.py > "$LOG_DIR/uagent-test.log" 2>&1
) &
AGENT_PID=$!

for _ in $(seq 1 30); do
  if curl -fsS --max-time 2 "http://localhost:$AGENT_PORT/health" > /dev/null 2>&1; then break; fi
  sleep 1
done

echo
echo "Agent health"
curl -s --max-time 10 "http://localhost:$AGENT_PORT/health"
echo
echo
echo "Agent answer (ASI:One tool loop against the real records)"
RESPONSE=$(curl -s --max-time 90 -X POST "http://localhost:$AGENT_PORT/ask" \
  -H "Content-Type: application/json" \
  -d '{"question":"What changed in my fathers health recently?","member_id":"fam-2"}')
echo "$RESPONSE" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  let j;try{j=JSON.parse(d)}catch(e){console.log('  x the agent did not return JSON:', d.slice(0,200));process.exit(1)}
  const fail=(m)=>{console.log('  x',m);process.exit(1)};
  if(!j.answer) fail('no answer returned');
  if(!j.member_name||j.member_name==='unknown') fail('the member was not resolved');
  if(!j.data_sources||j.data_sources.length===0) fail('no data sources were recorded');
  console.log('  \u2713 member resolved:', j.member_name);
  console.log('  \u2713 records consulted:', j.records);
  console.log('  \u2713 tools used:', JSON.stringify(j.data_sources));
  console.log('  \u2713 answer:', j.answer.split('\n')[0].slice(0,150));
})"
STATUS=$?

echo
if [ $STATUS -eq 0 ]; then
  echo "uAgent OK"
else
  echo "uAgent FAILED. See $LOG_DIR/uagent-test.log" >&2
fi
exit $STATUS
