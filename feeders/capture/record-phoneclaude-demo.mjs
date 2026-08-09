#!/usr/bin/env node
/**
 * record-phoneclaude-demo.mjs - records the phone-claude viewer for ProductDemo.
 *
 * Prereq: a real iPhone on USB with the harness chain up, and the viewer serving:
 *   cd C:\Projects\phone-claude && phone-harness up
 *   python -c "import sys; sys.path.insert(0,'src'); from phone_harness import viewer; viewer.serve(open_browser=False)"
 * `GET /api/status` must report input:true (touch needs the re-signed WDA).
 *
 * Output: ../../studio/public/phoneclaude/demo.webm + ../../props/phoneclaude-demo.json
 *
 * The film has two actors. The AGENT drives the phone through phone-harness
 * (a child process, exactly how an LLM would), and the HUMAN drives the viewer
 * page through Playwright clicks and keystrokes. Both land on the same live
 * MJPEG stream, so one take shows both control paths plus the kill switch.
 *
 * Camera focus rects are MEASURED from each element's real boundingBox
 * (viewport px == webm px because recordVideo.size == viewport), never derived
 * from click points.
 *
 * PRIVACY: the footage is public. Only the home screen, the Clock app and the
 * Search pull-down are filmed - never Messages, Mail, Photos, Contacts, or the
 * Settings root (its Apple Account row carries the owner's real name). The
 * device UDID and the Apple team id printed by the doctor checks are masked in
 * the page before recording; see REDACT below.
 */
import {chromium} from '@playwright/test';
import {spawn} from 'node:child_process';
import {copyFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Recorder} from './recorder.mjs';
import {cacheKey, checkCache, storeCache} from '../../scripts/lib/cache.mjs';
import {captureKeyParts} from './capture-cache.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PC_ROOT = process.env.PC_ROOT ?? 'C:/Projects/phone-claude';
const PORT = process.env.PC_VIEWER_PORT ?? '8770';
const base = `http://127.0.0.1:${PORT}`;
const VIEWPORT = {width: 1600, height: 1000};
const SETTLE_MS = 700;

// --- Footage cache gate (before the app-reachability check or browser launch) ---
const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const CHECK_ONLY = argv.includes('--cache-check-only');
const videoOut = join(ROOT, 'studio', 'public', 'phoneclaude', 'demo.webm');
const propsOut = join(ROOT, 'props', 'phoneclaude-demo.json');
const CACHE_ARTIFACTS = [videoOut, propsOut];
const keyParts = captureKeyParts({
  repo: PC_ROOT,
  scriptPath: fileURLToPath(import.meta.url),
  config: {viewport: VIEWPORT, settleMs: SETTLE_MS},
});
const CACHE_KEY = cacheKey(keyParts);
const CACHE_ENABLED = keyParts.productHead !== null;

if (CHECK_ONLY) {
  const {hit} = CACHE_ENABLED ? checkCache('phoneclaude', 'capture', CACHE_KEY, CACHE_ARTIFACTS) : {hit: false};
  console.log(hit ? 'HIT' : 'MISS');
  process.exit(0);
}
if (!CACHE_ENABLED) {
  console.log(`capture cache: product git state unavailable at ${PC_ROOT} - caching disabled this run`);
} else if (!FORCE) {
  const {hit} = checkCache('phoneclaude', 'capture', CACHE_KEY, CACHE_ARTIFACTS);
  if (hit) {
    console.log(`capture cache hit - reusing ${videoOut}`);
    process.exit(0);
  }
}

// --- The viewer must be up AND touch input live, or the film has no second actor ---
let POINTS;
try {
  const res = await fetch(`${base}/api/status`, {signal: AbortSignal.timeout(5000)});
  const status = await res.json();
  if (!status.input) throw new Error('status reports input:false');
  POINTS = status.window; // phone screen size in points
} catch (err) {
  console.error(
    `Viewer not filmable at ${base} (${err?.message ?? err}). Start the chain:\n` +
      `  cd ${PC_ROOT} && phone-harness up\n` +
      `  python -c "import sys; sys.path.insert(0,'src'); from phone_harness import viewer; viewer.serve(open_browser=False)"`,
  );
  process.exit(1);
}

/** Runs an agent script through phone-harness, exactly as an LLM would. */
const runPhone = (py, {allowFail = false} = {}) =>
  new Promise((res, rej) => {
    const child = spawn(`"${join(PC_ROOT, 'phone-harness.cmd')}"`, {cwd: PC_ROOT, shell: true});
    let err = '';
    child.stderr.on('data', (d) => (err += d));
    child.on('error', rej);
    child.on('close', (code) => {
      if (code !== 0 && !allowFail) rej(new Error(`phone-harness failed (${code}): ${err.slice(-400)}`));
      else res(code);
    });
    child.stdin.end(py);
  });

