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

const SITE = `https://${process.env.ATLASSIAN_SITE || 'qybaihe-forge.atlassian.net'}`;
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

async function shot(page, name) {
  if (process.env.SHOTS) await page.screenshot({ path: path.join(TMP, `${name}.png`) });
}

/** Dismiss onboarding spotlights, cookie banners and "what's new" popups if they appear. */
async function tidy(page) {
  for (const name of [/^Dismiss$/i, /^Got it$/i, /^Close$/i, /^Skip$/i, /^Not now$/i, /^Maybe later$/i, /^Accept all$/i]) {
    const b = page.getByRole('button', { name }).first();
    if (await b.isVisible().catch(() => false)) await b.click().catch(() => {});
  }
}

// ---------------- scenes ----------------

const SCENES = {
  1: async (page) => {
    await page.goto(`file://${path.join(HERE, 'cards', 'title.html')}`);
    return { ready: true };
  },

  2: async (page, ready) => {
    await page.goto(`${SITE}/wiki/spaces/ENG/pages`, { waitUntil: 'domcontentloaded' });
    // open by title so it survives reseeds (page ids change)
    const link = page.getByRole('link', { name: /Payments Architecture Review — 2026-03-12/ }).first();
    await link.waitFor({ timeout: 30000 });
    await link.click();
    await page.getByRole('heading', { name: /Payout ledger storage/ }).waitFor({ timeout: 30000 });
    await tidy(page);
    await sleep(1500);
    ready();
    await moveTo(page, 760, 420);
    await sleep(1200);
    await smoothScroll(page, 1700, { step: 100, pause: 120 });
    await sleep(900);
    await smoothScroll(page, -1700, { step: 200, pause: 60 });
    await sleep(600);
    const byline = page.getByText(/decisions? · \d+ conflicts?|decisions? tracked|\d+ decisions?/).first();
    await clickOn(page, byline);
    await page.getByText(/tracked by Precedent/).waitFor({ timeout: 20000 });
    await shot(page, 'scene2-byline');
    await sleep(1200);
    const dlg = page.getByText(/Contradicted by/).first();
    if (await dlg.isVisible().catch(() => false)) await hoverOn(page, dlg, 1500);
    await sleep(2500);
  },

  3: async (page, ready) => {
    await page.goto(`${SITE}/browse/PAY-1`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /Store payout ledger in MongoDB/ }).first().waitFor({ timeout: 40000 });
    await tidy(page);
    await sleep(1500);
    ready();
    await sleep(800);
    const btn = page.getByRole('button', { name: /Decisions/ }).first();
    await clickOn(page, btn);
    await page.getByText(/Contradicts 1 team decision/).waitFor({ timeout: 40000 });
    await shot(page, 'scene3-panel');
    await sleep(2500);
    await hoverOn(page, page.getByText(/Trips guardrail/).first(), 2500);
    await hoverOn(page, page.getByText(/Priya Shah/).first(), 1500);
    await hoverOn(page, page.getByRole('link', { name: /Payments Architecture Review/ }).first(), 2500);
    await sleep(2000);
  },

  4: async (page, ready) => {
    await page.goto(`${SITE}/jira/software/projects/PAY/boards`, { waitUntil: 'domcontentloaded' }).catch(() => {});
    await page.goto(`${SITE}/browse/PAY-6`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /Retry webhook deliveries/ }).first().waitFor({ timeout: 40000 });
    await tidy(page);
    await sleep(1000);
    ready();
    // create a work item through the real create dialog
    await clickOn(page, page.getByRole('button', { name: /^Create$/ }).first());
    const summary = page.getByLabel(/^Summary/).first();
    await summary.waitFor({ timeout: 20000 });
    await sleep(500);
    await summary.click();
    await page.keyboard.type('Integrate Adyen for EU card payments', { delay: 45 });
    await sleep(500);
    await shot(page, 'scene4-create');
    const createBtn = page.getByRole('dialog').getByRole('button', { name: /^Create$/ }).last();
    await clickOn(page, createBtn);
    const flagLink = page.getByRole('link', { name: /View|PAY-\d+/ }).first();
    await flagLink.waitFor({ timeout: 20000 }).catch(() => {});
    const key = await page
      .locator('[data-testid*="flag"] a, [role="alert"] a')
      .filter({ hasText: /PAY-\d+/ })
      .first()
      .textContent()
      .catch(() => null);
    const newKey = (key && key.match(/PAY-\d+/)?.[0]) || 'PAY-7';
    await sleep(2500); // let the trigger check it
    await page.goto(`${SITE}/browse/${newKey}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /Integrate Adyen/ }).first().waitFor({ timeout: 40000 });
    await sleep(800);
    await clickOn(page, page.getByRole('button', { name: /Decisions/ }).first());
    await page.getByText(/Contradicts 1 team decision/).waitFor({ timeout: 40000 });
    await sleep(1200);
    await hoverOn(page, page.getByText(/Standardize on Stripe/).first(), 2200);
    await page.goto(`${SITE}/browse/PAY-4`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /Remove MongoDB/ }).first().waitFor({ timeout: 40000 });
    await sleep(600);
    await clickOn(page, page.getByRole('button', { name: /Decisions/ }).first());
    await page.getByText(/Consistent with team decisions/).waitFor({ timeout: 40000 });
    await shot(page, 'scene4-aligned');
    await hoverOn(page, page.getByText(/Removes or replaces/).first(), 2500);
    await sleep(1500);
    fs.writeFileSync(path.join(TMP, 'scene4-created-key.txt'), newKey);
  },

  5: async (page, ready) => {
    await page.goto(`${SITE}/browse/PAY-1`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: /Store payout ledger in MongoDB/ }).first().waitFor({ timeout: 40000 });
    await tidy(page);
    await clickOn(page, page.getByRole('button', { name: /Decisions/ }).first(), { hold: 100 });
    await page.getByText(/Contradicts 1 team decision/).waitFor({ timeout: 40000 });
    await sleep(800);
    ready();
    await sleep(700);
    await clickOn(page, page.getByRole('button', { name: /Ask Precedent/ }).first());
    // wait for the agent's answer to mention the decision id
    await page.getByText(/DEC-1/).nth(2).waitFor({ timeout: 60000 }).catch(() => {});
    await shot(page, 'scene5-rovo');
    await sleep(9000);
    await moveTo(page, 1250, 520);
    await smoothScroll(page, 600, { step: 60, pause: 140 });
    await sleep(4000);
  },

  6: async (page, ready) => {
    await page.goto(`${SITE}/jira/software/projects/PAY/apps/${APP}/${ENV}`, { waitUntil: 'domcontentloaded' });
    await page.getByText(/Decision Radar · PAY/).waitFor({ timeout: 40000 });
    await tidy(page);
    await sleep(1500);
    ready();
    await shot(page, 'scene6-radar');
    await hoverOn(page, page.getByText(/Open conflicts/).first(), 1500);
    await hoverOn(page, page.getByText(/Store payout ledger in MongoDB/).first(), 1800);
    await clickOn(page, page.getByRole('button', { name: /Open in JQL/ }).first());
    await page.waitForURL(/jql=/, { timeout: 30000 }).catch(() => {});
    await page.getByText(/precedentConflicts/).first().waitFor({ timeout: 30000 }).catch(() => {});
    await shot(page, 'scene6-jql');
    await sleep(4500);
  },

  // Replay of a real `claude -p` session against the Precedent MCP server (demo/cards/transcript.js,
  // produced by demo/mcp-session.sh from Claude Code's stream-json output).
  7: async (page, ready) => {
    await page.goto(`file://${path.join(HERE, 'cards', 'terminal.html')}`);
    ready();
    await page.waitForFunction(() => document.title === 'DONE', null, { timeout: 120000 });
    await sleep(2500);
  },

  8: async (page, ready) => {
    await page.goto(`${SITE}/wiki/apps/${APP}/${ENV}/decision-log`, { waitUntil: 'domcontentloaded' });
    await page.getByText(/Active decisions/).waitFor({ timeout: 40000 });
    await tidy(page);
    await sleep(1500);
    ready();
    await shot(page, 'scene8-log');
    await hoverOn(page, page.getByText(/Open conflicts/).first(), 1200);
    await clickOn(page, page.getByRole('button', { name: /^DEC-1$/ }).first());
    await page.getByText(/Work items touching this decision/).waitFor({ timeout: 30000 });
    await sleep(1500);
    await shot(page, 'scene8-detail');
    await smoothScroll(page, 500, { step: 80, pause: 130 });
    await sleep(2500);
    await page.keyboard.press('Escape');
    await sleep(700);
    await clickOn(page, page.getByRole('tab', { name: /Setup/ }).first());
    await sleep(2500);
  },

  9: async (page) => {
    await page.goto(`file://${path.join(HERE, 'cards', 'closing.html')}`);
    return { ready: true };
  },
};

