// Waits until the login window (tools/open-login-window.sh) has a tab on the Atlassian site,
// keeps it open 45 s so cookies are flushed to disk, then closes the browser gracefully via CDP.
const site = process.env.ATLASSIAN_SITE || 'qybaihe-forge.atlassian.net';
const deadline = Date.now() + 8 * 3600 * 1000;
let seenAt = null;
while (Date.now() < deadline) {
  try {
    const tabs = await (await fetch('http://127.0.0.1:9333/json')).json();
    const onSite = tabs.some((t) => t.type === 'page' && t.url.startsWith(`https://${site}/`) && !t.url.includes('/login'));
    if (onSite && !seenAt) { seenAt = Date.now(); console.log('LOGIN_DETECTED', new Date().toISOString()); }
    if (seenAt && Date.now() - seenAt > 45000) {
      const { webSocketDebuggerUrl } = await (await fetch('http://127.0.0.1:9333/json/version')).json();
      const ws = new WebSocket(webSocketDebuggerUrl);
      await new Promise((r) => ws.addEventListener('open', r));
      ws.send(JSON.stringify({ id: 1, method: 'Browser.close' }));
      await new Promise((r) => setTimeout(r, 3000));
      console.log('BROWSER_CLOSED');
      process.exit(0);
    }
  } catch {
    if (seenAt) { console.log('BROWSER_GONE'); process.exit(0); }
  }
  await new Promise((r) => setTimeout(r, 3000));
}
console.log('TIMEOUT');
