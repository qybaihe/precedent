#!/usr/bin/env bash
# Scene 7: a real Claude Code session started the way Jira's "Open in coding tool" starts it.
# The prompt is the exact text of the claude-cli:// deeplink Jira built for PAY-1 (summary,
# description and the Precedent brief Precedent keeps in it), captured to demo/tmp/pay1-prompt.txt.
# Runs headless in a scratch copy of demo/lumen-payments and writes demo/raw/scene07.jsonl,
# demo/tmp/scene07.diff and the replay transcript demo/cards/transcript.js.
set -euo pipefail
HERE="$(cd "$(dirname "$0")" && pwd)"
WORK="$(mktemp -d)/lumen-payments"
cp -R "$HERE/lumen-payments" "$WORK"
cd "$WORK"
git init -q && git add -A && git -c user.email=demo@example.com -c user.name=demo commit -qm "payments service"
PROMPT="$(cat "$HERE/tmp/pay1-prompt.txt")"
claude -p "$PROMPT" --strict-mcp-config --mcp-config '{"mcpServers":{}}' \
  --allowedTools "Read,Glob,Grep,Edit,Write" --permission-mode acceptEdits --max-turns 25 \
  --output-format stream-json --verbose > "$HERE/raw/scene07.jsonl"
git add -A && git diff --cached --stat && git diff --cached > "$HERE/tmp/scene07.diff"
python3 "$HERE/make-transcript.py" "$HERE/raw/scene07.jsonl" "$PROMPT" > "$HERE/cards/transcript.js"
cat >> "$HERE/cards/transcript.js" <<'JS'
window.TERMINAL_HEAD = '<b>✻ Claude Code</b><br><span class="muted">~/lumen-payments · opened from Jira: PAY-1 → Open in coding tool</span>';
window.STREAM_WPS = 40;
window.STEP_SCALE = 0.6;
window.PASTE_HOLD = 5000;
JS
echo "transcript written: $HERE/cards/transcript.js"
