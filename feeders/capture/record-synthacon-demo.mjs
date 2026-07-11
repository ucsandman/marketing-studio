#!/usr/bin/env node
/**
 * record-synthacon-demo.mjs - records a Synthacon marketplace walkthrough for ProductDemo.
 *
 * Prereq: the Synthacon app running locally with seed data. The dev stack runs under
 * the Bitwarden secrets wrapper (apps/api/.env is absent by design), e.g.:
 *   cd C:/…/synthacon-app && synth-bws dev -- pnpm dev
 * which serves web on http://localhost:5173 (Vite) proxying /api to the api on :3000.
 * The whole filmed flow is PUBLIC (anon-browsable): the splash "/", the marketplace
 * grid "/market", and gear detail "/market/:id" all render without auth.
 *
 * Output: ../../studio/public/synthacon/demo.webm
 *        + ../../props/synthacon-demo.capture.json  (raw {video, telemetry} the
 *          builder scripts/build-synthacon-demo-props.mjs consumes — this recorder
 *          never writes props/synthacon-demo.json; the builder is its only writer.)
 *
 * Capture presentation (dry-run, seeded dev data; footage is internal-only):
 *  - cookie-consent banner suppressed via localStorage (synthacon-cookie-consent),
 *    and the app forced to its dark theme (synthacon-theme) so the footage sits
 *    on-brand inside ProductDemo's dark frame.
 *  - the splash hero's dev-seed stat tiles ([data-testid^="hero-stat-"]) are stripped
 *    before filming: those counts are seeded metrics and must never be baked in, even
 *    for a dry run (the marketplace's no-fake-metrics rule).
 *  - dev overlays (Vite error overlay, TanStack Query devtools) are swept on an
 *    interval, shadow roots pierced, so none land in a frame.
 * No product code is touched; these are page-side presentation shims only.
 *
 * Camera focus rects are MEASURED from each target element's real boundingBox
 * (viewport px == webm px because recordVideo.size == viewport), never from click
 * points. `document.fonts.ready` is awaited before measuring/recording so the
 * Material Symbols icon font never flashes its ligature source text into a frame.
 */
import {chromium} from '@playwright/test';
import {mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Recorder} from './recorder.mjs';
import {cacheKey, checkCache, storeCache} from '../../scripts/lib/cache.mjs';
import {captureKeyParts} from './capture-cache.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const base = process.env.SYN_WEB ?? 'http://localhost:5173';
// Product repo: the app is reached over the port, but the cache must fingerprint the
// source it films. Default is the synthacon-app main checkout.
const SYN_APP_ROOT = process.env.SYN_APP_ROOT ?? '/Users/lynx/projects/synthacon/synthacon-app';
const VIEWPORT = {width: 1440, height: 900};
const VIEW_HOLD_MS = 4200;
const SETTLE_MS = 700; // let entrance animations / scroll settle before measuring
// The gear detail this flow opens: a real, recognizable listing that is for-rent and
// carries daily/weekly/monthly rental pricing — the rent/lend wedge is Synthacon's
// story, and this listing shows it directly. Chosen over other seed listings whose
// gallery blobs are a degenerate 1x1 pixel (they render as a flat off-brand fill);
// this one's placeholder art is a tasteful dark generative image. Overridable if the
// seed changes.
const LISTING_TITLE = process.env.SYN_LISTING_TITLE ?? 'Universal Audio Apollo Twin X';

// --- Footage cache gate (before the app-reachability check or browser launch) ---
const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const CHECK_ONLY = argv.includes('--cache-check-only');
const videoOut = join(ROOT, 'studio', 'public', 'synthacon', 'demo.webm');
const captureOut = join(ROOT, 'props', 'synthacon-demo.capture.json');
const CACHE_ARTIFACTS = [videoOut, captureOut];
const keyParts = captureKeyParts({
  repo: SYN_APP_ROOT,
  scriptPath: fileURLToPath(import.meta.url),
  config: {viewport: VIEWPORT, holdMs: VIEW_HOLD_MS, settleMs: SETTLE_MS, listing: LISTING_TITLE},
});
const CACHE_KEY = cacheKey(keyParts);
const CACHE_ENABLED = keyParts.productHead !== null; // null => product repo unresolvable, cannot verify inputs

if (CHECK_ONLY) {
  const {hit} = CACHE_ENABLED ? checkCache('synthacon', 'capture', CACHE_KEY, CACHE_ARTIFACTS) : {hit: false};
  console.log(hit ? 'HIT' : 'MISS');
  process.exit(0);
}
if (!CACHE_ENABLED) {
  console.log(`capture cache: product git state unavailable at ${SYN_APP_ROOT} — caching disabled this run`);
} else if (!FORCE) {
  const {hit} = checkCache('synthacon', 'capture', CACHE_KEY, CACHE_ARTIFACTS);
  if (hit) {
    console.log(`capture cache hit — reusing ${videoOut}`);
    process.exit(0);
  }
}

