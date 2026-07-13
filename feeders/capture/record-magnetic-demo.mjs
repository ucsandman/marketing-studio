#!/usr/bin/env node
/**
 * record-magnetic-demo.mjs - records a six-beat Magnetic (FCP-style editor)
 * walkthrough for ProductDemo, driving the BUILT app through its e2e test bridge.
 *
 * CAPTURE PATH: Electron `_electron.launch({recordVideo})` (probed working on
 * Playwright 1.61.1 — page.video() yields a .webm). No ffmpeg gdigrab fallback
 * needed. Launch/env/args copied verbatim from final-cut-pro/e2e/timeline.spec.ts
 * launchApp(): args=[out/main/index.js], env MAGNETIC_TEST=1 + MAGNETIC_LIBRARY_PATH
 * pointed at a throwaway .mglib. executablePath must be set because we run from the
 * capture feeder, not from the product repo (Playwright can't auto-discover electron).
 *
 * READ-ONLY on final-cut-pro: we launch its prebuilt app and read its electron
 * binary. We never build, install, or write there.
 *
 * LEAD-IN TRIM: recordVideo starts at window creation, but the on-camera beats
 * only start after import + background filmstrip/envelope jobs (~10-20s of boot).
 * We measure that lead-in (wall clock from firstWindow() to rec.start()) and
 * re-encode-trim it off the webm front so video t=0 == telemetry t=0 (ProductDemo
 * plays OffthreadVideo aligned to telemetry time). Override with MAGNETIC_TRIM_MS.
 *
 * TELEMETRY CONTRACT (telemetry.json, t in ms relative to rec.start == video t=0):
 *   { viewport:{width,height}, durationMs,
 *     steps:  [{t, label}],
 *     clicks: [{t, x, y}],                       // cursor/ripple, viewport==video px
 *     focus:  [{t, rect:{x, y, w, h}}] }         // x,y = CENTER of region, w,h size
 * Task 8's build-magnetic-demo-props.mjs flattens this into ProductDemo's event
 * schema (studio/src/lib/telemetry.ts: click/step/focus with x,y=center + w,h).
 *
 * Focus rects are MEASURED content regions (DOM boundingBox for the browser panel /
 * export dialog; timeline geometry flicks->x for on-canvas spine regions), never
 * click points, then verified against extracted frames. See docs/PLAYBOOK.md.
 *
 * Output (staged, gitignored build products):
 *   studio/public/magnetic/{demo.webm,telemetry.json}
 *   assets/magnetic/demo/{demo.webm,telemetry.json}
 */
