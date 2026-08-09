#!/usr/bin/env node
/**
 * record-tenwords-demo.mjs - records the TenWords Chrome extension condensing a
 * real Wikipedia article, for the ProductDemo composition.
 *
 * Prereq: the TenWords service running on :4710 with a funded key:
 *   cd C:\Projects\tenwords && npm start
 *
 * Output: ../../studio/public/tenwords/demo.webm + ../../props/tenwords-demo.json
 *
 * Two things are specific to this capture and load-bearing:
 *
 * 1. EXTENSION LOADING. agent-browser cannot load unpacked extensions and
 *    CDP-injected hotkeys never reach Chrome's extension-command dispatcher, so
 *    the extension is loaded with launchPersistentContext + --load-extension and
 *    triggered by evaluating chrome.scripting.executeScript INSIDE the service
 *    worker (exactly what the toolbar click and Alt+T both do).
 * 2. activeTab IS NOT GRANTED to a programmatic trigger, so this script films a
 *    SCRATCH COPY of extension/ whose manifest adds an explicit host permission
 *    for the article host. Nothing user-visible differs; the production manifest
 *    in the product repo is never touched.
 *
 * Camera focus rects are MEASURED from real element bounding boxes (viewport px
 * == webm px because recordVideo.size == viewport), never derived from clicks.
 */
import {chromium} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {cpSync, mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Recorder} from './recorder.mjs';
import {cacheKey, checkCache, storeCache} from '../../scripts/lib/cache.mjs';
import {captureKeyParts} from './capture-cache.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const TW_ROOT = process.env.TW_ROOT ?? 'C:/Projects/tenwords';
const SERVICE = 'http://localhost:4710';
const ARTICLE = 'https://en.wikipedia.org/wiki/Speed_reading';
const ARTICLE_HOST_MATCH = 'https://en.wikipedia.org/*';

const VIEWPORT = {width: 1440, height: 900};
const SETTLE_MS = 700;
const HOLD = {read: 5000, wide: 2200, folded: 3400, detail: 4400, banner: 4400, skim: 3200, restore: 5200};
const CONDENSE_TIMEOUT_MS = 90_000;

// --- Footage cache gate (before any browser launch or app-reachability check) ---
const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const CHECK_ONLY = argv.includes('--cache-check-only');
const videoOut = join(ROOT, 'studio', 'public', 'tenwords', 'demo.mp4');
const propsOut = join(ROOT, 'props', 'tenwords-demo.json');
const CACHE_ARTIFACTS = [videoOut, propsOut];
const keyParts = captureKeyParts({
  repo: TW_ROOT,
  scriptPath: fileURLToPath(import.meta.url),
  config: {viewport: VIEWPORT, article: ARTICLE, holds: HOLD, settleMs: SETTLE_MS},
});
const CACHE_KEY = cacheKey(keyParts);
const CACHE_ENABLED = keyParts.productHead !== null;

if (CHECK_ONLY) {
  const {hit} = CACHE_ENABLED ? checkCache('tenwords', 'capture', CACHE_KEY, CACHE_ARTIFACTS) : {hit: false};
  console.log(hit ? 'HIT' : 'MISS');
  process.exit(0);
}
if (!CACHE_ENABLED) {
  console.log(`capture cache: product git state unavailable at ${TW_ROOT} - caching disabled this run`);
} else if (!FORCE) {
  const {hit} = checkCache('tenwords', 'capture', CACHE_KEY, CACHE_ARTIFACTS);
  if (hit) {
    console.log(`capture cache hit - reusing ${videoOut}`);
    process.exit(0);
  }
}

try {
  const res = await fetch(SERVICE, {signal: AbortSignal.timeout(3000)});
  if (res.status >= 500) throw new Error(`server error ${res.status}`);
} catch {
  console.error(`TenWords service unreachable at ${SERVICE}. Start it: cd ${TW_ROOT} && npm start`);
  process.exit(1);
}

