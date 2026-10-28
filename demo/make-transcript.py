#!/usr/bin/env python3
"""Convert Claude Code stream-json output into window.TRANSCRIPT for demo/cards/terminal.html."""
import json, sys
src, prompt = sys.argv[1], sys.argv[2]
steps = [{'type': 'user', 'text': prompt}]
for line in open(src):
    line = line.strip()
    if not line:
        continue
    ev = json.loads(line)
    msg = ev.get('message') or {}
    for block in msg.get('content') or []:
        if not isinstance(block, dict):
            continue
        if ev.get('type') == 'assistant' and block.get('type') == 'tool_use':
            name = block['name'].replace('mcp__precedent__', 'precedent - ')
            args = ', '.join(f'{k}: "{v}"' if isinstance(v, str) else f'{k}: {v}' for k, v in block.get('input', {}).items())
            steps.append({'type': 'tool', 'name': f'{name} (MCP)', 'args': args[:160]})
        elif ev.get('type') == 'user' and block.get('type') == 'tool_result':
            content = block.get('content')
            text = content if isinstance(content, str) else ' '.join(c.get('text', '') for c in content or [] if isinstance(c, dict))
            try:
                data = json.loads(text)
                lines = [f"verdict: {data.get('verdict')} — {data.get('summary', '')}"]
                for c in data.get('conflicts', [])[:2]:
                    d = c['decision']
                    lines.append(f"{d['id']} · {d['title']} (owner {d.get('owner')}, {d.get('decidedOn')})")
                    lines.append(f"  guardrail: avoid {c.get('matchedGuardrail')}")
                text = '\n'.join(lines)
            except Exception:
                text = text[:400]
            steps.append({'type': 'result', 'text': text})
        elif ev.get('type') == 'assistant' and block.get('type') == 'text' and block.get('text', '').strip():
            steps.append({'type': 'assistant', 'text': block['text'].strip()})
print('window.TRANSCRIPT = ' + json.dumps(steps, indent=1) + ';')
