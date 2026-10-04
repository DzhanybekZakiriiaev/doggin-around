#!/usr/bin/env node
// Letters the Storm Night panels into a finished comic page (PNG), one per ending:
//
//   npm run comic-page                 # both endings
//   npm run comic-page -- --ending bad
//
// The bad-ending page is the comic you upload on the game's first screen; the good-ending page is how it
// reads after you've played. Layout and lettering are HTML (the menu's comic fonts), photographed by a
// headless Chrome or Edge: set BROWSER to its executable if it isn't found.
//
// Output: public/comic/storm-night-<ending>-ending.png

import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const COMIC = path.join(ROOT, 'public', 'comic');
const WIDTH = 1800;
const HEIGHT = 2900;

/** What's lettered on each panel, per ending. */
const PAGES = {
  bad: {
    title: 'STORM NIGHT',
    blurb: 'Locked out, the storm rolling in, and only one dog knows where the spare key is.',
    panels: [
      { image: 'panel-1.jpg', caption: 'The keys are gone. The storm is coming.', sfx: 'KRAK!' },
      { image: 'panel-2-bad.jpg', caption: 'Hours in the rain. No key.', bubble: 'It has to be here somewhere…' },
      { image: 'panel-3-bad.jpg', caption: 'Then the thunder came.', sfx: 'KRA-KOOM!' },
      { image: 'panel-4-bad.jpg', caption: 'She searched all night.', bubble: 'BISCUIT!' },
      { image: 'panel-5-bad.jpg', caption: 'By morning, just his bandana.', end: 'THE END?' },
    ],
  },
  good: {
    title: 'STORM NIGHT',
    blurb: 'Locked out, the storm rolling in, and only one dog knows where the spare key is.',
    panels: [
      { image: 'panel-1.jpg', caption: 'The keys are gone. The storm is coming.', sfx: 'KRAK!' },
      { image: 'panel-2-good.jpg', caption: 'Unless somebody remembers where he dug.', bubble: 'Biscuit, dig!' },
      { image: 'panel-3-good.jpg', caption: 'The spare key!', sfx: 'CLICK!' },
      { image: 'panel-4-good.jpg', caption: 'Home, dry and warm.', sfx: 'zzz…' },
      { image: 'panel-5-good.jpg', caption: 'And the key gets a hook of its own.', end: 'THE END' },
    ],
  },
};

const escape = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');

