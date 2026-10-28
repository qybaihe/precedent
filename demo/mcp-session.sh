#!/usr/bin/env bash
# Runs a real Claude Code session against the Precedent MCP server and turns it into the scene-7 replay.
#   MCP_TOKEN_FILE=… demo/mcp-session.sh
# The OAuth token comes from tools/mcp-oauth.mjs and is only written to a temp config outside the repo.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)/lumen-ledger"
mkdir -p "$WORK"
TOKEN=$(python3 -c "import json,os;print(json.load(open(os.environ['MCP_TOKEN_FILE']))['access_token'])")
cat > "$WORK/mcp.json" <<JSON
{"mcpServers":{"precedent":{"type":"http","url":"https://mcp.atlassian.com/forge/92a37583-d5ab-4554-97dd-8e6d41617e28","headers":{"Authorization":"Bearer $TOKEN"}}}}
JSON
chmod 600 "$WORK/mcp.json"
PROMPT="I'm about to move the payout ledger to a MongoDB collection so the schema can evolve without migrations. Check our team decisions with the precedent tools first, then tell me what to do."
cd "$WORK"
claude -p "$PROMPT" --mcp-config "$WORK/mcp.json" --strict-mcp-config \
  --allowedTools "mcp__precedent__check-work-item,mcp__precedent__search-decisions,mcp__precedent__get-decision" \
  --output-format stream-json --verbose > "$HERE/raw/scene07.jsonl"
rm -f "$WORK/mcp.json"
python3 "$HERE/make-transcript.py" "$HERE/raw/scene07.jsonl" "$PROMPT" > "$HERE/cards/transcript.js"
echo "transcript written: $HERE/cards/transcript.js"
