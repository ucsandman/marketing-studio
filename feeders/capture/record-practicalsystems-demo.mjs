#!/usr/bin/env node
/**
 * record-practicalsystems-demo.mjs - records the practicalsystems.io walkthrough
 * for ProductDemo. The product IS the company: the public marketing site whose
 * homepage is a live operating console.
 *
 * Prereq: the website dev server running:
 *   cd "C:\Projects\Practical Systems\practical-systems-website" && npm run dev
 * (127.0.0.1, never localhost, on Windows.)
 *
 * Output: ../../studio/public/practicalsystems/demo.webm
 *       + ../../props/practicalsystems-demo.json
 *
 * Camera focus rects are MEASURED from each target element's real boundingBox
 * (viewport px == webm px because recordVideo.size == viewport), never derived
 * from click points.
 *
 * Deliberately NOT filmed: /our-system's embedded Mission Control screenshot.
 * It was captured 2026-08-08 and reads "stripe not wired", which contradicts
 * the scoreboard beat below (revenue reads live from Stripe).
 */
import {chromium} from '@playwright/test';
import {copyFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Recorder} from './recorder.mjs';
import {cacheKey, checkCache, storeCache} from '../../scripts/lib/cache.mjs';
import {captureKeyParts} from './capture-cache.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = process.env.PS_PORT ?? '3000';
// Product repo: reached over the port, but the cache must fingerprint the source
// it films. Default matches the launch command in this file's header.
const PS_ROOT = process.env.PS_ROOT ?? 'C:/Projects/Practical Systems/practical-systems-website';
const base = `http://127.0.0.1:${PORT}`;
const VIEWPORT = {width: 1440, height: 900};
const VIEW_HOLD_MS = 4000;
const HERO_HOLD_MS = 5200; // the live log is the hero moment, it gets the most time
const SETTLE_MS = 900; // the console rows stagger in over ~950ms; measure after that

// --- Footage cache gate (before the app-reachability check or browser launch) ---
const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const CHECK_ONLY = argv.includes('--cache-check-only');
const videoOut = join(ROOT, 'studio', 'public', 'practicalsystems', 'demo.webm');
const propsOut = join(ROOT, 'props', 'practicalsystems-demo.json');
const CACHE_ARTIFACTS = [videoOut, propsOut];
const keyParts = captureKeyParts({
  repo: PS_ROOT,
  scriptPath: fileURLToPath(import.meta.url),
  config: {viewport: VIEWPORT, holdMs: VIEW_HOLD_MS, heroHoldMs: HERO_HOLD_MS, settleMs: SETTLE_MS},
});
const CACHE_KEY = cacheKey(keyParts);
const CACHE_ENABLED = keyParts.productHead !== null; // null => product repo unresolvable, cannot verify inputs

if (CHECK_ONLY) {
  const {hit} = CACHE_ENABLED ? checkCache('practicalsystems', 'capture', CACHE_KEY, CACHE_ARTIFACTS) : {hit: false};
  console.log(hit ? 'HIT' : 'MISS');
  process.exit(0);
}
if (!CACHE_ENABLED) {
  console.log(`capture cache: product git state unavailable at ${PS_ROOT} — caching disabled this run`);
} else if (!FORCE) {
  const {hit} = checkCache('practicalsystems', 'capture', CACHE_KEY, CACHE_ARTIFACTS);
  if (hit) {
    console.log(`capture cache hit — reusing ${videoOut}`);
    process.exit(0);
  }
}

try {
  const res = await fetch(base, {signal: AbortSignal.timeout(5000)});
  if (res.status >= 500) throw new Error(`server error ${res.status}`);
} catch {
  console.error(`Site unreachable at ${base}. Start it: cd "C:\\Projects\\Practical Systems\\practical-systems-website" && npm run dev`);
  process.exit(1);
}

