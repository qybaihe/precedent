// Waits until the login window (tools/open-login-window.sh) is signed in to Atlassian — a tab on the
// site, or the Atlassian session cookie (Google sign-in may land on start/home.atlassian.com instead) —
// keeps it open 45 s so cookies are flushed to disk, then closes the browser gracefully via CDP.
// Never prints cookie values.
const site = process.env.ATLASSIAN_SITE || 'qybaihe-forge.atlassian.net';
const deadline = Date.now() + Number(process.env.WAIT_HOURS || 24) * 3600 * 1000;

async function browserCall(method, params = {}) {
  const { webSocketDebuggerUrl } = await (await fetch('http://127.0.0.1:9333/json/version')).json();
  const ws = new WebSocket(webSocketDebuggerUrl);
  await new Promise((r, j) => { ws.addEventListener('open', r); ws.addEventListener('error', j); });
  ws.send(JSON.stringify({ id: 1, method, params }));
  const msg = await new Promise((r) => {
    ws.addEventListener('message', (e) => r(JSON.parse(e.data)));
    setTimeout(() => r({}), 5000);
  });
  ws.close();
  return msg.result;
}

let seenAt = null;
while (Date.now() < deadline) {
  try {
    const tabs = await (await fetch('http://127.0.0.1:9333/json')).json();
    const onSite = tabs.some((t) => t.type === 'page' && t.url.startsWith(`https://${site}/`) && !t.url.includes('/login'));
    const { cookies = [] } = (await browserCall('Storage.getCookies')) || {};
    const session = cookies.some((c) => c.name === 'cloud.session.token' && /atlassian\.(net|com)$/.test(c.domain));
    if ((onSite || session) && !seenAt) {
      seenAt = Date.now();
      console.log('LOGIN_DETECTED', new Date().toISOString(), onSite ? 'site tab' : 'session cookie');
    }
    if (seenAt && Date.now() - seenAt > 45000) {
      await browserCall('Browser.close').catch(() => {});
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
