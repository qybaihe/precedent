// Records the demo scenes (see DEMO_SCRIPT.md) with Playwright, one clip per scene.
// Requires a logged-in .browser-profile. Usage:
//   node demo/record.mjs            # all browser scenes
//   node demo/record.mjs 3 5        # only scenes 3 and 5
//   SHOTS=1 node demo/record.mjs 3  # also save debug screenshots to demo/tmp/
// Output: demo/raw/sceneNN.webm and demo/raw/scenes.json (merged with existing entries).
import { chromium } from '../tools/node_modules/playwright/index.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const RAW = path.join(HERE, 'raw');
const TMP = path.join(HERE, 'tmp');
fs.mkdirSync(RAW, { recursive: true });
fs.mkdirSync(TMP, { recursive: true });

// The demo site has Rovo (qybaihe-forge, a developer-license site, doesn't). Not ATLASSIAN_SITE: that
// one is the CLI's default site in atlassian.env.
const SITE = `https://${process.env.DEMO_SITE || 'one-atlas-hreq.atlassian.net'}`;
const APP = '92a37583-d5ab-4554-97dd-8e6d41617e28';
const ENV = '1c85a2f4-e35c-49f7-bc7a-39674f4f24b0';
const DURATIONS = Object.fromEntries(
  JSON.parse(fs.readFileSync(path.join(HERE, 'narration', 'durations.json'), 'utf8')).map((d) => [d.scene, d.seconds]),
);
// Native 1920x1080 frames with the browser zoomed to 120% (lays out like 1600x900, so UI text stays
// large and crisp). Playwright's recorder captures CSS pixels, so deviceScaleFactor would not help.
const VIEW = { width: 1920, height: 1080 };
const ZOOM_LEVEL = 1.0; // Chrome zoom level = log1.2(factor): 1.0 -> 120 %
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

// A visible cursor + click ripple, because Playwright videos don't render the OS cursor.
const CURSOR_SCRIPT = `
(() => {
  if (window.__demoCursor) return; window.__demoCursor = true;
  const install = () => {
    const c = document.createElement('div');
    c.id = '__demo_cursor';
    c.style.cssText = 'position:fixed;left:0;top:0;width:22px;height:22px;z-index:2147483647;pointer-events:none;transform:translate(-3px,-2px);transition:transform .02s;display:none';
    c.innerHTML = '<svg width="22" height="22" viewBox="0 0 22 22"><path d="M3 2l14 9-6 1.4L8 19z" fill="#111" stroke="#fff" stroke-width="1.6" stroke-linejoin="round"/></svg>';
    document.documentElement.appendChild(c);
    addEventListener('mousemove', (e) => { c.style.display = 'block'; c.style.left = e.clientX + 'px'; c.style.top = e.clientY + 'px'; }, true);
    addEventListener('mousedown', (e) => {
      const r = document.createElement('div');
      r.style.cssText = 'position:fixed;z-index:2147483646;pointer-events:none;border-radius:50%;border:3px solid rgba(29,122,252,.85);width:10px;height:10px;left:'+(e.clientX-8)+'px;top:'+(e.clientY-8)+'px;transition:all .45s ease-out;opacity:1';
      document.documentElement.appendChild(r);
      requestAnimationFrame(() => { r.style.width='38px'; r.style.height='38px'; r.style.left=(e.clientX-22)+'px'; r.style.top=(e.clientY-22)+'px'; r.style.opacity='0'; });
      setTimeout(() => r.remove(), 600);
    }, true);
  };
  if (document.documentElement) install(); else addEventListener('DOMContentLoaded', install);
})();`;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let mouse = { x: 720, y: 450 };

async function moveTo(page, x, y, steps = 28) {
  await page.mouse.move(x, y, { steps });
  mouse = { x, y };
}

/** Smoothly move to a locator and click it. */
async function clickOn(page, locator, { hold = 350, offsetX = 0.5, offsetY = 0.5 } = {}) {
  await locator.waitFor({ state: 'visible', timeout: 30000 });
  await locator.scrollIntoViewIfNeeded().catch(() => {});
  const box = await locator.boundingBox();
  await moveTo(page, box.x + box.width * offsetX, box.y + box.height * offsetY);
  await sleep(hold);
  await page.mouse.down();
  await page.mouse.up();
}

async function hoverOn(page, locator, ms = 900) {
  const box = await locator.boundingBox();
  if (!box) return;
  await moveTo(page, box.x + Math.min(box.width / 2, 160), box.y + box.height / 2, 22);
  await sleep(ms);
}

