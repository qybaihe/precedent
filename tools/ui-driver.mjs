// Long-lived headless browser on the logged-in profile (same 1920x1080 @120 % setup as demo/record.mjs),
// driven over a tiny local HTTP API so UI checks don't relaunch the browser for every step.
//   node tools/ui-driver.mjs &      then e.g.
//   curl -s localhost:9400 -d '{"op":"goto","url":"https://…/browse/PAY-1"}'
//   curl -s localhost:9400 -d '{"op":"shot","path":"/tmp/x.png"}'
//   curl -s localhost:9400 -d '{"op":"click","role":"button","name":"Decisions"}'
//   curl -s localhost:9400 -d '{"op":"text","frame":"forge"}'   # visible text of Forge iframes
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const profile = process.env.PROFILE || path.join(ROOT, '.browser-profile');
const prefsFile = path.join(profile, 'Default', 'Preferences');
const prefs = JSON.parse(fs.readFileSync(prefsFile, 'utf8'));
prefs.partition = { ...prefs.partition, default_zoom_level: { ...prefs.partition?.default_zoom_level, x: Number(process.env.ZOOM_LEVEL ?? 1) } };
fs.writeFileSync(prefsFile, JSON.stringify(prefs));

const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: true,
  viewport: null,
  userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
  ignoreDefaultArgs: ['--enable-automation'],
  args: ['--disable-blink-features=AutomationControlled', '--window-size=1920,1167'],
});
let page = ctx.pages()[0] || (await ctx.newPage());

/** Resize the window so the page area is exactly 1920x1080 device px (window chrome varies per profile). */
async function fitWindow(p) {
  const cdp = await ctx.newCDPSession(p);
  const { windowId, bounds } = await cdp.send('Browser.getWindowForTarget');
  const inner = await p.evaluate(() => Math.round(innerHeight * devicePixelRatio));
  if (inner !== 1080) await cdp.send('Browser.setWindowBounds', { windowId, bounds: { height: bounds.height + 1080 - inner } });
  await cdp.detach();
}
await page.goto('about:blank');
await fitWindow(page);

/** Locator in the page or in the first frame whose URL contains `frame`. */
function scope(frame) {
  if (!frame) return page;
  const f = page.frames().find((x) => x !== page.mainFrame() && x.url().includes(frame));
  if (!f) throw new Error(`no frame matching ${frame}: ${page.frames().map((x) => x.url().slice(0, 60)).join(' | ')}`);
  return f;
}
function locate({ frame, role, name, text, css, nth = 0, exact = false }) {
  const s = scope(frame);
  let l;
  if (role) l = s.getByRole(role, name ? { name: typeof name === 'string' && !exact ? new RegExp(name, 'i') : name, exact } : {});
  else if (text) l = s.getByText(new RegExp(text, 'i'));
  else l = s.locator(css);
  return nth === -1 ? l.last() : l.nth(nth);
}

const ops = {
  async goto({ url, wait = 6000 }) {
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 }).catch((e) => e);
    await page.waitForTimeout(wait);
    await fitWindow(page);
    return page.url();
  },
  // CDP capture at device pixels: page.screenshot() mis-crops when browser zoom is on.
  async shot({ path: out }) {
    const cdp = await ctx.newCDPSession(page);
    const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
    await cdp.detach();
    fs.writeFileSync(out, Buffer.from(data, 'base64'));
    return out;
  },
  async click(a) {
    const l = locate(a);
    await l.waitFor({ state: 'visible', timeout: a.timeout || 20000 });
    await l.click();
    await page.waitForTimeout(a.wait ?? 2500);
    return 'clicked';
  },
  async fill(a) {
    const l = locate(a);
    await l.fill(a.value);
    return 'filled';
  },
  async press({ key, wait = 1000 }) {
    await page.keyboard.press(key);
    await page.waitForTimeout(wait);
    return 'pressed';
  },
  async type({ value, delay = 20 }) {
    await page.keyboard.type(value, { delay });
    return 'typed';
  },
  async wait({ ms = 2000 }) {
    await page.waitForTimeout(ms);
    return 'ok';
  },
  async waitFor(a) {
    await locate(a).waitFor({ state: 'visible', timeout: a.timeout || 30000 });
    return 'visible';
  },
  async scroll({ y = 600, x = 960, at = 540 }) {
    await page.mouse.move(x, at);
    await page.mouse.wheel(0, y);
    await page.waitForTimeout(800);
    return 'scrolled';
  },
  async frames() {
    return page.frames().map((f) => f.url().slice(0, 140));
  },
  async text({ frame, max = 4000 }) {
    const fs_ = frame ? page.frames().filter((f) => f !== page.mainFrame() && f.url().includes(frame)) : [page.mainFrame()];
    const out = [];
    for (const f of fs_) out.push(await f.evaluate(() => document.body?.innerText || '').catch((e) => `ERR ${e.message}`));
    return out.join('\n----\n').slice(0, max);
  },
  async eval({ js, frame }) {
    return await scope(frame).evaluate(js);
  },
  async count(a) {
    const s = scope(a.frame);
    return await (a.role ? s.getByRole(a.role, a.name ? { name: new RegExp(a.name, 'i') } : {}) : a.text ? s.getByText(new RegExp(a.text, 'i')) : s.locator(a.css)).count();
  },
  async newpage() {
    page = await ctx.newPage();
    await fitWindow(page);
    return 'new page';
  },
  async close() {
    setTimeout(async () => { await ctx.close(); process.exit(0); }, 100);
    return 'closing';
  },
};

http
  .createServer(async (req, res) => {
    let body = '';
    for await (const c of req) body += c;
    try {
      const a = JSON.parse(body || '{}');
      const r = await ops[a.op](a);
      res.end(typeof r === 'string' ? r : JSON.stringify(r, null, 1));
    } catch (e) {
      res.statusCode = 500;
      res.end(`ERROR ${e.message.split('\n')[0]}`);
    }
  })
  .listen(9400, '127.0.0.1', () => console.log('UI_DRIVER_READY'));