function pageHtml(ending) {
  const { title, blurb, panels } = PAGES[ending];
  const url = (file) => pathToFileURL(path.join(COMIC, file)).href;
  const panel = (p, i) => `
    <figure class="panel panel-${i + 1}">
      <img src="${url(p.image)}" alt="">
      ${p.caption ? `<figcaption>${escape(p.caption)}</figcaption>` : ''}
      ${p.bubble ? `<div class="bubble">${escape(p.bubble)}</div>` : ''}
      ${p.sfx ? `<div class="sfx">${escape(p.sfx)}</div>` : ''}
      ${p.end ? `<div class="end end--${ending}">${escape(p.end)}</div>` : ''}
    </figure>`;
  return `<!doctype html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Bangers&family=Barlow+Condensed:ital,wght@1,800;1,900&family=Inter:wght@600;800&display=block" rel="stylesheet">
<style>
  * { box-sizing: border-box; }
  html, body { margin: 0; width: ${WIDTH}px; height: ${HEIGHT}px; overflow: hidden; }
  body {
    padding: 64px 70px 70px;
    background: radial-gradient(rgba(10,11,15,.07) 1.3px, transparent 1.4px) 0 0 / 14px 14px, #f3eedf;
    font-family: Inter, sans-serif; color: #0a0b0f;
    display: grid; grid-template-rows: auto 1fr; gap: 34px;
  }
  header { display: grid; grid-template-columns: auto 1fr auto; align-items: end; gap: 28px; }
  .logo { display: flex; align-items: center; gap: 16px; }
  .bolt { width: 92px; height: 92px; display: grid; place-items: center; background: #ffd322; border: 5px solid #0a0b0f;
    font: italic 900 70px/1 'Barlow Condensed'; transform: rotate(-5deg); box-shadow: 6px 6px 0 #0a0b0f; }
  .name { font: italic 900 46px/.85 'Barlow Condensed'; letter-spacing: -.01em; }
  .name b { display: block; letter-spacing: .32em; font-size: 34px; }
  h1 { margin: 0; font: 400 150px/.8 Bangers; letter-spacing: .02em; color: #f04431;
    -webkit-text-stroke: 5px #0a0b0f; text-shadow: 9px 9px 0 #0a0b0f; }
  .issue { text-align: right; font: 800 22px/1.3 Inter; letter-spacing: .18em; }
  .issue span { display: block; max-width: 380px; margin-top: 8px; font: 600 19px/1.35 Inter; letter-spacing: 0; }
  main { display: grid; grid-template-columns: 1fr 1fr; grid-template-rows: 934fr 812fr 812fr; gap: 36px; min-height: 0; }
  .panel { position: relative; margin: 0; overflow: hidden; border: 8px solid #0a0b0f; background: #222; box-shadow: 10px 10px 0 rgba(10,11,15,.85); }
  .panel-1 { grid-column: 1 / -1; }
  .panel img { width: 100%; height: 100%; object-fit: cover; display: block; }
  figcaption { position: absolute; left: 20px; bottom: 20px; max-width: 70%; padding: 12px 18px 10px;
    background: #fff3b8; border: 5px solid #0a0b0f; box-shadow: 6px 6px 0 #0a0b0f;
    font: italic 800 40px/1.05 'Barlow Condensed'; }
  .panel-1 figcaption { left: auto; right: 24px; top: 24px; bottom: auto; max-width: 52%; }
  .bubble { position: absolute; left: 40px; top: 36px; max-width: 62%; padding: 22px 30px; background: #fff;
    border: 5px solid #0a0b0f; border-radius: 50%; font: 400 46px/1.05 Bangers; letter-spacing: .03em; text-align: center; }
  .bubble::after { content: ''; position: absolute; left: 34%; bottom: -34px; border: 20px solid transparent;
    border-top: 34px solid #0a0b0f; border-bottom: 0; transform: skewX(-25deg); }
  .sfx { position: absolute; right: 36px; top: 40px; font: 400 104px/1 Bangers; color: #ffd322;
    -webkit-text-stroke: 4px #0a0b0f; text-shadow: 7px 7px 0 #0a0b0f; transform: rotate(-9deg); }
  .panel-1 .sfx { right: auto; left: 25%; top: 46px; font-size: 120px; transform: rotate(-12deg); }
  .end { position: absolute; right: 26px; top: 28px; padding: 14px 22px 8px; border: 6px solid #0a0b0f;
    font: 400 86px/1 Bangers; letter-spacing: .03em; box-shadow: 8px 8px 0 #0a0b0f; transform: rotate(5deg); }
  .end--bad { background: #f04431; color: #fff9e9; }
  .end--good { background: #ffd322; color: #0a0b0f; }
</style></head><body>
  <header>
    <div class="logo"><div class="bolt">D</div><div class="name">DOGGIN’<b>AROUND</b></div></div>
    <h1>${escape(title)}</h1>
    <div class="issue">ISSUE NO. 01<span>${escape(blurb)}</span></div>
  </header>
  <main>${panels.map(panel).join('')}</main>
</body></html>`;
}

function findBrowser() {
  const candidates = [
    process.env.BROWSER,
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
    'C:/Program Files/Microsoft/Edge/Application/msedge.exe',
    '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
    '/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge',
    '/usr/bin/google-chrome',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ];
  const found = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!found) throw new Error('No Chrome or Edge found: set BROWSER to its executable');
  return found;
}

const { values } = parseArgs({ options: { ending: { type: 'string' } } });
const endings = values.ending ? [values.ending] : ['bad', 'good'];
const browser = findBrowser();
const work = mkdtempSync(path.join(tmpdir(), 'comic-page-'));
try {
  for (const ending of endings) {
    if (!PAGES[ending]) throw new Error(`Unknown ending "${ending}" (bad or good)`);
    const html = path.join(work, `${ending}.html`);
    writeFileSync(html, pageHtml(ending));
    const out = path.join(COMIC, `storm-night-${ending}-ending.png`);
    execFileSync(browser, [
      '--headless=new',
      '--disable-gpu',
      '--hide-scrollbars',
      '--force-device-scale-factor=1',
      '--allow-file-access-from-files',
      `--user-data-dir=${path.join(work, 'profile')}`,
      `--window-size=${WIDTH},${HEIGHT}`,
      '--virtual-time-budget=10000',
      `--screenshot=${out}`,
      pathToFileURL(html).href,
    ], { stdio: 'ignore' });
    console.log(`Wrote ${path.relative(ROOT, out)}`);
  }
} finally {
  rmSync(work, { recursive: true, force: true });
}