async function smoothScroll(page, total, { step = 120, pause = 110 } = {}) {
  const n = Math.ceil(Math.abs(total) / step);
  for (let i = 0; i < n; i++) {
    await page.mouse.wheel(0, Math.sign(total) * step);
    await sleep(pause);
  }
}

// CDP capture at device pixels (page.screenshot() mis-crops when browser zoom is on).
async function shot(page, name, dir = process.env.SHOTS ? TMP : null) {
  if (!dir) return;
  const cdp = await page.context().newCDPSession(page);
  const { data } = await cdp.send('Page.captureScreenshot', { format: 'png' });
  await cdp.detach();
  fs.writeFileSync(path.join(dir, `${name}.png`), Buffer.from(data, 'base64'));
}

/** Resize the window so the page area is exactly VIEW in device px (window chrome varies per profile/page). */
async function fitWindow(page) {
  const cdp = await page.context().newCDPSession(page);
  const { windowId, bounds } = await cdp.send('Browser.getWindowForTarget');
  const inner = await page.evaluate(() => Math.round(innerHeight * devicePixelRatio));
  if (inner !== VIEW.height) await cdp.send('Browser.setWindowBounds', { windowId, bounds: { height: bounds.height + VIEW.height - inner } });
  await cdp.detach();
}

/** Dismiss onboarding spotlights, cookie banners and "what's new" popups if they appear. */
async function tidy(page) {
  for (const name of [/^Dismiss$/i, /^Got it$/i, /^Done$/i, /^Skip$/i, /^Not now$/i, /^Maybe later$/i, /^Accept all$/i, /^Remind me later$/i]) {
    const b = page.getByRole('button', { name }).first();
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
  }
}

/** Open the work item's Precedent panel (Jira remembers expanded/collapsed per user). */
async function expandPrecedent(page, { hold = 350 } = {}) {
  const toggle = page.getByRole('button', { name: /^Precedent/ }).first();
  await toggle.waitFor({ state: 'visible', timeout: 40000 });
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await clickOn(page, toggle, { hold });
  else await hoverOn(page, toggle, 600);
}

/** Scroll the work item's right-hand column so the Precedent card is in view. */
async function scrollDetails(page, amount = 520) {
  await moveTo(page, 1360, 600, 16);
  await smoothScroll(page, amount, { step: 65, pause: 70 });
}

// ---------------- scenes ----------------

/** Precedent's Custom UI runs in a Forge iframe; its contents are only reachable through it. */
const forge = (page) => page.frameLocator('iframe[src*="cdn.prod.atlassian-dev.net"]').first();

async function openPay1(page) {
  await page.goto(`${SITE}/browse/PAY-1`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: /Store payout ledger in MongoDB/ }).first().waitFor({ timeout: 40000 });
  await tidy(page);
  await fitWindow(page);
  await expandPrecedent(page, { hold: 100 });
  await forge(page).getByText(/Contradicts 1 team decision/).waitFor({ timeout: 40000 });
}

