// Screenshot a local HTML file (no login needed): node shot.mjs <file.html> <out.png> [waitMs]
import { chromium } from 'playwright';
import path from 'node:path';
const [file, out, wait = '3500'] = process.argv.slice(2);
const browser = await chromium.launch({ headless: true, channel: 'chromium' });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('file://' + path.resolve(file));
await page.waitForTimeout(Number(wait));
await page.screenshot({ path: out });
await browser.close();
