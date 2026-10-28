// OAuth 2.1 (PKCE + dynamic client registration) against the Precedent MCP endpoint, using the
// logged-in Playwright profile for the consent screen. Writes the token JSON to $MCP_TOKEN_FILE
// (outside the repo). Then `node tools/mcp-call.mjs` can talk to the MCP server directly.
//   MCP_TOKEN_FILE=/path/token.json node tools/mcp-oauth.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RESOURCE = 'https://mcp.atlassian.com/forge/92a37583-d5ab-4554-97dd-8e6d41617e28';
const PORT = 8765;
const REDIRECT = `http://localhost:${PORT}/callback`;
const SITE_HOST = process.env.ATLASSIAN_SITE || 'qybaihe-forge.atlassian.net';
const out = process.env.MCP_TOKEN_FILE;
if (!out) throw new Error('set MCP_TOKEN_FILE');

const b64url = (buf) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const prm = await (await fetch(`https://mcp.atlassian.com/.well-known/oauth-protected-resource/forge/92a37583-d5ab-4554-97dd-8e6d41617e28`)).json();
const issuer = prm.authorization_servers[0];
const meta = await (await fetch(`${issuer}/.well-known/oauth-authorization-server`)).json();

const reg = await (
  await fetch(meta.registration_endpoint, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      client_name: 'Precedent demo client',
      redirect_uris: [REDIRECT],
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
    }),
  })
).json();
if (!reg.client_id) throw new Error(`registration failed: ${JSON.stringify(reg).slice(0, 300)}`);

const verifier = b64url(crypto.randomBytes(32));
const challenge = b64url(crypto.createHash('sha256').update(verifier).digest());
const state = b64url(crypto.randomBytes(12));
const url = new URL(meta.authorization_endpoint);
url.search = new URLSearchParams({
  response_type: 'code',
  client_id: reg.client_id,
  redirect_uri: REDIRECT,
  code_challenge: challenge,
  code_challenge_method: 'S256',
  state,
  resource: RESOURCE,
  scope: 'offline_access',
}).toString();

const codePromise = new Promise((resolve, reject) => {
  const server = http.createServer((req, res) => {
    const u = new URL(req.url, REDIRECT);
    if (u.pathname !== '/callback') return res.end();
    res.end('Precedent MCP authorized. You can close this tab.');
    server.close();
    if (u.searchParams.get('state') !== state) return reject(new Error('state mismatch'));
    if (u.searchParams.get('error')) return reject(new Error(u.searchParams.get('error_description') || u.searchParams.get('error')));
    resolve(u.searchParams.get('code'));
  });
  server.listen(PORT);
  setTimeout(() => reject(new Error('timed out waiting for consent')), 10 * 60 * 1000);
});

const ctx = await chromium.launchPersistentContext(path.resolve(HERE, '..', '.browser-profile'), {
  headless: false,
  viewport: { width: 1280, height: 900 },
  ignoreDefaultArgs: ['--enable-automation'],
});
const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto(url.toString(), { waitUntil: 'domcontentloaded' });

// Best-effort automation of the consent screen: pick the site, then approve.
(async () => {
  for (let i = 0; i < 60; i++) {
    await page.waitForTimeout(2000);
    if (page.url().startsWith(REDIRECT)) return;
    await page.screenshot({ path: path.join(path.dirname(out), 'mcp-consent.png') }).catch(() => {});
    const siteOption = page.getByText(SITE_HOST).first();
    const combobox = page.getByRole('combobox').first();
    if ((await combobox.isVisible().catch(() => false)) && !(await siteOption.isVisible().catch(() => false))) {
      await combobox.click().catch(() => {});
      await page.waitForTimeout(800);
    }
    if (await siteOption.isVisible().catch(() => false)) await siteOption.click().catch(() => {});
    for (const name of [/^Approve$/i, /^Accept$/i, /^Allow$/i, /^Continue$/i, /^Authorize$/i]) {
      const b = page.getByRole('button', { name }).first();
      if ((await b.isVisible().catch(() => false)) && (await b.isEnabled().catch(() => false))) {
        await b.click().catch(() => {});
        break;
      }
    }
  }
})();

const code = await codePromise;
const tokenRes = await fetch(meta.token_endpoint, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT, client_id: reg.client_id, code_verifier: verifier, resource: RESOURCE }),
});
const token = await tokenRes.json();
if (!token.access_token) throw new Error(`token exchange failed: ${JSON.stringify(token).slice(0, 300)}`);
fs.writeFileSync(out, JSON.stringify({ ...token, client_id: reg.client_id, token_endpoint: meta.token_endpoint, obtained_at: Date.now() }), { mode: 0o600 });
console.log('MCP token saved (expires in', token.expires_in, 's)');
await ctx.close();
