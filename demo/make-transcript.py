#!/usr/bin/env python3
"""Convert Claude Code stream-json output into window.TRANSCRIPT for demo/cards/terminal.html."""
import json, re, sys
src, prompt = sys.argv[1], sys.argv[2]
# a long prompt was pasted (the Jira deeplink), not typed: shown the way Claude Code shows a paste
steps = [{'type': 'user', 'text': prompt, 'paste': len(prompt) > 400}]
SKIP = {'ToolSearch', 'TodoWrite'}
pending = {}  # tool_use id -> tool name, to summarise its result
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
            name, inp = block['name'], block.get('input', {})
            if name in SKIP:
                continue
            pending[block.get('id')] = name
            if name.startswith('mcp__'):
                args = ', '.join(f'{k}: "{v}"' if isinstance(v, str) else f'{k}: {v}' for k, v in inp.items())
                steps.append({'type': 'tool', 'name': name.replace('mcp__precedent__', 'precedent - ') + ' (MCP)', 'args': args[:160]})
            else:
                # Claude Code style: Read(services/payments/ledger/store.js), Bash(git ls-files …)
                arg = inp.get('file_path') or inp.get('pattern') or inp.get('command') or ''
                arg = re.sub(r'^.*?/lumen-payments/', '', arg)
                steps.append({'type': 'tool', 'name': name, 'args': arg[:90]})
        elif ev.get('type') == 'user' and block.get('type') == 'tool_result':
            name = pending.pop(block.get('tool_use_id'), None)
            if name is None:
                continue
            content = block.get('content')
            text = content if isinstance(content, str) else ' '.join(c.get('text', '') for c in content or [] if isinstance(c, dict))
            if not name.startswith('mcp__'):
                n = len(text.rstrip().splitlines())
                steps.append({'type': 'result', 'text': f'Read {n} lines' if name == 'Read' else '\n'.join(text.strip().splitlines()[:4])[:300]})
                continue
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