// Kill the Next.js dev-tools indicator (the dark "N" button). It lives inside a
// SHADOW ROOT (#devtools-indicator in a nextjs-portal shadow tree), so a
// light-DOM style/removal never reaches it. Walk every shadow root on an
// interval and remove it, so it never lands in a frame.
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
  // scroll:false leaves the page where it is — the whole hero fits on screen at
  // scroll 0, and scrolling it would push the headline under the fixed nav.
  const focusOn = async (selector, {padX, padY, biasY = 0, scroll = true} = {}) => {
    const loc = page.locator(selector).first();
    if (scroll) await loc.evaluate((el) => el.scrollIntoView({block: 'center', behavior: 'instant'}));
    await page.waitForTimeout(SETTLE_MS);
    const box = await loc.boundingBox();
    if (!box) throw new Error(`focus target ${selector} has no bounding box`);
    const f = clampFocus(box, {padX, padY});
    f.y = Math.min(Math.max(f.y + biasY, f.h / 2), VIEWPORT.height - f.h / 2);
    rec.focusAt(f.x, f.y, {w: f.w, h: f.h});
  };

  rec.start();

  // --- Homepage: the live operating console ---------------------------------
  await page.goto(base, {waitUntil: 'networkidle'});
  await page.getByRole('heading', {name: /A company that runs itself/i}).waitFor({timeout: 20_000});
  await page.waitForTimeout(SETTLE_MS);

  // 1. Establishing: the claim on the left, the running log on the right.
  rec.step('The homepage is the operating log. One real cycle, exactly as it closed.');
  await focusOn('section:has(h1) > div', {padX: 24, padY: 24, scroll: false});
  await page.waitForTimeout(VIEW_HOLD_MS);

  // 2. HERO MOMENT: the console panel AND the stat rail that captions it.
  // Measured on the 1440x900 capture: the rail runs x 112..600, the log panel
  // x 632..1328. MAX_SCALE 1.6 shows a 900px-wide slice and camera.clampOrigin
  // stops the pan at x=540, so no rect tight enough to fill the frame with the
  // panel alone can clear the rail — it always slices the rail's values off
  // their labels, and the truncated cycle id reads as a render bug. So frame
  // BOTH columns: negative padX pulls the shot in past the hero container's
  // gutters (~1.15x, still a visible push off the establishing shot), and a
  // biasY under the clamp floor pins the top flush to the page so the nav bar
  // caps the frame instead of a band of empty page.
  rec.step('Real cycle id, timestamped rows: the CEO picks, QA passes, the books close.');
  await focusOn('section:has(h1) > div', {padX: -64, padY: 0, biasY: -60, scroll: false});
  await page.waitForTimeout(HERO_HOLD_MS);

  // 3. The left rail: cost, revenue, and who has to approve.
  rec.step('What the cycle cost, what it earned, and who still has to approve.');
  await focusOn('section:has(h1) dl', {padX: 56, padY: 40, scroll: false});
  await page.waitForTimeout(VIEW_HOLD_MS);

  // 4. The fleet, with its amber human gates.
  rec.step('Eight agents with duties. The amber tags are where a human says yes.');
  await focusOn('section:has-text("// the fleet") ul', {padX: 40, padY: 44});
  await page.waitForTimeout(VIEW_HOLD_MS);

  // 5. The scoreboard. Wait for the live Stripe feed so no tile reads "syncing".
  const scoreboard = 'section:has-text("// the scoreboard")';
  await page.locator(scoreboard).scrollIntoViewIfNeeded();
  await page.getByText(/owner test charge/i).waitFor({timeout: 20_000});
  rec.step('Revenue reads live from Stripe. Giving is the committed ledger.');
  await focusOn(`${scoreboard} div.grid`, {padX: 44, padY: 56});
  await page.waitForTimeout(VIEW_HOLD_MS);

  // 6. THE HONESTY BEAT: zero, and the reason the number is not larger. Padded
  // wide of the tile on purpose: a rect tight enough to crop its neighbours is a
  // ~4.8x blow-up of 1440-wide footage, and the caption goes soft before it goes big.
  rec.step('Zero. Four owner test charges excluded, because the owner is not a buyer.');
  await focusOn(`${scoreboard} div.grid > div:nth-child(2)`, {padX: 140, padY: 70});
  await page.waitForTimeout(HERO_HOLD_MS);

  // 7. The shelf, then one hop to the full catalogue.
  const shelf = 'section:has-text("// products it has shipped")';
  rec.step('What it has shipped, priced, each one linked to a working checkout.');
  await focusOn(`${shelf} ul`, {padX: 40, padY: 48});
  await page.waitForTimeout(VIEW_HOLD_MS);

  await rec.click(page.locator(`${shelf} a:has-text("All products")`).first());
  await page.waitForURL('**/products', {timeout: 20_000});
  await page.getByRole('heading', {name: /Products the company ships/i}).waitFor({timeout: 20_000});
  await page.evaluate(() => window.scrollTo(0, 0)); // land at the top of the shelf, not mid-list
  await page.waitForTimeout(SETTLE_MS);
  rec.step('The full shelf. Every row is a real build on its own live site.');
  // The card container is ~1000px tall, so focusing it clamps to the viewport and
  // zooms nothing. Focus the first card and pad down to bring its neighbours in.
  await focusOn('div.max-w-4xl.overflow-hidden > div:first-child', {padX: 40, padY: 200, scroll: false});
  await page.waitForTimeout(VIEW_HOLD_MS);

  const telemetry = rec.finish(VIEWPORT);
  const video = page.video();
  await context.close(); // flushes the webm
  const src = await video.path();

  const destDir = join(ROOT, 'studio', 'public', 'practicalsystems');
  mkdirSync(destDir, {recursive: true});
  copyFileSync(src, join(destDir, 'demo.webm'));

  const props = {
    brandId: 'practicalsystems',
    video: 'practicalsystems/demo.webm',
    cta: 'Watch it run at practicalsystems.io',
    telemetry,
  };
  writeFileSync(propsOut, JSON.stringify(props, null, 2) + '\n');
  if (CACHE_ENABLED) storeCache('practicalsystems', 'capture', CACHE_KEY, CACHE_ARTIFACTS, {productRepo: PS_ROOT, productHead: keyParts.productHead});
  console.log(`capture OK: ${telemetry.durationMs}ms, ${telemetry.events.length} events`);
  console.log('wrote studio/public/practicalsystems/demo.webm and props/practicalsystems-demo.json');
} catch (err) {
  console.error(String(err?.message ?? err));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
