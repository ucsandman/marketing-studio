#!/usr/bin/env node
/**
 * record-noban-demo.mjs - records a noban.gg dashboard flow for the ProductDemo template.
 *
 * Prereq: noban stack running with sim data on screen:
 *   cd C:\Projects\noban-gg && pnpm start
 *
 * Output: ../../studio/public/noban/demo.webm + ../../props/noban-demo.json
 */
import {chromium} from '@playwright/test';
import {copyFileSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Recorder} from './recorder.mjs';
import {cacheKey, checkCache, storeCache} from '../../scripts/lib/cache.mjs';
import {captureKeyParts} from './capture-cache.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOBAN = process.env.NOBAN_ROOT ?? 'C:/Projects/noban-gg';
const VIEWPORT = {width: 1720, height: 1000}; // wide enough for the full opportunities table
const VIEW_HOLD_MS = 3600;

// View metadata hoisted so the cache key can hash it (the `ready` locators, which
// close over `page`, are attached inside the run below).
const VIEWS_META = [
  // focus rects measured from raw 1720x1000 footage; the opportunities
  // window ends left of the app's own clipped table edge (the card crops
  // its rightmost column at any viewport; do not frame the ragged cut)
  {name: 'Opportunities', caption: 'Detected opportunities, ranked by net dollars', focus: {x: 930, y: 380, w: 1000, h: 560}},
  {name: 'Ledger', caption: 'Every simulated trade lands in the ledger', focus: {x: 980, y: 340, w: 1100, h: 420}},
  {name: 'Governance', caption: 'Spend caps and approvals on every action', focus: {x: 980, y: 490, w: 1100, h: 630}},
];

// --- Footage cache gate (before any .env read or browser launch) ---
const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const CHECK_ONLY = argv.includes('--cache-check-only');
const videoOut = join(ROOT, 'studio', 'public', 'noban', 'demo.webm');
const propsOut = join(ROOT, 'props', 'noban-demo.json');
const CACHE_ARTIFACTS = [videoOut, propsOut];
const keyParts = captureKeyParts({
  repo: NOBAN,
  scriptPath: fileURLToPath(import.meta.url),
  config: {viewport: VIEWPORT, holdMs: VIEW_HOLD_MS, views: VIEWS_META},
});
const CACHE_KEY = cacheKey(keyParts);
const CACHE_ENABLED = keyParts.productHead !== null; // null => product repo unresolvable, cannot verify inputs

if (CHECK_ONLY) {
  const {hit} = CACHE_ENABLED ? checkCache('noban', 'capture', CACHE_KEY, CACHE_ARTIFACTS) : {hit: false};
  console.log(hit ? 'HIT' : 'MISS');
  process.exit(0);
}
if (!CACHE_ENABLED) {
  console.log(`capture cache: product git state unavailable at ${NOBAN} — caching disabled this run`);
} else if (!FORCE) {
  const {hit} = checkCache('noban', 'capture', CACHE_KEY, CACHE_ARTIFACTS);
  if (hit) {
    console.log(`capture cache hit — reusing ${videoOut}`);
    process.exit(0);
  }
}

let env;
try {
  env = readFileSync(join(NOBAN, '.env'), 'utf8');
} catch {
  console.error(`noban .env not found under ${NOBAN}. Run \`pnpm start\` there once to generate it.`);
  process.exit(1);
}
const token = env.match(/^DASHBOARD_TOKEN=(.+)$/m)?.[1]?.trim();
if (!token) {
  console.error('DASHBOARD_TOKEN not found in noban .env; run `pnpm start` there once.');
  process.exit(1);
}
const port = env.match(/^DASH_PORT=(\d+)$/m)?.[1] ?? '5173';
const redact = (err) => new Error(String(err?.message ?? err).replaceAll(token, '<redacted>'));

const base = `http://localhost:${port}`;
try {
  const res = await fetch(base, {signal: AbortSignal.timeout(3000)});
  if (res.status >= 500) throw new Error(`server error ${res.status}`);
} catch {
  console.error(`Dashboard unreachable at ${base}. Start it: cd ${NOBAN} && pnpm start`);
  process.exit(1);
}

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
  const page = await context.newPage();
  const rec = new Recorder();

  const nav = (name) => page.getByRole('button', {name, exact: true});
  const readyFns = [
    () => page.locator('tbody tr').first(),
    () => page.getByText('Open cost basis').first(),
    () => page.getByText('Decision ledger').first(),
  ];
  const VIEWS = VIEWS_META.map((v, i) => ({...v, ready: readyFns[i]}));

  rec.start();
  await page.goto(`${base}/?token=${token}`, {waitUntil: 'networkidle'}).catch((e) => {
    throw redact(e);
  });
  await page.getByText('SIMULATION').first().waitFor({timeout: 15_000});
  rec.step('The live trading desk. Simulation on by default.');
  await page.waitForTimeout(VIEW_HOLD_MS);

  for (const view of VIEWS) {
    await rec.click(nav(view.name), view.caption);
    const readyEl = view.ready();
    await readyEl.waitFor({timeout: 30_000}).catch(() => {
      throw new Error(`${view.name} never rendered data; generate sim activity first.`);
    });
    // camera focus: frame the content that just loaded, not the nav click
    rec.focusAt(view.focus.x, view.focus.y, view.focus);
    await page.waitForTimeout(VIEW_HOLD_MS);
  }

  const telemetry = rec.finish(VIEWPORT);
  const video = page.video();
  await context.close(); // flushes the webm
  const src = await video.path();

  const destDir = join(ROOT, 'studio', 'public', 'noban');
  mkdirSync(destDir, {recursive: true});
  copyFileSync(src, join(destDir, 'demo.webm'));

  const props = {
    brandId: 'noban',
    video: 'noban/demo.webm',
    cta: 'Simulate free at noban.gg',
    telemetry,
  };
  writeFileSync(join(ROOT, 'props', 'noban-demo.json'), JSON.stringify(props, null, 2) + '\n');
  if (CACHE_ENABLED) storeCache('noban', 'capture', CACHE_KEY, CACHE_ARTIFACTS);
  console.log(`capture OK: ${telemetry.durationMs}ms, ${telemetry.events.length} events`);
  console.log('wrote studio/public/noban/demo.webm and props/noban-demo.json');
} catch (err) {
  console.error(redact(err).message);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
