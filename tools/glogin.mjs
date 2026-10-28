import { chromium } from "playwright";
import fs from "node:fs";
const ctx = await chromium.launchPersistentContext(process.env.HOME + "/hackathons/codegeist2026/.browser-profile", { headless: false, viewport: { width: 1280, height: 860 } });
const page = ctx.pages()[0] || await ctx.newPage();
await page.goto("https://id.atlassian.com/login?continue=https%3A%2F%2Fqybaihe-forge.atlassian.net%2Fjira", { waitUntil: "domcontentloaded" });
await page.waitForTimeout(4000);
await page.getByRole("button", { name: /Google/ }).first().click().catch(e => fs.writeFileSync("/tmp/glogin_err.txt", String(e)));
await page.waitForTimeout(6000);
await page.screenshot({ path: "/tmp/glogin.png" });
fs.writeFileSync("/tmp/glogin_url.txt", page.url());
const deadline = Date.now() + 12 * 3600 * 1000;
while (Date.now() < deadline) {
  const ck = await ctx.cookies("https://id.atlassian.com");
  if (ck.find(c => c.name === "cloud.session.token")) { fs.writeFileSync("/tmp/atl_done.txt", "LOGGED_IN"); await page.waitForTimeout(5000); break; }
  await page.waitForTimeout(3000);
}
await ctx.close();