const SCENES = {
  1: async (page) => {
    await page.goto(`file://${path.join(HERE, 'cards', 'title.html')}`);
    return { ready: true };
  },

  // Confluence: the decision is made where the team writes
  2: async (page, ready) => {
    await page.goto(`${SITE}/wiki/spaces/ENG/overview`, { waitUntil: 'domcontentloaded' });
    const link = page.getByRole('link', { name: /Payments Architecture Review/ }).first();
    await link.waitFor({ timeout: 40000 });
    await link.click();
    await page.getByRole('heading', { name: /Payout ledger storage/ }).waitFor({ timeout: 40000 });
    await tidy(page);
    await fitWindow(page);
    await sleep(1500);
    ready();
    await moveTo(page, 760, 420);
    await sleep(800);
    await smoothScroll(page, 600, { step: 60, pause: 110 });
    await hoverOn(page, page.getByText(/Keep all transactional payment data in PostgreSQL/).first(), 2600);
    await smoothScroll(page, -600, { step: 150, pause: 60 });
    await sleep(500);
    const byline = page.getByText(/\d+ decisions? · \d+ conflicts?/).first();
    await clickOn(page, byline);
    await forge(page).getByText(/tracked by Precedent/).waitFor({ timeout: 30000 });
    await shot(page, 'scene2-byline');
    await sleep(1500);
    await hoverOn(page, forge(page).getByText(/Contradicted by/i).first(), 2500);
    await sleep(2500);
  },

  // Jira's own Create dialog: "Already decided in DEC-1" under the summary (jira:uiModifications)
  3: async (page, ready, cut) => {
    await page.goto(`${SITE}/jira/software/projects/PAY/boards`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.getByRole('button', { name: /^Create$/ }).first().waitFor({ timeout: 40000 });
    await tidy(page);
    await fitWindow(page);
    await sleep(1500);
    ready();
    await clickOn(page, page.getByRole('button', { name: /^Create$/ }).first());
    const summary = page.locator('[role=dialog] input[name=summary], [role=dialog] #summary-field').first();
    await summary.waitFor({ timeout: 30000 });
    // the dialog opens on the last project used: make sure it is Payments
    const project = page.locator('[role=dialog] button', { hasText: /^(PLF|CHK|PAY|[A-Z]{2,6})$/ }).first();
    if ((await project.innerText().catch(() => 'PAY')).trim() !== 'PAY') {
      await clickOn(page, project, { hold: 200 });
      await sleep(600);
      await page.keyboard.type('Pay', { delay: 30 });
      await page.getByRole('menuitem', { name: /^Payments \(PAY\)$/ }).first().click({ timeout: 10000 });
      await page.locator('[role=dialog] button', { hasText: /^PAY$/ }).first().waitFor({ timeout: 10000 });
    }
    await sleep(1200);
    await clickOn(page, summary, { hold: 200 });
    await page.keyboard.type('Move payout reconciliation to MongoDB', { delay: 45 });
    await sleep(500);
    await page.keyboard.press('Tab');
    await page.getByText(/Already decided in DEC-1/).first().waitFor({ timeout: 20000 });
    await sleep(600);
    await hoverOn(page, page.getByText(/Already decided in DEC-1/).first(), 1600);
    const info = page.locator('[role=dialog] button[aria-label*="View details" i], [role=dialog] button:has-text("View details")').first();
    await clickOn(page, info, { hold: 250 });
    await page.getByText(/rules out MongoDB/).first().waitFor({ timeout: 10000 });
    await shot(page, 'scene3-create');
    await sleep(8000);
    // leave without creating anything (off camera)
    cut.start();
    await page.keyboard.press('Escape');
    await sleep(400);
    await page.locator('[role=dialog] button:has-text("Close")').first().click({ timeout: 5000 }).catch(() => {});
    await page.locator('[role=dialog] button:has-text("Discard")').first().click({ timeout: 5000 }).catch(() => {});
    cut.end();
  },

  // the issue panel: conflict, evidence, compliant alternative, and the brief for coding agents
  4: async (page, ready) => {
    await openPay1(page);
    await sleep(1000);
    ready();
    await scrollDetails(page, 380);
    await sleep(600);
    await hoverOn(page, forge(page).getByText(/Trips guardrail/i).first(), 1800);
    await hoverOn(page, forge(page).getByText(/Compliant alternative/).first(), 2200);
    await scrollDetails(page, 520);
    await hoverOn(page, forge(page).getByText(/Brief for coding agents/).first(), 1800);
    await shot(page, 'scene4-panel');
    // the brief Precedent keeps at the end of the description
    await hoverOn(page, page.getByText(/Precedent brief/).first(), 1800);
    await hoverOn(page, page.getByText(/Denied packages/).first(), 2200);
    await hoverOn(page, page.getByText(/For coding agents/).first(), 2000);
  },

  // the workflow: Done is blocked while the conflict is open (jira:workflowValidator)
  5: async (page, ready) => {
    await openPay1(page);
    await sleep(800);
    ready();
    await clickOn(page, page.getByRole('button', { name: /^In Progress/ }).first());
    await sleep(900);
    const done = page.getByRole('option', { name: /^Done/ }).or(page.getByRole('menuitem', { name: /^Done/ })).or(page.locator('[role=listbox] :text-is("Done")')).first();
    await clickOn(page, done);
    await page.getByText(/Blocked by Precedent/).first().waitFor({ timeout: 30000 });
    await sleep(500);
    await hoverOn(page, page.getByText(/Blocked by Precedent/).first(), 1500);
    await shot(page, 'scene5-blocked');
    await sleep(5000);
  },

  // Rovo explains, citing the decision
  6: async (page, ready, cut) => {
    await openPay1(page);
    await scrollDetails(page, 380);
    await sleep(800);
    ready();
    await sleep(500);
    await clickOn(page, forge(page).getByRole('button', { name: /Ask Precedent/ }).first());
    // only Rovo's answer card counts: the work item itself mentions DEC-1 in its Precedent brief
    const answer = page.locator('[data-testid="assistant-response-card-layout"]').last();
    cut.start();
    await answer.getByText(/DEC-1/).first().waitFor({ timeout: 90000 }).catch(() => {});
    cut.end();
    // wait until Rovo has finished the answer (it ends with the options)
    await answer.getByText(/^Supersede/).first().waitFor({ timeout: 90000 }).catch(() => {});
    await tidy(page);
    await shot(page, 'scene6-rovo');
    await sleep(2500);
    await moveTo(page, 1400, 450);
    await smoothScroll(page, 600, { step: 50, pause: 150 });
    await sleep(3500);
  },

  // Jira's Open in coding tool hands summary + description (with the brief) to Claude Code
  7: async (page, ready) => {
    await page.goto(`${SITE}/browse/PAY-1`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /Store payout ledger in MongoDB/ }).first().waitFor({ timeout: 40000 });
    await tidy(page);
    await fitWindow(page);
    const dev = page.getByRole('button', { name: /^Open in coding tool$/ }).first();
    // Jira remembers whether the Development section is expanded
    const section = page.getByRole('button', { name: /^Development/ }).first();
    await section.waitFor({ timeout: 30000 });
    if ((await section.getAttribute('aria-expanded')) === 'false') await section.click();
    await dev.waitFor({ timeout: 20000 });
    console.log('  scene 7: coding tool button visible');
    await sleep(1000);
    ready();
    await hoverOn(page, page.getByText(/Precedent brief/).first(), 1600);
    await clickOn(page, dev);
    // pick the tool: the list shows Claude Code, Cursor, GitHub Copilot, Codex, Rovo CLI, VS Code
    const select = page.locator('[data-testid^="deeplink.deeplink-agent-select-select"]').first();
    await select.waitFor({ timeout: 20000 });
    console.log('  scene 7: tool select visible');
    await sleep(900);
    await clickOn(page, select, { hold: 250 });
    const option = page.getByRole('option', { name: /^Claude Code/ }).first();
    await option.waitFor({ timeout: 10000 });
    await sleep(1400);
    await clickOn(page, option, { hold: 250 });
    const openIt = page.locator('button', { hasText: /^Open Claude Code$/ }).first();
    if (!(await openIt.waitFor({ timeout: 5000 }).then(() => true).catch(() => false))) {
      console.log('  scene 7: buttons now', JSON.stringify(await page.$$eval('button', (bs) => bs.map((b) => b.innerText.trim()).filter((t) => /^Open|Claude/.test(t)))));
      await select.focus();
      await page.keyboard.press('ArrowDown');
      await sleep(500);
      await page.keyboard.press('Enter');
    }
    await openIt.waitFor({ timeout: 20000 });
    await sleep(900);
    await hoverOn(page, page.getByText(/work item context is pre-loaded/i).first(), 1400);
    await hoverOn(page, openIt, 2500);
    await shot(page, 'scene7-coding-tool');
  },

  // the real Claude Code session with that prompt (demo/coding-session.sh)
  8: async (page, ready) => {
    await page.goto(`file://${path.join(HERE, 'cards', 'terminal.html')}`);
    ready();
    await page.waitForFunction(() => document.title === 'DONE', null, { timeout: 120000 });
    await sleep(3500); // time to read the agent's answer
  },

  // living decisions: a tripped tripwire on the Radar, then the meeting-notes inbox
  9: async (page, ready, cut) => {
    await page.goto(`${SITE}/jira/software/projects/PLF/apps/${APP}/${ENV}`, { waitUntil: 'domcontentloaded' });
    await forge(page).getByText(/need(s)? review/).first().waitFor({ timeout: 40000 });
    await tidy(page);
    await fitWindow(page);
    await sleep(1200);
    ready();
    await hoverOn(page, forge(page).getByText(/need(s)? review/).first(), 1200);
    await hoverOn(page, forge(page).getByText(/Tripwire/).first(), 3200);
    await shot(page, 'scene9-radar');
    cut.start();
    await page.goto(`${SITE}/jira/apps/${APP}/${ENV}`, { waitUntil: 'domcontentloaded' });
    await forge(page).getByText(/Active decisions/i).first().waitFor({ timeout: 40000 });
    await tidy(page);
    await sleep(800);
    cut.end();
    await clickOn(page, forge(page).locator('button.tab', { hasText: 'Inbox' }).first());
    await forge(page).getByText(/possible decisions? found/).first().waitFor({ timeout: 20000 });
    await sleep(800);
    await hoverOn(page, forge(page).getByText(/Cap card-on-file retries/).first(), 1800);
    await hoverOn(page, forge(page).getByText(/Merge into DEC-2/).first(), 2500);
    await shot(page, 'scene9-inbox');
  },

  10: async (page) => {
    await page.goto(`file://${path.join(HERE, 'cards', 'closing.html')}`);
    return { ready: true };
  },
};

