#!/usr/bin/env node
/**
 * record-postflop-demo.mjs - records a postflop workbench walkthrough for ProductDemo.
 *
 * Prereq: the Next.js workbench running on localhost:
 *   cd C:\Projects\solver\web && npm run dev
 *
 * Output: ../../studio/public/postflop/demo.webm + ../../props/postflop-demo.json
 *
 * The workbench is one page with four tabs, so the walk is tab switches and tree
 * steps, not navigations. Camera focus rects are MEASURED from each target
 * element's real boundingBox (viewport px == webm px because recordVideo.size ==
 * viewport), never derived from click points.
 *
 * Filmed in LIGHT theme (bone paper is the brand ground) with the guided tour
 * suppressed - it auto-opens for a first-time visitor and would cover the UI.
 */
import {chromium} from '@playwright/test';
import {copyFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Recorder} from './recorder.mjs';
import {cacheKey, checkCache, storeCache} from '../../scripts/lib/cache.mjs';
import {captureKeyParts} from './capture-cache.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = process.env.PF_PORT ?? '3000';
// Product repo: the app is reached over the port, but the cache must fingerprint
// the source it films.
const PF_ROOT = process.env.PF_ROOT ?? 'C:/Projects/solver';
const base = `http://localhost:${PORT}`;
// 1920: the inspector's 4th column (the EV/regret twin grid) and the combo table's
// full column set both switch on at >=1900px. Below that the combo row declares one
// grid column fewer than it renders cells, so each hand's EV wraps under its name.
const VIEWPORT = {width: 1920, height: 1080};
const VIEW_HOLD_MS = 3400;
const SETTLE_MS = 700; // let entrance animations / scroll settle before measuring
const SOLVE_TIMEOUT_MS = 180_000; // single-threaded wasm; the CLI uses every core

// --- Footage cache gate (before the app-reachability check or browser launch) ---
const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const CHECK_ONLY = argv.includes('--cache-check-only');
const videoOut = join(ROOT, 'studio', 'public', 'postflop', 'demo.webm');
const propsOut = join(ROOT, 'props', 'postflop-demo.json');
const CACHE_ARTIFACTS = [videoOut, propsOut];
const keyParts = captureKeyParts({
  repo: PF_ROOT,
  scriptPath: fileURLToPath(import.meta.url),
  config: {viewport: VIEWPORT, holdMs: VIEW_HOLD_MS, settleMs: SETTLE_MS},
});
const CACHE_KEY = cacheKey(keyParts);
const CACHE_ENABLED = keyParts.productHead !== null; // null => product repo unresolvable, cannot verify inputs

if (CHECK_ONLY) {
  const {hit} = CACHE_ENABLED ? checkCache('postflop', 'capture', CACHE_KEY, CACHE_ARTIFACTS) : {hit: false};
  console.log(hit ? 'HIT' : 'MISS');
  process.exit(0);
}
if (!CACHE_ENABLED) {
  console.log(`capture cache: product git state unavailable at ${PF_ROOT} — caching disabled this run`);
} else if (!FORCE) {
  const {hit} = checkCache('postflop', 'capture', CACHE_KEY, CACHE_ARTIFACTS);
  if (hit) {
    console.log(`capture cache hit — reusing ${videoOut}`);
    process.exit(0);
  }
}

