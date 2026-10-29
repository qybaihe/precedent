// Burn an SRT into a video as hard subtitles.
//
//   node demo/render-subtitles.mjs <subs.srt> <in.mp4> <out.mp4>
//
// The Homebrew ffmpeg has no libass/drawtext, so each cue is drawn by Chromium as a transparent
// PNG (white text on a translucent black box, centred near the bottom) and the PNGs are laid over
// the video with ffmpeg's overlay filter, timed by a concat list.
import { chromium } from '../tools/node_modules/playwright/index.mjs';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const [srtFile, input, output] = process.argv.slice(2);
const W = 1920;
const STRIP = 150; // height of the subtitle strip at the bottom of the frame
const OUT = path.join(HERE, 'tmp', 'subs');

const toSec = (t) => {
  const [h, m, s] = t.replace(',', '.').split(':');
  return +h * 3600 + +m * 60 + +s;
};
const cues = fs
  .readFileSync(srtFile, 'utf8')
  .trim()
  .split(/\n\s*\n/)
  .map((block) => {
    const [, times, ...text] = block.split('\n');
    const [a, b] = times.split(' --> ').map(toSec);
    return { start: a, end: b, text: text.join('\n') };
  });

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const html = (text) => `<!doctype html><html><head><meta charset="utf-8"><style>
  html, body { margin: 0; width: ${W}px; height: ${STRIP}px; background: transparent; }
  body { display: flex; align-items: flex-end; justify-content: center; }
  .cue { margin-bottom: 34px; max-width: 1240px; padding: 9px 24px 11px; border-radius: 10px;
    background: rgba(0, 0, 0, 0.66); color: #fff; text-align: center; white-space: pre-line;
    font: 600 42px/1.25 -apple-system, "SF Pro Display", "Helvetica Neue", Arial, sans-serif;
    letter-spacing: 0.1px; -webkit-font-smoothing: antialiased; }
</style></head><body>${text ? `<div class="cue">${esc(text)}</div>` : ''}</body></html>`;

fs.rmSync(OUT, { recursive: true, force: true });
fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch({ channel: 'chromium', headless: true });
const page = await browser.newPage({ viewport: { width: W, height: STRIP } });
const render = async (text, file) => {
  await page.setContent(html(text));
  await page.screenshot({ path: file, omitBackground: true });
};
await render('', path.join(OUT, 'blank.png'));
let widest = 0;
for (const [i, c] of cues.entries()) {
  await render(c.text, path.join(OUT, `${String(i).padStart(3, '0')}.png`));
  widest = Math.max(widest, await page.evaluate(() => document.querySelector('.cue').getBoundingClientRect().width));
}
await browser.close();

const duration = +execFileSync('ffprobe', ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', input]).toString();
const list = [];
let t = 0;
const add = (file, until) => {
  if (until - t > 0.0005) list.push(`file '${file}'`, `duration ${(until - t).toFixed(3)}`);
  t = Math.max(t, until);
};
for (const [i, c] of cues.entries()) {
  add('blank.png', c.start);
  add(`${String(i).padStart(3, '0')}.png`, c.end);
}
add('blank.png', duration);
list.push("file 'blank.png'"); // the concat demuxer ignores the last entry's duration
fs.writeFileSync(path.join(OUT, 'list.txt'), list.join('\n') + '\n');

execFileSync('ffmpeg', [
  '-y', '-loglevel', 'error', '-i', input, '-f', 'concat', '-safe', '0', '-i', path.join(OUT, 'list.txt'),
  '-filter_complex', `[1:v]fps=30,format=rgba[s];[0:v][s]overlay=0:H-h:eof_action=pass:format=auto,format=yuv420p[v]`,
  '-map', '[v]', '-map', '0:a', '-c:v', 'libx264', '-preset', 'slow', '-crf', '18', '-c:a', 'copy', '-movflags', '+faststart', output,
], { stdio: 'inherit' });
console.log(`wrote ${path.basename(output)}: ${cues.length} cues, widest box ${Math.round(widest)} px`);