// ---------------- runner ----------------

const wanted = process.argv.slice(2).map(Number).filter(Boolean);
const order = (wanted.length ? wanted : [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]).filter((n) => SCENES[n]);
const indexFile = path.join(RAW, 'scenes.json');
const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : [];

// Card/terminal scenes are local files: record them with a throwaway profile so they don't need (or
// lock) the logged-in one. Headless by default (independent of the screen size); HEADED=1 to watch.
const LOCAL_SCENES = new Set([1, 8, 10]);
const profile = order.every((n) => LOCAL_SCENES.has(n)) ? path.join(TMP, 'card-profile') : path.join(ROOT, '.browser-profile');
const prefsFile = path.join(profile, 'Default', 'Preferences');
fs.mkdirSync(path.dirname(prefsFile), { recursive: true });
const prefs = fs.existsSync(prefsFile) ? JSON.parse(fs.readFileSync(prefsFile, 'utf8')) : {};
prefs.partition = { ...prefs.partition, default_zoom_level: { ...prefs.partition?.default_zoom_level, x: ZOOM_LEVEL } };
fs.writeFileSync(prefsFile, JSON.stringify(prefs));
const ctx = await chromium.launchPersistentContext(profile, {
  channel: 'chromium',
  headless: !process.env.HEADED,
  // No viewport emulation: an emulated viewport taller than the (virtual) screen minus window chrome
  // gets clipped in the screencast. Instead size the real window so its content area is exactly VIEW
  // (headless window chrome is 87 px).
  viewport: null,
  userAgent: UA,
  recordVideo: { dir: RAW, size: VIEW },
  ignoreDefaultArgs: ['--enable-automation'],
  args: ['--disable-blink-features=AutomationControlled', `--window-size=${VIEW.width},${VIEW.height + 87}`],
});
await ctx.addInitScript(CURSOR_SCRIPT);
for (const p of ctx.pages()) await p.close().catch(() => {});

