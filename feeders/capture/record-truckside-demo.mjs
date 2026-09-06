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
 * Output: <project>/marketing/assets/truckside/{assets,public,props}/
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
import {projectArg, resolveWorkspace} from '../../scripts/lib/workspace.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const PORT = process.env.TS_PORT ?? '3007';
// Owner sign-in. The signing key derives from OWNER_PASSCODE, so the local server is started
// with a known throwaway passcode (never the real .env one) and we log in with the same value.
const PASSCODE = process.env.TS_PASSCODE ?? 'trucksidedemo';
const workspace = resolveWorkspace(ROOT, {brand: 'truckside', project: projectArg(argv) ?? process.env.TS_ROOT ?? 'C:/Projects/tradesdesk'});
const TS_ROOT = workspace.projectRoot;
const base = `http://localhost:${PORT}`;
const VIEWPORT = {width: 1440, height: 900};
const SETTLE_MS = 750; // after a smooth scroll, let the page come to rest
const APPROACH_MS = 1300; // camera stable + cursor eases the last 700ms into the control
const CHANGE_HOLD_MS = 2100; // after a click, hold long enough to read the consequence
const REVEAL_HOLD_MS = 2400; // hold on a revealed section (scene 1 new row, scene 5 outbox)

const FORCE = argv.includes('--force');
const CHECK_ONLY = argv.includes('--cache-check-only');
const publicDir = join(workspace.publicDir, 'truckside');
const videoOut = join(publicDir, 'demo.webm');
const assetOut = join(workspace.assetsDir, 'demo.webm');
const propsOut = join(workspace.propsDir, 'truckside-demo.json');
const CACHE_ARTIFACTS = [videoOut, assetOut, propsOut];
const keyParts = captureKeyParts({
  repo: TS_ROOT,
  scriptPath: fileURLToPath(import.meta.url),
  config: {viewport: VIEWPORT, settleMs: SETTLE_MS, approachMs: APPROACH_MS, changeHoldMs: CHANGE_HOLD_MS},
});
const CACHE_KEY = cacheKey(keyParts);
const CACHE_ENABLED = keyParts.productHead !== null;

if (CHECK_ONLY) {
  const {hit} = CACHE_ENABLED ? checkCache(workspace, 'capture', CACHE_KEY, CACHE_ARTIFACTS) : {hit: false};
  console.log(hit ? 'HIT' : 'MISS');
  process.exit(0);
}
if (!CACHE_ENABLED) {
  console.log(`capture cache: product git state unavailable at ${TS_ROOT} - caching disabled this run`);
} else if (!FORCE) {
  const {hit} = checkCache(workspace, 'capture', CACHE_KEY, CACHE_ARTIFACTS);
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

// Union of measured boxes, padded and clamped to the viewport. `maxH` frames the top
// band of a tall section (its title plus the acted row) instead of the whole card, which
// is what lets DemoStage's auto shot scale pick a real zoom instead of sitting at 1.0.
const focusRect = (boxes, {padX = 30, padY = 24, maxH = null} = {}) => {
  const x0 = Math.min(...boxes.map((b) => b.x));
  const y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.width));
  const y1 = Math.max(...boxes.map((b) => b.y + b.height));
  const w = Math.min(VIEWPORT.width, x1 - x0 + padX * 2);
  const h = Math.min(VIEWPORT.height, maxH ?? y1 - y0 + padY * 2);
  const cx = x0 + (x1 - x0) / 2;
  const cy = maxH ? y0 - padY + h / 2 : y0 + (y1 - y0) / 2;
  return {
    x: Math.round(Math.min(Math.max(cx, w / 2), VIEWPORT.width - w / 2)),
    y: Math.round(Math.min(Math.max(cy, h / 2), VIEWPORT.height - h / 2)),
    w: Math.round(w),
    h: Math.round(h),
  };
};

