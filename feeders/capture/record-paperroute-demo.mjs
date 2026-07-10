#!/usr/bin/env node
/**
 * record-paperroute-demo.mjs - records a PaperRoute walkthrough for ProductDemo.
 *
 * Prereq: the product app running with demo seed data on localhost:
 *   cd C:\Projects\wallpaper-ad && python scripts/launch.py --no-desktop --demo --port 3777
 * (DEV_AUTH=1 stub signs in automatically; no tokens or credentials needed.)
 *
 * Output: ../../studio/public/paperroute/demo.webm + ../../props/paperroute-demo.json
 *
 * Camera focus rects are MEASURED from each target element's real boundingBox
 * (viewport px == webm px because recordVideo.size == viewport), never derived
 * from click points. Pages are separate routes, so we navigate with goto.
 */
import {chromium} from '@playwright/test';
import {copyFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Recorder} from './recorder.mjs';
import {cacheKey, checkCache, storeCache} from '../../scripts/lib/cache.mjs';
import {captureKeyParts} from './capture-cache.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = process.env.PR_PORT ?? '3777';
// Product repo: the app is reached over the port, but the cache must fingerprint
// the source it films. Default matches the launch command in this file's header.
const PR_ROOT = process.env.PR_ROOT ?? 'C:/Projects/wallpaper-ad';
const base = `http://localhost:${PORT}`;
const VIEWPORT = {width: 1440, height: 900};
const VIEW_HOLD_MS = 4000;
const SETTLE_MS = 700; // let entrance animations / scroll settle before measuring

// --- Footage cache gate (before the app-reachability check or browser launch) ---
const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const CHECK_ONLY = argv.includes('--cache-check-only');
const videoOut = join(ROOT, 'studio', 'public', 'paperroute', 'demo.webm');
const propsOut = join(ROOT, 'props', 'paperroute-demo.json');
const CACHE_ARTIFACTS = [videoOut, propsOut];
const keyParts = captureKeyParts({
  repo: PR_ROOT,
  scriptPath: fileURLToPath(import.meta.url),
  config: {viewport: VIEWPORT, holdMs: VIEW_HOLD_MS, settleMs: SETTLE_MS},
});
const CACHE_KEY = cacheKey(keyParts);
const CACHE_ENABLED = keyParts.productHead !== null; // null => product repo unresolvable, cannot verify inputs

if (CHECK_ONLY) {
  const {hit} = CACHE_ENABLED ? checkCache('paperroute', 'capture', CACHE_KEY, CACHE_ARTIFACTS) : {hit: false};
  console.log(hit ? 'HIT' : 'MISS');
  process.exit(0);
}
if (!CACHE_ENABLED) {
  console.log(`capture cache: product git state unavailable at ${PR_ROOT} — caching disabled this run`);
} else if (!FORCE) {
  const {hit} = checkCache('paperroute', 'capture', CACHE_KEY, CACHE_ARTIFACTS);
  if (hit) {
    console.log(`capture cache hit — reusing ${videoOut}`);
    process.exit(0);
  }
}

try {
  const res = await fetch(`${base}/dashboard`, {signal: AbortSignal.timeout(3000)});
  if (res.status >= 500) throw new Error(`server error ${res.status}`);
} catch {
  console.error(`App unreachable at ${base}. Start it: cd C:\\Projects\\wallpaper-ad && python scripts/launch.py --no-desktop --demo --port ${PORT}`);
  process.exit(1);
}

// Kill the Next.js dev-tools indicator (dark circular "N", bottom-left). It lives
// inside a SHADOW ROOT (#devtools-indicator in a nextjs-portal shadow tree), so a
// light-DOM style/removal never reaches it. Walk every shadow root on an interval
// and remove it, so it never lands in a frame.
const HIDE_DEVTOOLS = `
  (() => {
    const strip = (root) => {
      if (!root || !root.querySelectorAll) return;
      root.querySelectorAll('#devtools-indicator, nextjs-portal, [data-next-badge-root], [data-nextjs-dev-tools-button]').forEach((n) => n.remove());
      root.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) strip(e.shadowRoot); });
    };
    const sweep = () => strip(document);
    sweep();
    setInterval(sweep, 150);
    document.addEventListener('DOMContentLoaded', sweep);
  })();
`;