for (const n of order) {
  const page = await ctx.newPage();
  const t0 = Date.now();
  let readyMs = null;
  const ready = () => {
    readyMs = Date.now() - t0;
  };
  // cut.start()/cut.end() mark dead time (page loads, waiting on triggers) that compose.py removes
  const cuts = [];
  const cut = {
    start: () => cuts.push([Date.now() - t0, null]),
    end: () => {
      cuts[cuts.length - 1][1] = Date.now() - t0;
    },
  };
  const cutMs = () => cuts.reduce((n, [a, b]) => n + ((b ?? Date.now() - t0) - a), 0);
  const minMs = Math.round(((DURATIONS[n] || 8) + 1.4) * 1000);
  try {
    const r = await SCENES[n](page, ready, cut);
    if (r?.ready) ready();
    if (readyMs === null) ready();
    const elapsed = Date.now() - t0 - readyMs - cutMs();
    if (elapsed < minMs) await sleep(minMs - elapsed);
    const endMs = Date.now() - t0;
    const video = page.video();
    await page.close();
    const src = await video.path();
    const dest = path.join(RAW, `scene${String(n).padStart(2, '0')}.webm`);
    fs.renameSync(src, dest);
    const entry = { scene: n, video: path.basename(dest), readyMs, endMs, cuts };
    const i = index.findIndex((e) => e.scene === n);
    if (i >= 0) index[i] = entry;
    else index.push(entry);
    console.log(`scene ${n}: ready at ${(readyMs / 1000).toFixed(1)}s, clip ${((endMs - readyMs - cutMs()) / 1000).toFixed(1)}s after ${cuts.length} cut(s) (needs ${(minMs / 1000).toFixed(1)}s)`);
  } catch (e) {
    await page.screenshot({ path: path.join(TMP, `scene${n}-error.png`) }).catch(() => {});
    console.error(`scene ${n} FAILED at ${page.url().slice(0, 100)}: ${e.message.split('\n')[0]}`);
    await page.close().catch(() => {});
  }
}
index.sort((a, b) => a.scene - b.scene);
fs.writeFileSync(indexFile, JSON.stringify(index, null, 1));
await ctx.close();