const videoDir = join(workspace.assetsDir, '.capture');
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

  // Focus the MEASURED bounding boxes of one or more elements after settling. Pass a
  // list to union them (the quote table plus the Approve button reads as one shot).
  const focusOn = async (locs, {padX = 30, padY = 24, maxH = null} = {}) => {
    const boxes = [];
    for (const loc of Array.isArray(locs) ? locs : [locs]) {
      const box = await loc.boundingBox();
      if (!box) throw new Error('focus target has no bounding box');
      boxes.push(box);
    }
    const f = focusRect(boxes, {padX, padY, maxH});
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
  rec.step('The missed call gets answered and a window gets booked.');
  const missedBefore = await sectionCount("Today's missed calls");
  const simulate = page.getByRole('button', {name: 'Simulate missed call', exact: true});
  // The header's inner max-w-5xl block, not the full-bleed <header>: a 1440-wide rect is a
  // 1.0x shot (no zoom at all).
  await focusOn(page.locator('header > div').last(), {padX: 20, padY: 20});
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
  await focusOn(missedSection, {padX: 30, padY: 24, maxH: 240}); // title, count badge, the new row
  await page.waitForTimeout(REVEAL_HOLD_MS);

  // --- Scene 2: the quote is priced. One tap approves it. ---
  rec.step('The quote is priced off the rate card. One tap approves it.');
  const quotesBefore = await sectionCount('Quotes awaiting approval');
  const quotes = section('Quotes awaiting approval');
  await smoothScrollTo(quotes, 'start');
  const approveQuote = quotes.getByRole('button', {name: 'Approve', exact: true}).first();
  // The hero beat: the line items, the total, and the button that commits them, in one frame.
  await focusOn([quotes.locator('table').first(), approveQuote], {padX: 16, padY: 8});
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
  await focusOn(quotes, {padX: 30, padY: 24, maxH: 260}); // the badge drops and the card is gone
  await page.waitForTimeout(CHANGE_HOLD_MS);

  // --- Scene 3: confirm the appointment. ---
  rec.step('Confirm, move or cancel the booked window.');
  const appts = section('Upcoming appointments');
  await smoothScrollTo(appts, 'start');
  const confirmedBefore = await appts.getByText('Confirmed', {exact: true}).count();
  const confirm = appts.getByRole('button', {name: 'Confirm', exact: true}).first();
  const firstAppt = appts.locator('li').first();
  await focusOn(firstAppt, {padX: 24, padY: 20});
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
  await focusOn(firstAppt, {padX: 24, padY: 20}); // the row now reads Confirmed
  await page.waitForTimeout(CHANGE_HOLD_MS);

  // --- Scene 4: approve a drafted follow-up (queues a send into the Outbox). ---
  rec.step('The nudges and reminders are written. You clear each with a tap.');
  const outboxBefore = await sectionCount('Outbox');
  const followups = section('Follow-ups');
  await smoothScrollTo(followups, 'start');
  const approveFollowup = followups.getByRole('button', {name: 'Approve', exact: true}).first();
  await focusOn(followups.locator('li').first(), {padX: 24, padY: 20});
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
  await focusOn(followups, {padX: 30, padY: 24, maxH: 260}); // the cleared row is gone
  await page.waitForTimeout(CHANGE_HOLD_MS);

  // --- Scene 5: the Outbox. Every send recorded; in demo mode nothing leaves. ---
  rec.step('Every send is recorded. In demo mode each row reads Simulated.');
  const outbox = section('Outbox');
  await smoothScrollTo(outbox, 'start');
  await focusOn(outbox, {padX: 30, padY: 24, maxH: 300});
  await page.waitForTimeout(REVEAL_HOLD_MS);
  await focusOn(outbox.locator('li').first(), {padX: 24, padY: 20}); // one queued row, reading Simulated
  await page.waitForTimeout(REVEAL_HOLD_MS);

  const telemetry = rec.finish(VIEWPORT);
  const video = page.video();
  await context.close(); // flushes the webm
  const src = await video.path();

  for (const destDir of [workspace.assetsDir, publicDir]) {
    mkdirSync(destDir, {recursive: true});
    copyFileSync(src, join(destDir, 'demo.webm'));
  }

  const props = {
    brandId: 'truckside',
    video: 'truckside/demo.webm',
    cta: 'See it live at truckside.io',
    telemetry,
  };
  mkdirSync(workspace.propsDir, {recursive: true});
  writeFileSync(propsOut, JSON.stringify(props, null, 2) + '\n');
  if (CACHE_ENABLED) storeCache(workspace, 'capture', CACHE_KEY, CACHE_ARTIFACTS, {productRepo: TS_ROOT, productHead: keyParts.productHead});
  console.log(`capture OK: ${telemetry.durationMs}ms, ${telemetry.events.length} events`);
  console.log(`wrote ${assetOut}, ${videoOut}, and ${propsOut}`);
} catch (err) {
  console.error(String(err?.message ?? err));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