try {
  const res = await fetch(base, {signal: AbortSignal.timeout(5000)});
  if (res.status >= 500) throw new Error(`server error ${res.status}`);
} catch {
  console.error(`App unreachable at ${base}. Start it: cd C:\\Projects\\solver\\web && npm run dev`);
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

// The workbench auto-opens its guided tour for a first-time visitor (localStorage
// pf-tour-done) and reads the theme from pf-theme. A fresh Playwright profile is a
// first-time visitor every run, so both are pinned here: no overlay, bone ground.
const PIN_PREFS = `
  try {
    localStorage.setItem('pf-tour-done', '1');
    localStorage.setItem('pf-theme', 'light');
    document.documentElement.dataset.theme = 'light';
  } catch (e) {}
`;

// `maxH` frames the TOP of a tall element instead of its whole box: a full-height
// scrolling column (a range grid, a ranked table) measures ~900px, and a focus rect
// that tall pins the camera at scale ~1.05, i.e. no zoom and unreadable rows.
const clampFocus = (box, {padX = 48, padY = 48, maxH} = {}) => {
  const bh = maxH ? Math.min(box.height, maxH) : box.height;
  const w = Math.min(VIEWPORT.width, box.width + padX * 2);
  const h = Math.min(VIEWPORT.height, bh + padY * 2);
  const x = Math.min(Math.max(box.x + box.width / 2, w / 2), VIEWPORT.width - w / 2);
  const y = Math.min(Math.max(box.y + bh / 2, h / 2), VIEWPORT.height - h / 2);
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
    colorScheme: 'light',
  });
  await context.addInitScript(HIDE_DEVTOOLS);
  await context.addInitScript(PIN_PREFS);
  // Warm the dev server and the browser cache on a throwaway page. The recording
  // starts when the FILMED page is created, so anything still cold at that moment
  // (route compile, wasm fetch) is dead air at the head of the film.
  const warm = await context.newPage();
  await warm.goto(`${base}/?tab=solve`, {waitUntil: 'networkidle'});
  await warm.locator('[data-tour="solve-spot"]').waitFor({timeout: 60_000});
  await warm.close();

  const page = await context.newPage();
  const rec = new Recorder();

  // Focus one measured element after settling; caption is the step label.
  const focusOn = async (selector, {padX, padY, maxH, biasY = 0} = {}) => {
    const loc = typeof selector === 'string' ? page.locator(selector).first() : selector;
    await loc.scrollIntoViewIfNeeded();
    await page.waitForTimeout(SETTLE_MS);
    const box = await loc.boundingBox();
    if (!box) throw new Error(`focus target ${selector} has no bounding box`);
    const f = clampFocus(box, {padX, padY, maxH});
    f.y = Math.min(Math.max(f.y + biasY, f.h / 2), VIEWPORT.height - f.h / 2);
    rec.focusAt(f.x, f.y, {w: f.w, h: f.h});
  };

  const tab = (label) => page.locator(`.rail button[aria-label="${label}"]`).first();

  // Deep link straight to the Solve tab: the walk follows the narration order
  // (configure a spot, run it, then walk the solved tree).
  // recordVideo starts with the page, so the recorder starts with it too: a
  // telemetry clock that starts later puts every camera move and click that many
  // seconds ahead of the footage it is supposed to be following.
  rec.start();
  await page.goto(`${base}/?tab=solve`, {waitUntil: 'networkidle'});
  await page.locator('[data-tour="solve-spot"]').waitFor({timeout: 30_000});
  await page.waitForTimeout(SETTLE_MS);

  // 1. Solve tab - the spot: board, stacks, pot, and the sizing tree
  rec.step('A board, the stacks, the pot, and the sizings each seat may bet.');
  await focusOn('[data-tour="solve-spot"]', {padX: 34, padY: 20, maxH: 640});
  await page.waitForTimeout(VIEW_HOLD_MS);

  // 2. Both ranges, as real 13x13 editors. The top-% sliders are DRIVEN here, not
  //    just framed: a hold on two static grids records literally identical frames
  //    (judge-demo-pacing reads the raw webm, where nothing moves is dead air), and
  //    cutting each seat to the percentage the preset describes is the claim itself.
  rec.step('Both ranges: painted on the grid, typed as range strings, or cut to a top percentage.');
  await focusOn('.col-ranges', {padX: 20, padY: 16, maxH: 500});
  await page.waitForTimeout(800);
  for (const [seat, pct] of [['oop', '33'], ['ip', '45']]) {
    const slider = page.locator(`[data-testid="range-top-${seat}"]`);
    await rec.click(slider); // lands mid-track, then the exact cut is typed in
    await slider.fill(pct);
    await page.waitForTimeout(900);
  }
  await page.waitForTimeout(VIEW_HOLD_MS - 2600);

  // 3. The solver budget: ask for a tighter convergence target than the preset's
  //    0.5%, so the report the solver prints is a curve, not a single point.
  const target = page.getByLabel(/target expl/i);
  await rec.click(target, 'Name the convergence target. This one is asked for 0.05% of pot.');
  await target.fill('0.05');
  await page.waitForTimeout(500);
  await focusOn('.col-ranges div:has(> span.label:text-is("solver budget"))', {padX: 60, padY: 50});
  await page.waitForTimeout(VIEW_HOLD_MS - 900);

  // 4. Preflight - the memory bill, priced before the solve commits. Run it on its
  //    own: a full solve of this spot finishes in well under a second and the app
  //    jumps to the inspector, which would take the preflight panel off camera.
  await rec.click(
    page.getByRole('button', {name: 'Preflight only'}),
    'Preflight prices the tree before the solver allocates it.',
  );
  await page.locator('[data-testid="preflight"] .fig').waitFor({timeout: 60_000});
  await focusOn('[data-testid="preflight"]', {padX: 40, padY: 24});
  await page.waitForTimeout(VIEW_HOLD_MS);

  // 5. Run it. The solve owns a worker, adopts its own output and lands in the
  //    inspector; the run panel keeps the convergence report it wrote.
  await rec.click(page.locator('[data-testid="solve-run"]'), 'Solve. The engine runs in a worker, in the tab.');
  const anyway = page.locator('[data-testid="preflight"] button').filter({hasText: /solve anyway/i});
  if (await anyway.count()) await rec.click(anyway.first());
  await page.locator('.rail').getByText(/browser solve/i).waitFor({timeout: SOLVE_TIMEOUT_MS});
  await page.waitForTimeout(1200);

  // 6. The differentiator: exploitability measured by a separate best-response
  //    walk at every report, not estimated from regret.
  await rec.click(tab('Solve'), 'Exploitability, measured by a separate best-response walk at every report.');
  await page.locator('[data-testid="progress"] .fig').waitFor({timeout: 30_000});
  await focusOn('[data-testid="progress"]', {padX: 40, padY: 20});
  await page.waitForTimeout(VIEW_HOLD_MS + 800);

  // 7. Inspector - the spot's vitals, exploitability in the yellow block
  await rec.click(tab('Inspector'), 'The solved spot: board, pot, stacks, exploitability.');
  await page.locator('[data-tour="statband"]').waitFor({timeout: 30_000});
  await focusOn('[data-tour="statband"]', {padX: 20, padY: 60});
  await page.waitForTimeout(VIEW_HOLD_MS);

  // 8. The 13x13 grid: 169 hand classes, each cell split by action
  rec.step('169 hand classes. Every cell is split by the action it takes.');
  await focusOn('[data-tour="grid-strategy"] [role="group"]', {padX: 26, padY: 46});
  await page.waitForTimeout(VIEW_HOLD_MS);

  // 9. Drill into one cell - the combo breakdown behind the average
  // AJs is a live suited class in both preset ranges; if this board ever kills it,
  // fall back to any cell that still has combos rather than clicking a dead one.
  const named = page.locator('[data-tour="grid-strategy"] [data-cell="AJs"]:not(:disabled)');
  const cell = (await named.count())
    ? named.first()
    : page.locator('[data-tour="grid-strategy"] [data-cell]:not(:disabled)').nth(12);
  await rec.click(cell, 'Open one cell: every combo, its own mix, its own EV in big blinds.');
  await page.waitForTimeout(SETTLE_MS);
  await focusOn('[data-tour="combo-panel"]', {padX: 24, padY: 20, maxH: 560});
  await page.waitForTimeout(VIEW_HOLD_MS);

  // 10. Node lock - freeze this node, solve the rest of the tree around it
  await rec.click(
    page.locator('[data-testid="lock-node"]'),
    'Freeze a node and the next solve works around it.',
  );
  await page.locator('[data-testid="lock-count"]').waitFor({timeout: 15_000});
  await focusOn('[data-tour="grid-strategy"] .bar-strategy', {padX: 40, padY: 130});
  await page.waitForTimeout(VIEW_HOLD_MS - 800);

  // 11. Walk down the tree to the chance node: every runout, priced
  const runouts = page.locator('[data-tour="runouts"]');
  for (let i = 0; i < 4 && !(await runouts.isVisible()); i++) {
    const actions = page.locator('[data-tour="actions"] button');
    const passive = actions.filter({hasText: /check|call/i});
    const move = (await passive.count()) ? passive.first() : actions.filter({hasNotText: /fold/i}).first();
    await rec.click(move, i === 0 ? 'Walk the tree. Both seats act, then the river is dealt.' : undefined);
    await page.waitForTimeout(SETTLE_MS);
  }
  if (!(await runouts.isVisible())) throw new Error('never reached a chance node in 4 steps');
  rec.step('Every runout priced by what it does to hero EV, ranked by consequence.');
  await focusOn(page.locator('section:has(> h2.bar-ev)').first(), {padX: 34, padY: 20, maxH: 560});
  await page.waitForTimeout(VIEW_HOLD_MS);

  const telemetry = rec.finish(VIEWPORT);
  const video = page.video();
  await context.close(); // flushes the webm
  const src = await video.path();

  const destDir = join(ROOT, 'studio', 'public', 'postflop');
  mkdirSync(destDir, {recursive: true});
  copyFileSync(src, join(destDir, 'demo.webm'));

  const props = {
    brandId: 'postflop',
    video: 'postflop/demo.webm',
    cta: 'Solve your first spot · postflop.vercel.app',
    telemetry,
  };
  writeFileSync(propsOut, JSON.stringify(props, null, 2) + '\n');
  if (CACHE_ENABLED) storeCache('postflop', 'capture', CACHE_KEY, CACHE_ARTIFACTS, {productRepo: PF_ROOT, productHead: keyParts.productHead});
  console.log(`capture OK: ${telemetry.durationMs}ms, ${telemetry.events.length} events`);
  console.log('wrote studio/public/postflop/demo.webm and props/postflop-demo.json');
} catch (err) {
  console.error(String(err?.message ?? err));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