import {_electron as electron} from '@playwright/test';
import {execFileSync} from 'node:child_process';
import {copyFileSync, mkdirSync, mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const FCP = process.env.MAGNETIC_ROOT ?? 'C:/projects/final-cut-pro';
const ELECTRON_BIN = join(FCP, 'node_modules', 'electron', 'dist', 'electron.exe');
const MAIN = join(FCP, 'out', 'main', 'index.js');
const MEDIA = join(ROOT, 'out', 'magnetic', 'demo-media');
const CLIPS = ['clip-a.mp4', 'clip-b.mp4', 'clip-c.mp4'].map((f) => join(MEDIA, f));
const VO = join(MEDIA, 'voiceover-take.mp4');
const IMPORT_PATHS = [...CLIPS, VO];

const VP = {width: 1920, height: 1080};
const FPS_FLICKS = 705_600_000;
// Spine hit-band (canvas-local px): ruler(26) + gutter(4) + one reserved video
// lane(36) + half spine(24) = 90. Verified empirically against the built app
// (hit-test sweep) and matches final-cut-pro/e2e/timeline.spec.ts spineCenterY.
// Hit-testing uses the inner <canvas> rect (localPoint), NOT the host div, so we
// measure canvas.timeline-canvas — the host testid wraps it.
const SPINE_CENTER_Y = 90;

// ---------------- tiny telemetry recorder ----------------
class Rec {
  #t0 = null;
  steps = [];
  clicks = [];
  focus = [];
  start() {
    this.#t0 = performance.now();
  }
  #now() {
    if (this.#t0 === null) throw new Error('Rec: start() first');
    return Math.round(performance.now() - this.#t0);
  }
  step(label) {
    this.steps.push({t: this.#now(), label});
  }
  click(x, y) {
    this.clicks.push({t: this.#now(), x: Math.round(x), y: Math.round(y)});
  }
  focusRect(x, y, w, h) {
    // clamp the region to the viewport so the camera never frames outside the app
    const cw = Math.min(VP.width, Math.round(w));
    const ch = Math.min(VP.height, Math.round(h));
    const cx = Math.min(Math.max(Math.round(x), cw / 2), VP.width - cw / 2);
    const cy = Math.min(Math.max(Math.round(y), ch / 2), VP.height - ch / 2);
    this.focus.push({t: this.#now(), rect: {x: Math.round(cx), y: Math.round(cy), w: cw, h: ch}});
  }
  finish() {
    return {viewport: VP, durationMs: this.#now(), steps: this.steps, clicks: this.clicks, focus: this.focus};
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const easeInOutCubic = (t) => (t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2);

async function main() {
  const tempRoot = mkdtempSync(join(tmpdir(), 'magnetic-demo-'));
  const libraryPath = join(tempRoot, 'Demo.mglib');
  const videoDir = join(ROOT, 'out', 'capture', 'magnetic');
  mkdirSync(videoDir, {recursive: true});

  const app = await electron.launch({
    executablePath: ELECTRON_BIN,
    args: [MAIN],
    env: {...process.env, MAGNETIC_TEST: '1', MAGNETIC_LIBRARY_PATH: libraryPath},
    recordVideo: {dir: videoDir, size: VP},
  });
  const page = await app.firstWindow();
  const videoT0Wall = Date.now(); // recordVideo began ~here (window creation)

  // 1920x1080 content window, centered
  const win = await app.browserWindow(page);
  await win.evaluate((w) => {
    w.setContentSize(1920, 1080);
    w.center();
  });
  await page.waitForTimeout(400);

  // --- import via the test bridge (verbatim shape from timeline.spec.ts) ---
  const imported = await page.evaluate((p) => window.api.__test.importPaths(p), IMPORT_PATHS);
  if (imported.errors.length > 0) throw new Error(`import errors: ${JSON.stringify(imported.errors)}`);

  // sequence store ready
  await page.waitForFunction(
    () => window.__magneticState !== undefined && window.__magneticState().sequence !== null,
    undefined,
    {timeout: 30_000},
  );
  // filmstrips painted for the three video clips (background job)
  await page.getByTestId('asset-strip').first().waitFor({state: 'visible', timeout: 90_000});
  await page.waitForFunction(() => document.querySelectorAll('[data-testid="asset-strip"]').length >= 3, undefined, {
    timeout: 90_000,
  });
  // voiceover envelope ready (Rough Cut beat depends on it)
  await page.waitForFunction(
    async () => {
      const lib = await window.api.getLibrary();
      return Object.values(lib.assets).some((a) => a.envelopeUrl !== undefined);
    },
    undefined,
    {timeout: 120_000},
  );
  await page.waitForTimeout(500);

  // --- geometry helpers ---
  const state = () => page.evaluate(() => window.__magneticState());
  const view = () =>
    page.evaluate(() => (window.__magneticTimeline?.view ? window.__magneticTimeline.view() : {scrollX: 0}));
  const canvasBox = async () => (await page.locator('canvas.timeline-canvas').boundingBox());

  const spineCenterY = (box) => box.y + SPINE_CENTER_Y;
  const xForFlicks = (flicks, st, box, v) =>
    box.x + (flicks / FPS_FLICKS) * st.zoomPxPerSec - (v?.scrollX ?? 0);
  const spineDur = (st) => (st.sequence?.spine ?? []).map((i) => i.durationFlicks);

  // --- real cursor easing (composite draws its own cursor from clicks[], but we
  //     still move the physical mouse for hover-skim + to land real clicks) ---
  let cur = {x: VP.width / 2, y: VP.height / 2};
  async function ease(x, y, ms = 700, steps = 22) {
    const from = {...cur};
    for (let i = 1; i <= steps; i++) {
      const p = easeInOutCubic(i / steps);
      await page.mouse.move(from.x + (x - from.x) * p, from.y + (y - from.y) * p);
      await sleep(ms / steps);
    }
    cur = {x, y};
  }
  async function clickAt(x, y, {approach = 700} = {}) {
    await ease(x, y, approach);
    rec.click(x, y);
    await page.mouse.click(x, y);
  }
  async function selectAssetCell(fileName) {
    const box = await page.getByTestId(`asset-cell-${fileName}`).boundingBox();
    await clickAt(box.x + box.width / 2, box.y + box.height / 2);
    return box;
  }

  const rec = new Rec();
  rec.start();
  const recStartWall = Date.now();
  await sleep(500); // tiny pre-roll before the first caption

  // ======================= BEAT 1: filmstrip browser skim =======================
  rec.step('Skim the shot browser — every clip previews live under the cursor.');
  {
    const panel = await page.getByTestId('panel-browser').boundingBox();
    rec.focusRect(panel.x + panel.width / 2, panel.y + panel.height / 2, panel.width + 80, panel.height + 40);
    const aBox = await page.getByTestId('asset-cell-clip-a.mp4').boundingBox();
    const bBox = await page.getByTestId('asset-cell-clip-b.mp4').boundingBox();
    for (const b of [aBox, bBox]) {
      const y = b.y + Math.min(b.height / 2, 60); // over the filmstrip strip, not the label
      await ease(b.x + 10, y, 500, 10);
      // scrub across the strip so the preview frame steps through the clip
      for (let i = 0; i <= 16; i++) {
        await page.mouse.move(b.x + 8 + (b.width - 16) * (i / 16), y);
        await sleep(70);
      }
      cur = {x: b.x + b.width - 8, y};
      rec.click(cur.x, cur.y);
      await sleep(300);
    }
  }

  // ======================= BEAT 2: E append three clips, L plays =======================
  rec.step('Press E — clips snap onto the magnetic timeline, end to end.');
  for (const f of ['clip-a.mp4', 'clip-b.mp4', 'clip-c.mp4']) {
    await selectAssetCell(f);
    await page.keyboard.press('e');
    await sleep(500);
  }
  await page.keyboard.press('Shift+z'); // zoom to fit so the whole spine is visible
  await sleep(400);
  {
    const box = await canvasBox();
    const st = await state();
    const v = await view();
    const total = spineDur(st).reduce((a, b) => a + b, 0);
    const midX = xForFlicks(total / 2, st, box, v);
    rec.focusRect(midX, spineCenterY(box), Math.min(VP.width, box.width * 0.86), 430);
    await ease(midX, spineCenterY(box), 600);
    await page.keyboard.press('l'); // play
    await sleep(2000);
    await page.keyboard.press('k'); // pause
    await sleep(300);
  }

  // ======================= BEAT 3: B blade a clip, Delete ripples the gap shut =======================
  rec.step('Blade a clip, delete it — the gap closes itself. That is magnetic.');
  {
    let box = await canvasBox();
    let st = await state();
    let v = await view();
    const durs = spineDur(st); // [A, B, C]
    const cutFlicks = durs[0] + durs[1] * 0.5; // middle of clip B
    const cutX = xForFlicks(cutFlicks, st, box, v);
    const yMid = spineCenterY(box);
    await page.keyboard.press('b'); // blade tool
    await sleep(250);
    await clickAt(cutX, yMid); // slice clip B -> [A, B1, B2, C]
    await sleep(400);
    await page.keyboard.press('a'); // back to select tool
    // select the right half (B2): just right of the cut
    st = await state();
    v = await view();
    const b2X = xForFlicks(cutFlicks + durs[1] * 0.1, st, box, v);
    await clickAt(b2X, yMid);
    await sleep(300);
    rec.focusRect(cutX, yMid, 760, 360); // the closing-gap join
    await page.keyboard.press('Delete'); // ripple delete -> downstream slides left, gap shut
    await sleep(1200);
  }

  // ======================= BEAT 4: Ctrl+B blade a clip, Ctrl+T cross dissolve on that cut =======================
  // A cross dissolve needs media handles on BOTH sides of the cut (final-cut-pro
  // shared/timeline/transitions.ts). Our clips are full-source (no handles), so a
  // dissolve at a spine boundary is a no-op. Blading a clip at the playhead yields
  // two halves that SHARE the source — both sides get handles — so the dissolve on
  // that internal cut is valid. That is the honest way to demo it.
  rec.step('Ctrl+T drops a cross dissolve on the nearest cut.');
  {
    let box = await canvasBox();
    let st = await state();
    let v = await view();
    const durs = spineDur(st); // [A, B1, C]
    const cutFlicks = durs[0] + durs[1] + durs[2] * 0.4; // ~40% into clip C
    const yMid = spineCenterY(box);
    const cutX = xForFlicks(cutFlicks, st, box, v);
    await ease(cutX, box.y + 10, 500); // ride the ruler to the cut point
    await page.mouse.click(cutX, box.y + 10); // set playhead
    rec.click(cutX, box.y + 10);
    await sleep(200);
    await page.keyboard.press('Control+b'); // blade at playhead: both-handle internal cut
    await sleep(300);
    await page.keyboard.press('Control+t'); // 1 s cross dissolve on that cut
    await sleep(900);
    box = await canvasBox();
    st = await state();
    v = await view();
    const dissolveX = xForFlicks(cutFlicks, st, box, v);
    await ease(dissolveX, yMid, 500);
    rec.focusRect(dissolveX, yMid, 620, 340);
    await sleep(800);
  }

  // ======================= BEAT 5: voiceover -> Rough Cut -> ghost diff -> Accept =======================
  rec.step('Drop in the voiceover — Rough Cut finds the dead air.');
  {
    await selectAssetCell('voiceover-take.mp4');
    await page.keyboard.press('e'); // append VO to the spine
    await sleep(700);
    // open the Rough Cut tab
    await clickAt(...(await (async () => {
      const b = await page.getByTestId('browser-tab-roughcut').boundingBox();
      return [b.x + b.width / 2, b.y + b.height / 2];
    })()));
    await page.getByTestId('roughcut-panel').waitFor({state: 'visible', timeout: 20_000});
    await page.getByTestId('roughcut-apply').waitFor({state: 'visible', timeout: 20_000});
    // focus the VO region on the timeline where the ghost diff will show
    {
      const box = await canvasBox();
      const st = await state();
      const v = await view();
      const durs = spineDur(st);
      const voStart = durs.slice(0, -1).reduce((a, b) => a + b, 0);
      const voMid = voStart + durs[durs.length - 1] / 2;
      rec.focusRect(xForFlicks(voMid, st, box, v), spineCenterY(box), Math.min(VP.width, box.width * 0.8), 400);
    }
    rec.step('Ghost diff: red is the cut, green is the tightened result.');
    const applyBox = await page.getByTestId('roughcut-apply').boundingBox();
    await clickAt(applyBox.x + applyBox.width / 2, applyBox.y + applyBox.height / 2);
    await page.getByTestId('roughcut-proposal-summary').waitFor({state: 'visible', timeout: 20_000});
    await sleep(1600);
    const acceptBox = await page.getByTestId('roughcut-accept').boundingBox();
    rec.step('Accept — two dead-air pauses gone, one undo step.');
    await clickAt(acceptBox.x + acceptBox.width / 2, acceptBox.y + acceptBox.height / 2);
    await page.getByTestId('roughcut-review-summary').waitFor({state: 'visible', timeout: 20_000});
    await sleep(1400);
  }

  // ======================= BEAT 6: Ctrl+E export dialog, hold, close =======================
  rec.step('Ctrl+E to export — presets ready, one click ships it.');
  {
    await page.keyboard.press('Control+e');
    const dlg = await page.getByTestId('export-dialog');
    await dlg.waitFor({state: 'visible', timeout: 20_000});
    const dbox = await dlg.boundingBox();
    rec.focusRect(dbox.x + dbox.width / 2, dbox.y + dbox.height / 2, Math.min(VP.width, dbox.width + 160), dbox.height + 120);
    await sleep(2000); // hold on the export dialog
    const closeBox = await page.getByTestId('export-close').boundingBox();
    await clickAt(closeBox.x + closeBox.width / 2, closeBox.y + closeBox.height / 2);
    await sleep(500);
  }

  const telemetry = rec.finish();
  const leadInMs = process.env.MAGNETIC_TRIM_MS ? Number(process.env.MAGNETIC_TRIM_MS) : recStartWall - videoT0Wall;

  const video = page.video();
  await app.close(); // flushes the webm
  const rawWebm = await video.path();
  console.log(`raw webm: ${rawWebm}  (lead-in trim ${leadInMs} ms, duration ${telemetry.durationMs} ms)`);

  // --- trim the boot/import lead-in so video t=0 == telemetry t=0 ---
  // Input-seek (-ss before -i) with re-encode is frame-accurate and fast in modern
  // ffmpeg. VP8/libvpx realtime keeps the re-encode well under the timebox.
  const trimmedWebm = join(videoDir, 'demo.webm');
  const trimSec = Math.max(0, leadInMs / 1000).toFixed(3);
  runFfmpeg([
    '-ss', trimSec,
    '-i', rawWebm,
    '-an',
    '-c:v', 'libvpx', '-b:v', '8M', '-deadline', 'realtime', '-cpu-used', '6', '-auto-alt-ref', '0',
    '-y', trimmedWebm,
  ]);

  // --- stage into both consumer locations (gitignored build products) ---
  const telemetryJson = JSON.stringify(telemetry, null, 2) + '\n';
  for (const destDir of [join(ROOT, 'studio', 'public', 'magnetic'), join(ROOT, 'assets', 'magnetic', 'demo')]) {
    mkdirSync(destDir, {recursive: true});
    copyFileSync(trimmedWebm, join(destDir, 'demo.webm'));
    writeFileSync(join(destDir, 'telemetry.json'), telemetryJson);
  }
  console.log(
    `staged demo.webm + telemetry.json -> studio/public/magnetic/ and assets/magnetic/demo/  ` +
      `(${telemetry.steps.length} steps, ${telemetry.clicks.length} clicks, ${telemetry.focus.length} focus)`,
  );
}

/** Run the ffmpeg bundled with @remotion/renderer via its CLI (studio has it). */
function runFfmpeg(args) {
  execFileSync('npx', ['remotion', 'ffmpeg', ...args], {
    cwd: join(ROOT, 'studio'),
    stdio: 'inherit',
    shell: true,
  });
}

main().catch((err) => {
  console.error(String(err?.stack ?? err?.message ?? err));
  process.exit(1);
});
