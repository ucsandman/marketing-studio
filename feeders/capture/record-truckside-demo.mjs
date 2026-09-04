#!/usr/bin/env node
/**
 * record-truckside-demo.mjs - records a Truckside owner-dashboard walkthrough for ProductDemo.
 *
 * Prereq: the product app running with demo seed data on localhost:
 *   cd C:\Projects\tradesdesk && DEMO_MODE=1 npm run dev:next   (port 3007)
 * The /demo route mints the owner session and 302s to /app; no passcode needed.
 *
 * Output: ../../studio/public/truckside/demo.webm + ../../props/truckside-demo.json
 *
 * Camera focus rects are MEASURED from each target element's real boundingBox
 * (viewport px == webm px because recordVideo.size == viewport), never derived
 * from click points. The dashboard is one long route, so we scroll+focus.
 */
import {chromium} from '@playwright/test';
import {copyFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Recorder} from './recorder.mjs';
import {cacheKey, checkCache, storeCache} from '../../scripts/lib/cache.mjs';
import {captureKeyParts} from './capture-cache.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = process.env.TS_PORT ?? '3007';
const TS_ROOT = process.env.TS_ROOT ?? 'C:/Projects/tradesdesk';
const base = `http://localhost:${PORT}`;
const VIEWPORT = {width: 1440, height: 900};
const VIEW_HOLD_MS = 4000;
const SETTLE_MS = 700;

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const CHECK_ONLY = argv.includes('--cache-check-only');
const videoOut = join(ROOT, 'studio', 'public', 'truckside', 'demo.webm');
const propsOut = join(ROOT, 'props', 'truckside-demo.json');
const CACHE_ARTIFACTS = [videoOut, propsOut];
const keyParts = captureKeyParts({
  repo: TS_ROOT,
  scriptPath: fileURLToPath(import.meta.url),
  config: {viewport: VIEWPORT, holdMs: VIEW_HOLD_MS, settleMs: SETTLE_MS},
});
const CACHE_KEY = cacheKey(keyParts);
const CACHE_ENABLED = keyParts.productHead !== null;

if (CHECK_ONLY) {
  const {hit} = CACHE_ENABLED ? checkCache('truckside', 'capture', CACHE_KEY, CACHE_ARTIFACTS) : {hit: false};
  console.log(hit ? 'HIT' : 'MISS');
  process.exit(0);
}
if (!CACHE_ENABLED) {
  console.log(`capture cache: product git state unavailable at ${TS_ROOT} - caching disabled this run`);
} else if (!FORCE) {
  const {hit} = checkCache('truckside', 'capture', CACHE_KEY, CACHE_ARTIFACTS);
  if (hit) {
    console.log(`capture cache hit - reusing ${videoOut}`);
    process.exit(0);
  }
}

try {
  const res = await fetch(`${base}/`, {signal: AbortSignal.timeout(4000)});
  if (res.status >= 500) throw new Error(`server error ${res.status}`);
} catch {
  console.error(`App unreachable at ${base}. Start it: cd C:\\Projects\\tradesdesk && DEMO_MODE=1 npm run dev:next`);
  process.exit(1);
}

// Kill the Next.js dev-tools indicator (dark circular "N"). It lives inside a
// SHADOW ROOT, so a light-DOM removal never reaches it; sweep every shadow root.
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
    deviceScaleFactor: 2,
    recordVideo: {dir: videoDir, size: VIEWPORT},
  });
  await context.addInitScript(HIDE_DEVTOOLS);
  const page = await context.newPage();
  const rec = new Recorder();

  // Focus one measured element after settling; the top of a tall section is
  // biased into frame so the section header reads.
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

  // /demo mints the owner session and 302s to /app (the seeded dashboard).
  await page.goto(`${base}/demo`, {waitUntil: 'networkidle'});
  await page.getByRole('heading', {name: /Summit Garage/i}).waitFor({timeout: 20_000});
  await page.waitForTimeout(SETTLE_MS);

  // 1. Header - the shop, the day's counts, the Simulate missed call button.
  rec.step('The whole shop on one dashboard, run from the cab.');
  await focusOn('header', {padX: 30, padY: 30});
  await page.waitForTimeout(VIEW_HOLD_MS);

  // 2. Today's missed calls - the call answered and booked while on the job.
  rec.step('The missed call, answered and booked while you were on the job.');
  await focusOn('section:has(h2:has-text("missed calls"))', {padX: 36, padY: 40, biasY: -20});
  await page.waitForTimeout(VIEW_HOLD_MS);

  // 3. Quotes awaiting approval - the gate: a priced quote waiting for one tap.
  rec.step('A priced quote, waiting for your one-tap approval.');
  await focusOn('section:has(h2:has-text("Quotes awaiting approval"))', {padX: 36, padY: 40, biasY: -20});
  await page.waitForTimeout(VIEW_HOLD_MS);

  // 4. Upcoming appointments - confirm, reschedule, cancel.
  rec.step('You confirm, reschedule, or move each appointment.');
  await focusOn('section:has(h2:has-text("Upcoming appointments"))', {padX: 36, padY: 40, biasY: -20});
  await page.waitForTimeout(VIEW_HOLD_MS);

  // 5. Follow-ups due - drafted and held until due; approve queues the send.
  rec.step('Follow-ups drafted and held until they are due.');
  await focusOn('section:has(h2:has-text("Follow-ups due"))', {padX: 36, padY: 40, biasY: -20});
  await page.waitForTimeout(VIEW_HOLD_MS);

  // 6. Outbox - every send recorded as simulated; nothing leaves without a tap.
  rec.step('You approve every send, and in demo mode nothing leaves the app.');
  await focusOn('section:has(h2:has-text("Outbox"))', {padX: 36, padY: 40, biasY: -20});
  await page.waitForTimeout(VIEW_HOLD_MS);

  const telemetry = rec.finish(VIEWPORT);
  const video = page.video();
  await context.close(); // flushes the webm
  const src = await video.path();

  const destDir = join(ROOT, 'studio', 'public', 'truckside');
  mkdirSync(destDir, {recursive: true});
  copyFileSync(src, join(destDir, 'demo.webm'));

  const props = {
    brandId: 'truckside',
    video: 'truckside/demo.webm',
    cta: 'See it live at truckside.io',
    telemetry,
  };
  writeFileSync(propsOut, JSON.stringify(props, null, 2) + '\n');
  if (CACHE_ENABLED) storeCache('truckside', 'capture', CACHE_KEY, CACHE_ARTIFACTS, {productRepo: TS_ROOT, productHead: keyParts.productHead});
  console.log(`capture OK: ${telemetry.durationMs}ms, ${telemetry.events.length} events`);
  console.log('wrote studio/public/truckside/demo.webm and props/truckside-demo.json');
} catch (err) {
  console.error(String(err?.message ?? err));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