const clampFocus = (box, {padX = 48, padY = 48} = {}) => {
  const w = Math.min(VIEWPORT.width, box.width + padX * 2);
  const h = Math.min(VIEWPORT.height, box.height + padY * 2);
  const x = Math.min(Math.max(box.x + box.width / 2, w / 2), VIEWPORT.width - w / 2);
  const y = Math.min(Math.max(box.y + box.height / 2, h / 2), VIEWPORT.height - h / 2);
  return {x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h)};
};

const videoDir = join(ROOT, 'out', 'capture');
mkdirSync(videoDir, {recursive: true});
let browser;
try {
  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2, // supersampled render downscaled into the webm: crisper footage
    recordVideo: {dir: videoDir, size: VIEWPORT},
  });
  await context.addInitScript(HIDE_DEVTOOLS);
  const page = await context.newPage();
  const rec = new Recorder();

  // Focus one measured element after settling; caption is the step label.
  const focusOn = async (selector, {padX, padY, biasY = 0} = {}) => {
    const loc = page.locator(selector).first();
    await loc.scrollIntoViewIfNeeded();
    await page.waitForTimeout(SETTLE_MS);
    const box = await loc.boundingBox();
    if (!box) throw new Error(`focus target ${selector} has no bounding box`);
    const f = clampFocus(box, {padX, padY});
    f.y = Math.min(Math.max(f.y + biasY, f.h / 2), VIEWPORT.height - f.h / 2);
    rec.focusAt(f.x, f.y, {w: f.w, h: f.h});
  };

  rec.start();

  // 1. Dashboard - available balance (the ledger sum, the hero number)
  await page.goto(`${base}/dashboard`, {waitUntil: 'networkidle'});
  await page.getByText('available balance', {exact: false}).first().waitFor({timeout: 20_000});
  await page.waitForTimeout(SETTLE_MS);
  rec.step('Available balance, summed from the ledger. Never a counter.');
  await focusOn('section:has(p.tag)', {padX: 40, padY: 40}); // hero section
  await page.waitForTimeout(VIEW_HOLD_MS);

  // 2. Dashboard - 14-day earnings chart
  rec.step('Fourteen days of earnings, measured by the minute.');
  await focusOn('svg', {padX: 40, padY: 56}); // history chart svg
  await page.waitForTimeout(VIEW_HOLD_MS);

  // 3. Dashboard - receipts, first-dollar milestone marked
  rec.step('Every earning day prints a receipt. The first dollar is marked.');
  await focusOn('li:has(.tag)', {padX: 40, padY: 110}); // milestone receipt row, centered
  await page.waitForTimeout(VIEW_HOLD_MS);

  // 4. Landing hero - the measured rectangle on the wallpaper
  await page.goto(`${base}/`, {waitUntil: 'networkidle'});
  await page.getByRole('heading', {name: /This desktop earns/i}).waitFor({timeout: 20_000});
  await page.waitForTimeout(SETTLE_MS);
  rec.step('The whole product: one ad, the measured rectangle, the running total.');
  await focusOn('.desk-ad-wrap', {padX: 90, padY: 90});
  await page.waitForTimeout(VIEW_HOLD_MS);

  // 5. Transparency - the public formula (scroll moment)
  await page.goto(`${base}/transparency`, {waitUntil: 'networkidle'});
  await page.getByRole('heading', {name: /The formula/i}).waitFor({timeout: 20_000});
  rec.step('The math is public. The code runs these exact constants.');
  await focusOn('pre', {padX: 60, padY: 150, biasY: -40}); // the cents = ... code block
  await page.waitForTimeout(VIEW_HOLD_MS);

  const telemetry = rec.finish(VIEWPORT);
  const video = page.video();
  await context.close(); // flushes the webm
  const src = await video.path();

  const destDir = join(ROOT, 'studio', 'public', 'paperroute');
  mkdirSync(destDir, {recursive: true});
  copyFileSync(src, join(destDir, 'demo.webm'));

  const props = {
    brandId: 'paperroute',
    video: 'paperroute/demo.webm',
    cta: 'Put the idle corner to work · paperroute.gg',
    telemetry,
  };
  writeFileSync(join(ROOT, 'props', 'paperroute-demo.json'), JSON.stringify(props, null, 2) + '\n');
  if (CACHE_ENABLED) storeCache('paperroute', 'capture', CACHE_KEY, CACHE_ARTIFACTS);
  console.log(`capture OK: ${telemetry.durationMs}ms, ${telemetry.events.length} events`);
  console.log('wrote studio/public/paperroute/demo.webm and props/paperroute-demo.json');
} catch (err) {
  console.error(String(err?.message ?? err));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