// The doctor checks print a device UDID and the Apple team id of the signing
// account. Both identify the owner's hardware and Apple ID, and this footage is
// public, so mask the identifiers (labels and structure stay untouched).
const REDACT = `
  (() => {
    const mask = (s) => s
      .replace(/\\b([0-9A-F]{8})-([0-9A-F]{16})\\b/gi, '$1-XXXXXXXXXXXXXXXX')
      .replace(/\\.xctrunner\\.([A-Z0-9]{10})\\b/gi, '.xctrunner.XXXXXXXXXX');
    const sweep = () => {
      const walk = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      for (let n = walk.nextNode(); n; n = walk.nextNode()) {
        const next = mask(n.nodeValue);
        if (next !== n.nodeValue) n.nodeValue = next;
      }
    };
    const start = () => { sweep(); setInterval(sweep, 200); };
    if (document.body) start();
    else document.addEventListener('DOMContentLoaded', start);
  })();
`;

const clampFocus = (box, {padX = 48, padY = 48} = {}) => {
  const w = Math.min(VIEWPORT.width, box.width + padX * 2);
  const h = Math.min(VIEWPORT.height, box.height + padY * 2);
  const x = Math.min(Math.max(box.x + box.width / 2, w / 2), VIEWPORT.width - w / 2);
  const y = Math.min(Math.max(box.y + box.height / 2, h / 2), VIEWPORT.height - h / 2);
  return {x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h)};
};

const union = (a, b) => ({
  x: Math.min(a.x, b.x),
  y: Math.min(a.y, b.y),
  width: Math.max(a.x + a.width, b.x + b.width) - Math.min(a.x, b.x),
  height: Math.max(a.y + a.height, b.y + b.height) - Math.min(a.y, b.y),
});

