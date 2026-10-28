// Headless check: is the persistent profile logged in to the Atlassian site?
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const ctx = await chromium.launchPersistentContext(path.resolve(here, '..', '.browser-profile'), { headless: true, channel: 'chromium' });
const page = ctx.pages()[0] || (await ctx.newPage());
await page.goto(`https://${process.env.ATLASSIAN_SITE}/jira/your-work`, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch(() => {});
await page.waitForTimeout(5000);
console.log(page.url().includes('id.atlassian.com') || page.url().includes('/login') ? 'NOT_LOGGED_IN' : 'LOGGED_IN', page.url().slice(0, 80));
await ctx.close();
