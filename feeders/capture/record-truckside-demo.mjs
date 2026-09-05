#!/usr/bin/env node
/**
 * record-truckside-demo.mjs - records a Truckside owner-dashboard walkthrough for ProductDemo.
 *
 * This is a USED dashboard, not a scroll of screenshots: every scene performs a real click on a
 * real control and waits for the visible consequence (a new row, a changed badge, a queued send),
 * so ProductDemo draws a cursor travelling to each control and pressing it (rec.click telemetry).
 *
 * Prereq: the product app running with demo seed data on localhost (owner session):
 *   cd C:\Projects\tradesdesk
 *   DEMO_MODE=1 TRUCKSIDE_LLM=off OWNER_PASSCODE=trucksidedemo npm run start   (port 3007)
 *   npx tsx prisma/seed.ts   (fresh seed so there is something to act on)
 * We sign in as OWNER with the same throwaway passcode (the session key derives from it); the
 * real .env passcode is never read.
 *
 * Output: ../../studio/public/truckside/demo.webm + ../../props/truckside-demo.json
 *
 * Camera focus rects are MEASURED from each target element's real boundingBox (viewport px ==
 * webm px because recordVideo.size == viewport), never derived from click points. Clicks are
 * logged at the control centre so the cursor lands on the button it presses.
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
// Owner sign-in. The signing key derives from OWNER_PASSCODE, so the local server is started
// with a known throwaway passcode (never the real .env one) and we log in with the same value.
const PASSCODE = process.env.TS_PASSCODE ?? 'trucksidedemo';
const TS_ROOT = process.env.TS_ROOT ?? 'C:/Projects/tradesdesk';
const base = `http://localhost:${PORT}`;
const VIEWPORT = {width: 1440, height: 900};
const SETTLE_MS = 650; // after a smooth scroll, let the page come to rest
const APPROACH_MS = 1000; // camera stable + cursor eases the last 700ms into the control
const CHANGE_HOLD_MS = 1600; // after a click, hold long enough to read the consequence
const REVEAL_HOLD_MS = 2000; // hold on a revealed section (scene 1 new row, scene 5 outbox)

const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const CHECK_ONLY = argv.includes('--cache-check-only');
const videoOut = join(ROOT, 'studio', 'public', 'truckside', 'demo.webm');
const propsOut = join(ROOT, 'props', 'truckside-demo.json');
const CACHE_ARTIFACTS = [videoOut, propsOut];
const keyParts = captureKeyParts({
  repo: TS_ROOT,
  scriptPath: fileURLToPath(import.meta.url),
  config: {viewport: VIEWPORT, settleMs: SETTLE_MS, approachMs: APPROACH_MS, changeHoldMs: CHANGE_HOLD_MS},
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
  console.error(`App unreachable at ${base}. Start it: cd C:\\Projects\\tradesdesk && DEMO_MODE=1 TRUCKSIDE_LLM=off OWNER_PASSCODE=trucksidedemo npm run start`);
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

  // A dashboard section, addressed by its exact <h2> title.
  const section = (title) =>
    page.locator('section').filter({has: page.getByRole('heading', {name: title, exact: true})});

  // The count badge that sits right after a section's <h2> (SectionHeader).
  const sectionCount = async (title) => {
    const badge = section(title).locator('h2 + span').first();
    const txt = (await badge.innerText()).trim();
    return Number.parseInt(txt, 10);
  };

  // Smooth-scroll an element to the vertical centre so the footage shows real
  // scroll motion between scenes, not a jump cut, then let it settle.
  const smoothScrollTo = async (loc, block = 'center') => {
    await loc.evaluate((el, b) => el.scrollIntoView({behavior: 'smooth', block: b}), block);
    await page.waitForTimeout(SETTLE_MS + 250);
  };

  // Focus one measured element after settling; a section header is biased into
  // frame so the title and the acted row read together.
  const focusOn = async (loc, {padX = 40, padY = 40, biasY = 0} = {}) => {
    const box = await loc.boundingBox();
    if (!box) throw new Error('focus target has no bounding box');
    const f = clampFocus(box, {padX, padY});
    f.y = Math.min(Math.max(f.y + biasY, f.h / 2), VIEWPORT.height - f.h / 2);
    rec.focusAt(f.x, f.y, {w: f.w, h: f.h});
  };

  rec.start();

  // Owner sign-in mints the owner session cookie in this context, then load the seeded /app.
  const login = await context.request.post(`${base}/api/login`, {form: {passcode: PASSCODE}});
  if (!login.ok()) throw new Error(`owner login failed ${login.status()} (set OWNER_PASSCODE on the server)`);
  await page.goto(`${base}/app`, {waitUntil: 'networkidle'});
  await page.getByRole('button', {name: 'Simulate missed call', exact: true}).waitFor({timeout: 20_000});
  await page.waitForTimeout(SETTLE_MS);

  // --- Scene 1: a missed call comes in. Click Simulate, then reveal the new row. ---
  rec.step('A missed call comes in while you are on the job.');
  const missedBefore = await sectionCount("Today's missed calls");
  const simulate = page.getByRole('button', {name: 'Simulate missed call', exact: true});
  await focusOn(page.locator('header'), {padX: 24, padY: 24}); // frame the header + the button
  await page.waitForTimeout(APPROACH_MS);
  await rec.click(simulate);
  await page.waitForFunction(
    (n) => {
      const sec = [...document.querySelectorAll('section')].find(
        (s) => s.querySelector('h2')?.textContent?.trim() === "Today's missed calls",
      );
      const badge = sec?.querySelector('h2 + span');
      return badge && Number.parseInt(badge.textContent.trim(), 10) > n;
    },
    missedBefore,
    {timeout: 20_000},
  );
  const missedSection = section("Today's missed calls");
  await smoothScrollTo(missedSection, 'start');
  await focusOn(missedSection, {padX: 36, padY: 44, biasY: -30}); // frame the top: the new row + badge
  await page.waitForTimeout(REVEAL_HOLD_MS);

  // --- Scene 2: the quote is priced. One tap approves it. ---
  rec.step('The quote is priced. One tap approves it.');
  const quotesBefore = await sectionCount('Quotes awaiting approval');
  const quotes = section('Quotes awaiting approval');
  await smoothScrollTo(quotes, 'start');
  const approveQuote = quotes.getByRole('button', {name: 'Approve', exact: true}).first();
  await focusOn(quotes, {padX: 32, padY: 40, biasY: -30});
  await page.waitForTimeout(APPROACH_MS);
  await rec.click(approveQuote);
  await page.waitForFunction(
    (n) => {
      const sec = [...document.querySelectorAll('section')].find(
        (s) => s.querySelector('h2')?.textContent?.trim() === 'Quotes awaiting approval',
      );
      const badge = sec?.querySelector('h2 + span');
      return badge && Number.parseInt(badge.textContent.trim(), 10) < n;
    },
    quotesBefore,
    {timeout: 20_000},
  );
  await focusOn(quotes, {padX: 32, padY: 40, biasY: -30});
  await page.waitForTimeout(CHANGE_HOLD_MS);

  // --- Scene 3: confirm the appointment. ---
  rec.step('Confirm, move, or cancel each appointment.');
  const appts = section('Upcoming appointments');
  await smoothScrollTo(appts, 'start');
  const confirmedBefore = await appts.getByText('Confirmed', {exact: true}).count();
  const confirm = appts.getByRole('button', {name: 'Confirm', exact: true}).first();
  await focusOn(appts, {padX: 32, padY: 40, biasY: -30});
  await page.waitForTimeout(APPROACH_MS);
  await rec.click(confirm);
  await page.waitForFunction(
    (n) => {
      const sec = [...document.querySelectorAll('section')].find(
        (s) => s.querySelector('h2')?.textContent?.trim() === 'Upcoming appointments',
      );
      if (!sec) return false;
      const confirmed = [...sec.querySelectorAll('span')].filter((s) => s.textContent.trim() === 'Confirmed').length;
      return confirmed > n;
    },
    confirmedBefore,
    {timeout: 20_000},
  );
  await focusOn(appts, {padX: 32, padY: 40, biasY: -30});
  await page.waitForTimeout(CHANGE_HOLD_MS);

  // --- Scene 4: approve a drafted follow-up (queues a send into the Outbox). ---
  rec.step('Follow-ups are drafted and held until you approve.');
  const outboxBefore = await sectionCount('Outbox');
  const followups = section('Follow-ups');
  await smoothScrollTo(followups, 'start');
  const approveFollowup = followups.getByRole('button', {name: 'Approve', exact: true}).first();
  await focusOn(followups, {padX: 32, padY: 40, biasY: -30});
  await page.waitForTimeout(APPROACH_MS);
  await rec.click(approveFollowup);
  await page.waitForFunction(
    (n) => {
      const sec = [...document.querySelectorAll('section')].find(
        (s) => s.querySelector('h2')?.textContent?.trim() === 'Outbox',
      );
      const badge = sec?.querySelector('h2 + span');
      return badge && Number.parseInt(badge.textContent.trim(), 10) > n;
    },
    outboxBefore,
    {timeout: 20_000},
  );
  await focusOn(followups, {padX: 32, padY: 40, biasY: -30});
  await page.waitForTimeout(CHANGE_HOLD_MS);

  // --- Scene 5: the Outbox. Every send recorded; in demo mode nothing leaves. ---
  rec.step('Every send is recorded. In demo mode nothing leaves the app.');
  const outbox = section('Outbox');
  await smoothScrollTo(outbox, 'start');
  await focusOn(outbox, {padX: 32, padY: 44, biasY: -30});
  await page.waitForTimeout(REVEAL_HOLD_MS);

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