const videoDir = join(ROOT, 'out', 'capture');
mkdirSync(videoDir, {recursive: true});
let browser;
try {
  // Pre-roll (off camera): clear the stopwatch and park on the home screen so
  // the take always starts from the same state.
  await runPhone(`
import time
open_app("Clock"); time.sleep(2.5)
tap_text("Stopwatch"); time.sleep(1.5)
for label in ("Stop", "Reset"):
    try:
        tap_text(label, exact=True); time.sleep(1.0)
    except WDAError:
        pass
press_home(); time.sleep(1.5)
`);

  browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: VIEWPORT,
    deviceScaleFactor: 2, // supersampled render downscaled into the webm: crisper footage
    recordVideo: {dir: videoDir, size: VIEWPORT},
  });
  await context.addInitScript(REDACT);
  const page = await context.newPage();
  const rec = new Recorder();

  const box = async (sel) => {
    const b = await page.locator(sel).first().boundingBox();
    if (!b) throw new Error(`focus target ${sel} has no bounding box`);
    return b;
  };
  const focusOn = async (sel, opts) => {
    const f = clampFocus(await box(sel), opts);
    rec.focusAt(f.x, f.y, {w: f.w, h: f.h});
  };

  const screenLoc = page.locator('#screen');
  /** Human tap on the streamed phone, aimed by phone POINT coordinates. */
  const tapPhone = async (ptX, ptY, label) => {
    const b = await screenLoc.boundingBox();
    await rec.click(screenLoc, label, {
      position: {x: (ptX / POINTS.width) * b.width, y: (ptY / POINTS.height) * b.height},
    });
  };

  rec.start();
  await page.goto(base, {waitUntil: 'domcontentloaded'});
  // Wait for real pixels from the phone, not just the layout.
  await page.waitForFunction(() => document.getElementById('screen').naturalWidth > 0, null, {timeout: 30_000});
  await page.waitForTimeout(SETTLE_MS);

  // --- 1. The whole surface: live phone left, checks right --------------------
  const wide = union(await box('#phone-pane'), await box('#side'));
  const wideFocus = clampFocus(wide, {padX: 40, padY: 20});
  rec.step('One local page. The phone streams live, the checks sit beside it.');
  rec.focusAt(wideFocus.x, wideFocus.y, {w: wideFocus.w, h: wideFocus.h});
  await page.waitForTimeout(3200);

  // --- 2. The checks, all green ----------------------------------------------
  await page.locator('#doctor .check').first().waitFor({timeout: 40_000});
  await page.waitForTimeout(SETTLE_MS);
  rec.step('Eight checks on the USB chain. Every failure names its own fix.');
  await focusOn('#doctor', {padX: 40, padY: 24});
  await page.waitForTimeout(3000);

  // --- 3. The agent drives the phone ------------------------------------------
  const phoneFocus = clampFocus(await box('#screen-wrap'), {padX: 30, padY: 16});
  rec.step('An agent drives it from a terminal. open_app, then tap_text by name.');
  rec.focusAt(phoneFocus.x, phoneFocus.y, {w: phoneFocus.w, h: phoneFocus.h});
  await runPhone(`
import time
open_app("Clock"); time.sleep(2.2)
tap_text("Stopwatch"); time.sleep(1.4)
tap_text("Start"); time.sleep(1.2)
`);

  // --- 4. Zoom in: the stream is live, the hundredths are moving ---------------
  const sb = await box('#screen');
  const digits = clampFocus(
    {x: sb.x, y: sb.y + sb.height * 0.18, width: sb.width, height: sb.height * 0.42},
    {padX: 20, padY: 16},
  );
  rec.step('The stream is live at about 34 frames per second.');
  rec.focusAt(digits.x, digits.y, {w: digits.w, h: digits.h});
  await page.waitForTimeout(2800);

  // --- 5. The human drives the same screen ------------------------------------
  rec.focusAt(phoneFocus.x, phoneFocus.y, {w: phoneFocus.w, h: phoneFocus.h});
  await tapPhone(52, 470, 'You can drive it too. Click the phone to tap it.');
  await page.waitForTimeout(1500);
  await tapPhone(52, 470);
  await page.waitForTimeout(1600);

  // --- 6. Keyboard passthrough -------------------------------------------------
  await rec.click(page.locator('#btn-home'), 'Your keyboard types straight through to the phone.');
  await page.waitForTimeout(1600);
  await tapPhone(220, 778);
  await page.waitForTimeout(1900);
  await page.keyboard.type('stopwatch', {delay: 130});
  await page.waitForTimeout(2200);

  // --- 7. The agent takes it back ---------------------------------------------
  // Also leaves the phone inside an app, which the closing home press needs:
  // WDA's home command is a no-op while Spotlight is open, and a synthetic tap
  // on a Spotlight result row does not activate it.
  rec.step('The agent takes it back with one call.');
  await runPhone('import time\nopen_app("Clock"); time.sleep(2.0)\n');
  await page.waitForTimeout(900);

  // --- 8. The kill switch -------------------------------------------------------
  const pane = clampFocus(union(await box('#screen-wrap'), await box('#controls')), {padX: 30, padY: 14});
  rec.focusAt(pane.x, pane.y, {w: pane.w, h: pane.h});
  await rec.click(page.locator('#btn-stop'), 'The stop button freezes every action. The bezel turns red.');
  await page.waitForTimeout(1400);

  rec.step('The agent tap is refused, and a human tap goes red.');
  await runPhone('tap(52, 470)\n', {allowFail: true});
  await tapPhone(52, 470);
  await page.waitForTimeout(1900);

  // --- 9. Resume, and back to the home screen -----------------------------------
  await rec.click(page.locator('#btn-stop'), 'Resume hands control back.');
  await page.waitForTimeout(1200);
  await rec.click(page.locator('#btn-home'));
  rec.focusAt(wideFocus.x, wideFocus.y, {w: wideFocus.w, h: wideFocus.h});
  await page.waitForTimeout(3000);

  const telemetry = rec.finish(VIEWPORT);
  const video = page.video();
  await context.close(); // flushes the webm
  const src = await video.path();

  const destDir = join(ROOT, 'studio', 'public', 'phoneclaude');
  mkdirSync(destDir, {recursive: true});
  copyFileSync(src, join(destDir, 'demo.webm'));

  const props = {
    brandId: 'phoneclaude',
    video: 'phoneclaude/demo.webm',
    cta: 'Clone it free · github.com/ucsandman/phone-claude',
    telemetry,
  };
  writeFileSync(propsOut, JSON.stringify(props, null, 2) + '\n');
  if (CACHE_ENABLED) {
    storeCache('phoneclaude', 'capture', CACHE_KEY, CACHE_ARTIFACTS, {
      productRepo: PC_ROOT,
      productHead: keyParts.productHead,
    });
  }
  console.log(`capture OK: ${telemetry.durationMs}ms, ${telemetry.events.length} events`);
  console.log('wrote studio/public/phoneclaude/demo.webm and props/phoneclaude-demo.json');
} catch (err) {
  console.error(String(err?.message ?? err));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
