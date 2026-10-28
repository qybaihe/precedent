// Minimal MCP (streamable HTTP) client for the Precedent endpoint.
//   MCP_TOKEN_FILE=… node tools/mcp-call.mjs list
//   MCP_TOKEN_FILE=… node tools/mcp-call.mjs call check-work-item '{"plan":"move the ledger to MongoDB"}'
import fs from 'node:fs';

const URL_ = 'https://mcp.atlassian.com/forge/92a37583-d5ab-4554-97dd-8e6d41617e28';
const { access_token: token } = JSON.parse(fs.readFileSync(process.env.MCP_TOKEN_FILE, 'utf8'));
let session = null;
let id = 0;

async function rpc(method, params, { notify = false } = {}) {
  const body = notify ? { jsonrpc: '2.0', method, params } : { jsonrpc: '2.0', id: ++id, method, params };
  const res = await fetch(URL_, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      Accept: 'application/json, text/event-stream',
      'MCP-Protocol-Version': '2025-06-18',
      ...(session ? { 'Mcp-Session-Id': session } : {}),
    },
    body: JSON.stringify(body),
  });
  session = res.headers.get('mcp-session-id') || session;
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} -> ${res.status}: ${text.slice(0, 400)}`);
  if (notify || !text) return null;
  // SSE or JSON
  const payload = text.includes('data:') ? text.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5)).pop() : text;
  const msg = JSON.parse(payload);
  if (msg.error) throw new Error(`${method}: ${JSON.stringify(msg.error)}`);
  return msg.result;
}

const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'precedent-check', version: '1.0' } });
await rpc('notifications/initialized', {}, { notify: true });
const [cmd, name, args] = process.argv.slice(2);
if (cmd === 'list') {
  const r = await rpc('tools/list', {});
  console.log(`server: ${init.serverInfo?.name} ${init.serverInfo?.version || ''}`);
  for (const t of r.tools) console.log(`- ${t.name}: ${(t.description || '').slice(0, 90)}`);
} else if (cmd === 'call') {
  const r = await rpc('tools/call', { name, arguments: args ? JSON.parse(args) : {} });
  for (const c of r.content || []) console.log(c.type === 'text' ? c.text : JSON.stringify(c));
}
