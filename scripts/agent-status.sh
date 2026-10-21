#!/usr/bin/env bash
# Checks whether the uAgent is registered on Agentverse and whether its
# mailbox is live.
#
#   ./scripts/agent-status.sh
#
# Reads the address from services/healthyfy-agent/.env and the live
# registration from the public Almanac API.
set -uo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
AGENT_DIR="$ROOT/services/healthyfy-agent"
LOG_DIR="${LOG_DIR:-/tmp/opencode}"
LOG="${AGENT_LOG:-$LOG_DIR/uagent.log}"

ADDR=""
if [ -f "$ROOT/.env" ]; then
  ADDR=$(grep -E "^HEALTHYFY_AGENT_ADDRESS=" "$ROOT/.env" | head -1 | cut -d= -f2- | tr -d '[:space:]')
fi

if [ -z "$ADDR" ]; then
  echo "No agent address found. Set HEALTHYFY_AGENT_ADDRESS in .env" >&2
  exit 1
fi

echo "Agent address: $ADDR"
echo

echo "Almanac registration:"
RECORD=$(curl -s --max-time 20 "https://agentverse.ai/v1/almanac/agents/$ADDR")
if [ -z "$RECORD" ]; then
  echo "  not registered - start the agent (cd services/healthyfy-agent && python agent.py)"
  exit 0
fi
echo "$RECORD" | node -e "
let d='';process.stdin.on('data',c=>d+=c).on('end',()=>{
  try {
    const r = JSON.parse(d);
    console.log('  status   :', r.status);
    console.log('  type     :', r.type);
    console.log('  endpoint :', (r.endpoints||[]).map(e=>e.url).join(', '));
    console.log('  protocols:', (r.protocols||[]).length, 'published');
    console.log('  expiry   :', r.expiry);
  } catch (e) { console.log('  (could not parse)'); }
})"

echo
echo "Mailbox:"
LOG_FILE="$LOG_DIR/uagent-fresh.log"
[ -f "$LOG_FILE" ] || LOG_FILE="$LOG"
if [ -f "$LOG_FILE" ]; then
  # The agent can log the "not found" warning before the mailbox is
  # created and the success line after, so compare their positions
  # rather than looking for either one in isolation.
  NOT_FOUND_LINE=$(grep -n "Agent mailbox not found" "$LOG_FILE" | tail -1 | cut -d: -f1)
  OK_LINE=$(grep -n "mailbox agent in Agentverse\|Mailbox access token acquired" "$LOG_FILE" | tail -1 | cut -d: -f1)

  if [ -n "$OK_LINE" ] && { [ -z "$NOT_FOUND_LINE" ] || [ "$OK_LINE" -gt "$NOT_FOUND_LINE" ]; }; then
    echo "  live - the agent can receive messages from ASI:One and other agents"
  elif [ -n "$NOT_FOUND_LINE" ]; then
    echo "  NOT created yet."
    echo "  Fix (about 1 minute):"
    echo "    1. the agent is running - open this URL in a browser:"
    echo "       https://agentverse.ai/inspect/?uri=http%3A//127.0.0.1%3A8000&address=$ADDR"
    echo "    2. click Connect -> Mailbox -> Finish"
    echo "    3. restart the agent and the warning disappears"
  else
    echo "  unknown - check $LOG_FILE"
  fi
else
  echo "  no agent log found at $LOG_FILE"
fi
