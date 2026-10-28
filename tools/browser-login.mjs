// Opens a visible Chromium window with a persistent profile so a human can log in to
// Atlassian once. The session cookies are then reused by the demo recorder and E2E checks.
// Usage: node tools/browser-login.mjs   (waits up to 12h, exits once logged in)
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const profile = path.resolve(here, '..', '.browser-profile');
const site = `https://${process.env.ATLASSIAN_SITE || 'qybaihe-forge.atlassian.net'}`;

const ctx = await chromium.launchPersistentContext(profile, {
  headless: false,
  viewport: { width: 1440, height: 900 },
});
const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto(`${site}/jira`, { waitUntil: 'domcontentloaded' }).catch(() => {});

const deadline = Date.now() + 12 * 3600 * 1000;
while (Date.now() < deadline) {
  const cookies = await ctx.cookies('https://id.atlassian.com');
  const session = cookies.find((c) => c.name === 'cloud.session.token');
  if (session) {
    console.log('LOGGED_IN');
    await new Promise((r) => setTimeout(r, 5000));
    break;
  }
  await new Promise((r) => setTimeout(r, 5000));
}
await ctx.close();