try {
  const res = await fetch(`${base}/api/health`, {signal: AbortSignal.timeout(4000)});
  if (!res.ok) throw new Error(`api health ${res.status}`);
} catch (err) {
  console.error(`App/api unreachable at ${base} (${String(err?.message ?? err)}). Start the stack: synth-bws dev -- pnpm dev (web on :5173 → api on :3000).`);
  process.exit(1);
}

// Force the dark theme + suppress the cookie-consent banner before any app script
// runs (both are read from localStorage on mount).
const PREP = `
  (() => {
    try {
      localStorage.setItem('synthacon-cookie-consent', 'rejected');
      localStorage.setItem('synthacon-theme', 'dark');
    } catch {}
  })();
`;

// Sweep dev overlays that a Vite/React dev server can inject (Vite error overlay in
// a shadow root; TanStack Query devtools button/panel). Belt-and-braces selectors for
// other frameworks' badges are harmless no-ops. Pierce every shadow root on an interval.
const HIDE_OVERLAYS = `
  (() => {
    const SEL = 'vite-error-overlay, [data-vite-error-overlay], .tsqd-parent-container, .tsqd-open-btn, [aria-label="Open Tanstack query devtools"], #devtools-indicator, nextjs-portal';
    const strip = (root) => {
      if (!root || !root.querySelectorAll) return;
      root.querySelectorAll(SEL).forEach((n) => n.remove());
      root.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) strip(e.shadowRoot); });
    };
    const sweep = () => strip(document);
    sweep();
    setInterval(sweep, 150);
    document.addEventListener('DOMContentLoaded', sweep);
  })();
`;

// Strip the splash hero's dev-seed stat tiles (they render on this seed because the
// counts clear the credibility floor). Remove the whole grid so no seeded metric is
// ever filmed. Interval sweep so it survives React re-renders.
const STRIP_STATS = `
  (() => {
    const strip = () => {
      document.querySelectorAll('[data-testid^="hero-stat-"]').forEach((n) => {
        (n.closest('div.grid') || n.parentElement || n).remove();
      });
    };
    strip();
    setInterval(strip, 200);
    document.addEventListener('DOMContentLoaded', strip);
  })();
`;