// Scratch extension copy: production manifest + one host permission, so the
// programmatic trigger has the access a real toolbar click would grant.
const EXT_SRC = join(TW_ROOT, 'extension');
const EXT_DIR = join(ROOT, 'out', 'capture', 'tenwords-ext');
rmSync(EXT_DIR, {recursive: true, force: true});
cpSync(EXT_SRC, EXT_DIR, {recursive: true});
const manifest = JSON.parse(readFileSync(join(EXT_DIR, 'manifest.json'), 'utf8'));
if (!manifest.host_permissions.includes(ARTICLE_HOST_MATCH)) {
  manifest.host_permissions.push(ARTICLE_HOST_MATCH);
}
writeFileSync(join(EXT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');

const durationMs = (file) =>
  Math.round(
    parseFloat(
      execFileSync(
        'ffprobe',
        ['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', file],
        {encoding: 'utf8'},
      ).trim(),
    ) * 1000,
  );

const clampFocus = (box, {padX = 48, padY = 48} = {}) => {
  const w = Math.min(VIEWPORT.width, box.width + padX * 2);
  const h = Math.min(VIEWPORT.height, box.height + padY * 2);
  const x = Math.min(Math.max(box.x + box.width / 2, w / 2), VIEWPORT.width - w / 2);
  const y = Math.min(Math.max(box.y + box.height / 2, h / 2), VIEWPORT.height - h / 2);
  return {x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h)};
};

// The paragraphs the extension acts on, in document order. Before the fold that is
// the content script's own rule (<p> in article/main/body, >= 16 words); after the
// fold those same elements are 10 words long, so they are found by their marker.
// Index k means the same paragraph in both modes.
// Runs in the page; must be self-contained (page.evaluate ships the source, not the closure).
const PARA_RECT = ([mode, from, to]) => {
  const pick = () => {
    if (mode === 'condensed') return [...document.querySelectorAll('[data-tenwords]')];
    const c = document.querySelector('article') || document.querySelector('main') || document.body;
    return [...c.querySelectorAll('p')].filter(
      (p) => p.textContent.trim().split(/\s+/).filter(Boolean).length >= 16,
    );
  };
  const ps = pick().slice(from, to);
  if (ps.length === 0) return null;
  const rs = ps.map((p) => p.getBoundingClientRect());
  const x = Math.min(...rs.map((r) => r.left));
  const y = Math.min(...rs.map((r) => r.top));
  return {
    x,
    y,
    width: Math.max(...rs.map((r) => r.right)) - x,
    height: Math.max(...rs.map((r) => r.bottom)) - y,
  };
};

const PARA_OFFSET = ([mode, i, targetY]) => {
  const pick = () => {
    if (mode === 'condensed') return [...document.querySelectorAll('[data-tenwords]')];
    const c = document.querySelector('article') || document.querySelector('main') || document.body;
    return [...c.querySelectorAll('p')].filter(
      (p) => p.textContent.trim().split(/\s+/).filter(Boolean).length >= 16,
    );
  };
  const el = pick()[i];
  return el ? el.getBoundingClientRect().top - targetY : 0;
};

const videoDir = join(ROOT, 'out', 'capture');
mkdirSync(videoDir, {recursive: true});
const userDataDir = join(ROOT, 'out', 'capture', 'tenwords-profile');
rmSync(userDataDir, {recursive: true, force: true});

let context;
try {
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false, // unpacked extensions need a headed persistent context
    viewport: VIEWPORT,
    deviceScaleFactor: 2, // supersampled render downscaled into the webm
    recordVideo: {dir: videoDir, size: VIEWPORT},
    args: [
      `--disable-extensions-except=${EXT_DIR}`,
      `--load-extension=${EXT_DIR}`,
      '--no-first-run',
      '--no-default-browser-check',
      '--window-position=0,0',
    ],
  });

  let sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker', {timeout: 20_000}));
  const page = context.pages()[0] ?? (await context.newPage());
  // Site-side fundraising/notice banners are not product UI; keep them out of frame.
  await context.addInitScript(`
    (() => {
      const sweep = () => document
        .querySelectorAll('#centralNotice, .mw-dismissable-notice, #frbanner, .frb')
        .forEach((n) => n.remove());
      sweep();
      setInterval(sweep, 200);
    })();
  `);
  const rec = new Recorder();

  const smoothScroll = (dy, ms) =>
    page.evaluate(
      ([d, t]) =>
        new Promise((done) => {
          const start = window.scrollY;
          const t0 = performance.now();
          const step = (now) => {
            const p = Math.min((now - t0) / t, 1);
            const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
            window.scrollTo(0, start + d * e);
            if (p < 1) requestAnimationFrame(step);
            else done();
          };
          requestAnimationFrame(step);
        }),
      [dy, ms],
    );

  // Put paragraph `index` at `targetY` in the viewport, smoothly.
  const scrollParaTo = async (mode, index, targetY, ms = 900) => {
    const dy = await page.evaluate(PARA_OFFSET, [mode, index, targetY]);
    if (Math.abs(dy) > 2) await smoothScroll(dy, ms);
  };

  const focusParas = async (mode, from, to, opts = {}) => {
    await page.waitForTimeout(SETTLE_MS);
    const box = await page.evaluate(PARA_RECT, [mode, from, to]);
    if (!box) throw new Error(`no ${mode} paragraphs in range ${from}..${to}`);
    const f = clampFocus(box, opts);
    rec.focusAt(f.x, f.y, {w: f.w, h: f.h});
    return f;
  };

  const focusWide = () => rec.focusAt(VIEWPORT.width / 2, VIEWPORT.height / 2, {w: VIEWPORT.width, h: VIEWPORT.height});

  await page.goto(ARTICLE, {waitUntil: 'load'});
  await page.locator('#firstHeading').waitFor({timeout: 30_000});
  const blockCount = await page.evaluate(() => {
    const c = document.querySelector('article') || document.querySelector('main') || document.body;
    return [...c.querySelectorAll('p')].filter(
      (p) => p.textContent.trim().split(/\s+/).filter(Boolean).length >= 16,
    ).length;
  });
  if (blockCount < 8) throw new Error(`only ${blockCount} qualifying paragraphs - wrong page state?`);
  // Wikipedia's pinned Appearance panel is site chrome, not article. Unpinning it is a
  // one-click reader preference and gives the text column the frame.
  const unpin = page.locator('#vector-appearance .vector-pinnable-header-unpin-button');
  await unpin.click({timeout: 5000});
  await unpin.waitFor({state: 'hidden', timeout: 5000});
  await page.waitForTimeout(SETTLE_MS * 2); // images/layout settle before the first frame

  const beats = {};
  rec.start();

  // 1. The article as it ships: long paragraphs, one after another.
  // The resting click happens at the top of the page (heading in view, so Playwright
  // never auto-scrolls) and gives the synthetic cursor an honest origin.
  rec.step('A real article. Every paragraph runs long.');
  await rec.click(page.locator('#firstHeading'), null, {position: {x: 14, y: 22}});
  await page.waitForTimeout(600);
  await scrollParaTo('long', 1, 200, 1300); // ease into the reading position
  await focusParas('long', 1, 3, {padX: 44, padY: 40});
  await page.waitForTimeout(HOLD.read);

  // 2. Pull back to the whole page, then hand it to the extension.
  rec.step('One shortcut hands the whole page to TenWords.');
  focusWide();
  await page.waitForTimeout(HOLD.wide);

  beats.trigger = rec.finish(VIEWPORT).durationMs;
  sw = context.serviceWorkers()[0] ?? sw; // MV3 workers recycle; take the live one
  // NOT awaited: executeScript waits for the injected script's returned promise,
  // so awaiting here would block until the whole condense had already finished and
  // the progress toast was gone. Settled at the end of the take instead.
  const triggered = sw
    .evaluate(async (match) => {
      const tabs = await chrome.tabs.query({url: match});
      if (tabs.length === 0) throw new Error('no article tab visible to the extension');
      await chrome.scripting.executeScript({target: {tabId: tabs[0].id}, files: ['content.js']});
    }, ARTICLE_HOST_MATCH)
    .then(() => null, (err) => err);

  // 3. The real wait. The camera stays wide and the reader drifts a little, so the
  //    product's own latency is not a frozen frame.
  await page.locator('#__tenwords_toast').waitFor({timeout: 15_000});
  rec.step('It reads every paragraph before anything changes.');
  const folded = page
    .locator('[data-tenwords]')
    .first()
    .waitFor({timeout: CONDENSE_TIMEOUT_MS})
    .then(() => {
      beats.fold = rec.finish(VIEWPORT).durationMs; // stamped the moment it lands
    });
  await smoothScroll(150, 4000);
  await folded;

  // 4a. THE FOLD, the whole page at once, wide so the cascade plays out in frame.
  rec.step('Every paragraph folds to exactly ten words.');
  await page.locator('#__tenwords_banner').waitFor({timeout: 30_000});
  await page.waitForTimeout(HOLD.folded);

  // 4b. Push into the folded text: ten words and a red pilcrow.
  await scrollParaTo('condensed', 0, 230, 900);
  rec.step('A red pilcrow marks where each one was.');
  await focusParas('condensed', 0, 3, {padX: 52, padY: 48});
  await page.waitForTimeout(HOLD.detail);

  // 5. The TL;DR banner, read wide so the whole line fits.
  rec.step('The whole article gets one ten-word line.');
  focusWide();
  await page.waitForTimeout(HOLD.banner);

  // 6. Further down the page, folded the same way.
  await scrollParaTo('condensed', 4, 300, 1200);
  rec.step('The rest of the page reads the same way.');
  await focusParas('condensed', 4, 7, {padX: 52, padY: 48});
  await page.waitForTimeout(HOLD.detail);

  // 7. Skim it all.
  rec.step('Skim it all at ten words a paragraph.');
  focusWide();
  await page.waitForTimeout(700);
  const room = await page.evaluate(
    () => document.documentElement.scrollHeight - window.innerHeight - window.scrollY,
  );
  await smoothScroll(Math.max(0, Math.min(1100, room)), 4000);
  await page.waitForTimeout(HOLD.skim);

  // 8. The reverse fold: restore brings the article back, wide so the whole page returns.
  await scrollParaTo('condensed', 3, 330, 1400);
  await page.waitForTimeout(SETTLE_MS);
  rec.step('One click brings the original article back.');
  focusWide();
  await page.waitForTimeout(1400);
  await rec.click(page.locator('#__tenwords_banner button'), null);
  beats.restore = rec.finish(VIEWPORT).durationMs;
  await page.locator('#__tenwords_banner').waitFor({state: 'detached', timeout: 10_000});
  await page.waitForTimeout(HOLD.restore);

  const telemetry = rec.finish(VIEWPORT);
  const triggerErr = await triggered;
  if (triggerErr) throw triggerErr;
  const video = page.video();
  await context.close(); // flushes the webm
  context = null;
  const src = await video.path();

  // ALIGNMENT: recording starts when the page is created, which is before rec.start().
  // Both stop at the same instant (context.close right after finish), so the head lead
  // is exactly videoDuration - telemetryDuration. Trim it off, and the composition's
  // assumption that video time == telemetry time holds.
  const destDir = join(ROOT, 'studio', 'public', 'tenwords');
  mkdirSync(destDir, {recursive: true});
  const rawMs = durationMs(src);
  const leadS = Math.max(0, (rawMs - telemetry.durationMs) / 1000);
  execFileSync(
    'ffmpeg',
    ['-y', '-ss', leadS.toFixed(3), '-i', src, '-an', '-c:v', 'libx264', '-crf', '18',
     '-preset', 'veryfast', '-pix_fmt', 'yuv420p', videoOut],
    {stdio: ['ignore', 'ignore', 'pipe']},
  );
  const outMs = durationMs(videoOut);
  const drift = Math.abs(outMs - telemetry.durationMs);
  if (drift > 250) {
    throw new Error(`video/telemetry drift ${drift}ms after trimming ${leadS}s - camera and captions would desync`);
  }

  const props = {
    brandId: 'tenwords',
    video: 'tenwords/demo.mp4',
    cta: 'Condense any long page at tenwords.io',
    telemetry,
  };
  writeFileSync(propsOut, JSON.stringify(props, null, 2) + '\n');
  if (CACHE_ENABLED) {
    storeCache('tenwords', 'capture', CACHE_KEY, CACHE_ARTIFACTS, {productRepo: TW_ROOT, productHead: keyParts.productHead});
  }
  const s = (ms) => Math.round((ms / 1000) * 100) / 100;
  console.log(`capture OK: ${telemetry.durationMs}ms, ${telemetry.events.length} events, ${blockCount} paragraphs`);
  console.log(`beats: trigger ${s(beats.trigger)}s, fold ${s(beats.fold)}s, restore ${s(beats.restore)}s`);
  console.log(`trimmed ${leadS.toFixed(2)}s of pre-roll; video ${outMs}ms vs telemetry ${telemetry.durationMs}ms`);
  console.log('wrote studio/public/tenwords/demo.mp4 and props/tenwords-demo.json');
} catch (err) {
  console.error(String(err?.stack ?? err));
  process.exitCode = 1;
} finally {
  if (context) await context.close();
}