// ---------------- runner ----------------

const wanted = process.argv.slice(2).map(Number).filter(Boolean);
const order = (wanted.length ? wanted : [1, 2, 3, 4, 5, 6, 7, 8, 9]).filter((n) => SCENES[n]);
const indexFile = path.join(RAW, 'scenes.json');
const index = fs.existsSync(indexFile) ? JSON.parse(fs.readFileSync(indexFile, 'utf8')) : [];

// Card/terminal scenes are local files: record them with a throwaway profile so they don't need (or
// lock) the logged-in one. Headless by default (independent of the screen size); HEADED=1 to watch.
const LOCAL_SCENES = new Set([1, 7, 9]);
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
  const minMs = Math.round(((DURATIONS[n] || 8) + 1.4) * 1000);
  try {
    const r = await SCENES[n](page, ready);
    if (r?.ready) ready();
    if (readyMs === null) ready();
    const elapsed = Date.now() - t0 - readyMs;
    if (elapsed < minMs) await sleep(minMs - elapsed);
    const endMs = Date.now() - t0;
    const video = page.video();
    await page.close();
    const src = await video.path();
    const dest = path.join(RAW, `scene${String(n).padStart(2, '0')}.webm`);
    fs.renameSync(src, dest);
    const entry = { scene: n, video: path.basename(dest), readyMs, endMs };
    const i = index.findIndex((e) => e.scene === n);
    if (i >= 0) index[i] = entry;
    else index.push(entry);
    console.log(`scene ${n}: ready at ${(readyMs / 1000).toFixed(1)}s, clip ${((endMs - readyMs) / 1000).toFixed(1)}s (needs ${(minMs / 1000).toFixed(1)}s)`);
  } catch (e) {
    await page.screenshot({ path: path.join(TMP, `scene${n}-error.png`) }).catch(() => {});
    console.error(`scene ${n} FAILED: ${e.message.split('\n')[0]}`);
    await page.close().catch(() => {});
  }
}
index.sort((a, b) => a.scene - b.scene);
fs.writeFileSync(indexFile, JSON.stringify(index, null, 1));
await ctx.close();