// A focus rect of w x h centered on a content box, clamped so it never leaves the
// viewport and never exceeds it (pads the raw box, caps at the viewport).
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
  await context.addInitScript(PREP);
  await context.addInitScript(HIDE_OVERLAYS);
  await context.addInitScript(STRIP_STATS);
  const page = await context.newPage();
  const rec = new Recorder();

  // Resolve a target (CSS/text selector string OR a Locator) to its first box.
  const boxOf = async (target) => {
    const loc = typeof target === 'string' ? page.locator(target).first() : target;
    const box = await loc.boundingBox();
    if (!box) throw new Error(`focus target has no bounding box: ${typeof target === 'string' ? target : '<locator>'}`);
    return box;
  };

  // Scroll a target into view, settle, then focus a padded rect on it (caption is
  // set separately). biasY nudges the framed centre after clamping.
  const focusOn = async (target, {padX, padY, biasY = 0} = {}) => {
    const loc = typeof target === 'string' ? page.locator(target).first() : target;
    await loc.scrollIntoViewIfNeeded();
    await page.waitForTimeout(SETTLE_MS);
    const f = clampFocus(await boxOf(loc), {padX, padY});
    f.y = Math.min(Math.max(f.y + biasY, f.h / 2), VIEWPORT.height - f.h / 2);
    rec.focusAt(f.x, f.y, {w: f.w, h: f.h});
  };

  // Focus the union of two targets' boxes (an establishing rect spanning both).
  const focusUnion = async (a, b, {padX = 40, padY = 40, biasY = 0} = {}) => {
    const [ba, bb] = [await boxOf(a), await boxOf(b)];
    const x0 = Math.min(ba.x, bb.x);
    const y0 = Math.min(ba.y, bb.y);
    const x1 = Math.max(ba.x + ba.width, bb.x + bb.width);
    const y1 = Math.max(ba.y + ba.height, bb.y + bb.height);
    const f = clampFocus({x: x0, y: y0, width: x1 - x0, height: y1 - y0}, {padX, padY});
    f.y = Math.min(Math.max(f.y + biasY, f.h / 2), VIEWPORT.height - f.h / 2);
    rec.focusAt(f.x, f.y, {w: f.w, h: f.h});
  };

  rec.start();

  // 1. Splash hero — "The Gear Nexus" + the CSS-3D synth (public marketing surface).
  await page.goto(`${base}/`, {waitUntil: 'networkidle'});
  await page.getByRole('heading', {name: /The Gear Nexus/i}).waitFor({timeout: 20_000});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(SETTLE_MS);
  rec.step('Buy, sell, and rent studio gear.');
  await focusUnion('h1', '[data-testid=hero-synth]', {padX: 40, padY: 48});
  await page.waitForTimeout(VIEW_HOLD_MS);

  // 2. Marketplace grid — establish the browse grid on the listing we open next.
  await page.goto(`${base}/market`, {waitUntil: 'networkidle'});
  await page.locator('[data-testid=gear-card]').first().waitFor({timeout: 20_000});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(SETTLE_MS);
  const cardA = page.locator('[data-testid=gear-card]', {hasText: LISTING_TITLE}).first();
  await cardA.scrollIntoViewIfNeeded();
  await page.waitForTimeout(SETTLE_MS);
  rec.step('Browse gear from people nearby.');
  await focusOn(cardA, {padX: 150, padY: 96}); // the target card plus its neighbours
  await page.waitForTimeout(VIEW_HOLD_MS);

  // 3. Open a listing — a real cursor click into gear detail (public route), then an
  //    establishing frame of the whole listing (gallery + rental card).
  rec.step('Open a listing.');
  await rec.click(cardA); // logs cursor + performs the real click
  await page.waitForURL(/\/market\/[a-z0-9]+$/i, {timeout: 15_000});
  await page.getByRole('heading', {name: new RegExp(LISTING_TITLE, 'i')}).first().waitFor({timeout: 20_000});
  const rentBtn = page.getByRole('button', {name: /Request to Rent/i}).first();
  await rentBtn.waitFor({timeout: 20_000});
  await page.locator('[data-testid=gallery-main]').first().waitFor({timeout: 20_000});
  await page.evaluate(() => document.fonts.ready);
  await page.waitForTimeout(SETTLE_MS);
  await focusUnion('[data-testid=gallery-main]', rentBtn, {padX: 24, padY: 30}); // whole listing reveal
  await page.waitForTimeout(VIEW_HOLD_MS);

  // 4. Rent it — push in on the rental card: daily/weekly/monthly pricing + Request to
  //    Rent. Renting is built in, not bolted on, and this is the rent/lend wedge that
  //    is Synthacon's story: the close. The card = the nearest ancestor of the rent
  //    button that carries the rental tiers.
  const rentCardBox = await page.evaluate(() => {
    const btn = [...document.querySelectorAll('button')].find((b) => /Request to Rent/i.test(b.textContent));
    if (!btn) return null;
    let el = btn;
    for (let i = 0; i < 6; i++) {
      el = el.parentElement;
      if (!el) break;
      if (/Weekly|\/\s?day/i.test(el.textContent) && el.querySelector('button')) {
        const r = el.getBoundingClientRect();
        return {x: r.x, y: r.y, width: r.width, height: r.height};
      }
    }
    return null;
  });
  rec.step('Rent it by the day, week, or month.');
  if (rentCardBox) {
    const f = clampFocus(rentCardBox, {padX: 30, padY: 26});
    rec.focusAt(f.x, f.y, {w: f.w, h: f.h});
  } else {
    await focusOn(rentBtn, {padX: 60, padY: 150});
  }
  await page.waitForTimeout(VIEW_HOLD_MS);

  const telemetry = rec.finish(VIEWPORT);
  const video = page.video();
  await context.close(); // flushes the webm
  const src = await video.path();

  const destDir = join(ROOT, 'studio', 'public', 'synthacon');
  mkdirSync(destDir, {recursive: true});
  const {copyFileSync} = await import('node:fs');
  copyFileSync(src, join(destDir, 'demo.webm'));

  // Raw capture facts only. Copy (brandId, cta, brief overlay) is the builder's job.
  const capture = {video: 'synthacon/demo.webm', telemetry};
  writeFileSync(captureOut, JSON.stringify(capture, null, 2) + '\n');
  if (CACHE_ENABLED) storeCache('synthacon', 'capture', CACHE_KEY, CACHE_ARTIFACTS);
  console.log(`capture OK: ${telemetry.durationMs}ms, ${telemetry.events.length} events`);
  console.log('wrote studio/public/synthacon/demo.webm and props/synthacon-demo.capture.json');
} catch (err) {
  console.error(String(err?.message ?? err));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
