#!/usr/bin/env node
/**
 * shoot-truckside-feature-stills.mjs - three PANEL-ASPECT product strips for the
 * LaunchVideo feature shots, cropped from the LIVE seeded dashboard (real
 * surfaces only, never staged). Lives in feeders/capture so it resolves the same
 * @playwright/test the record-*-demo scripts do. Prereq: the app running:
 *   cd C:\Projects\tradesdesk && DEMO_MODE=1 OWNER_PASSCODE=... npm run dev:next
 *
 * WHY A STRIP, NOT A SECTION. LaunchVideo's DirectedFeature draws the screenshot
 * into a crop box of width*0.704 x height*0.296 (1352x320 at 1080p) and scales it
 * so the still's WIDTH fits exactly; anything taller than 4.2:1 is clipped top and
 * bottom, and its CameraRig focus math still measures against the full still, so a
 * tall still both loses pixels and mis-frames. Shooting at exactly the panel aspect
 * makes the whole still visible and the focus rect literal.
 *
 * Each strip is centered on ONE consequential interaction and the measured box of
 * that interaction is written to props/truckside-feature-focus.json, so
 * build-launch-props.mjs can hand the shot an exact focus rect instead of a guess.
 *
 * Output: <project>/marketing/assets/truckside/{assets,public/truckside}/feature-*.png
 *         <project>/marketing/assets/truckside/props/truckside-feature-focus.json
 */
import {chromium} from '@playwright/test';
import {copyFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {projectArg, resolveWorkspace} from '../../scripts/lib/workspace.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const argv = process.argv.slice(2);
const workspace = resolveWorkspace(ROOT, {brand: 'truckside', project: projectArg(argv) ?? process.env.TS_ROOT ?? 'C:/Projects/tradesdesk'});
const PORT = process.env.TS_PORT ?? '3007';
const PASSCODE = process.env.TS_PASSCODE ?? 'trucksidedemo';
const base = `http://localhost:${PORT}`;
const VIEWPORT = {width: 1440, height: 900};
const DPR = 2;
// LaunchVideo DirectedFeature landscape crop box, in CSS pixels: 1920*0.704 x 1080*0.296.
const STRIP = {width: 1352, height: 320};

const HIDE_DEVTOOLS = `
  (() => {
    const strip = (root) => {
      if (!root || !root.querySelectorAll) return;
      root.querySelectorAll('#devtools-indicator, nextjs-portal, [data-next-badge-root], [data-nextjs-dev-tools-button]').forEach((n) => n.remove());
      root.querySelectorAll('*').forEach((e) => { if (e.shadowRoot) strip(e.shadowRoot); });
    };
    const sweep = () => strip(document);
    sweep(); setInterval(sweep, 150);
    document.addEventListener('DOMContentLoaded', sweep);
  })();
`;

const union = (a, b) => {
  const x1 = Math.min(a.x, b.x);
  const y1 = Math.min(a.y, b.y);
  const x2 = Math.max(a.x + a.width, b.x + b.width);
  const y2 = Math.max(a.y + a.height, b.y + b.height);
  return {x: x1, y: y1, width: x2 - x1, height: y2 - y1};
};

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

mkdirSync(workspace.assetsDir, {recursive: true});
mkdirSync(workspace.propsDir, {recursive: true});
const publicDir = join(workspace.publicDir, 'truckside');
mkdirSync(publicDir, {recursive: true});

let browser;
try {
  browser = await chromium.launch();
  const context = await browser.newContext({viewport: VIEWPORT, deviceScaleFactor: DPR});
  await context.addInitScript(HIDE_DEVTOOLS);
  const login = await context.request.post(`${base}/api/login`, {form: {passcode: PASSCODE}});
  if (!login.ok()) throw new Error(`owner login failed ${login.status()} (set OWNER_PASSCODE on the server)`);
  const page = await context.newPage();
  await page.goto(`${base}/app`, {waitUntil: 'networkidle'});
  await page.getByRole('heading', {name: /Summit Garage/i}).waitFor({timeout: 20_000});

  // The reception panel has to show the CONSEQUENCE (a booked window), not an empty
  // missed call, so the same button the demo capture presses is pressed here first.
  const missedSection = page.locator('section:has(h2:has-text("missed calls"))').first();
  const bookedRow = missedSection.locator('li:has-text("Booked:")');
  if ((await bookedRow.count()) === 0) {
    await page.getByRole('button', {name: 'Simulate missed call'}).click();
    await bookedRow.first().waitFor({timeout: 30_000});
  }

  const quoteCard = page.locator('form:has(button:has-text("Approve")):has(p:has-text("Total"))').first();
  const followRow = page
    .locator('section:has(h2:has-text("Follow-ups")) li:has(button:has-text("Approve"))')
    .first();

  const targets = [
    {
      key: 'reception',
      out: 'feature-reception.png',
      subject: () => bookedRow.first(),
      // The booked row IS the interaction; nothing else needs to be in frame.
      extra: null,
      note: 'the missed call that came back booked',
    },
    {
      key: 'quoting',
      out: 'feature-quoting.png',
      subject: () => quoteCard.locator('button:has-text("Approve")').first(),
      // The button only means something beside the number it approves.
      extra: () => quoteCard.locator('p:has-text("Total")').first(),
      // Anchored to the bottom of the Approve row so the destructive Dismiss button
      // and the "How this works" disclosure below it stay out of the panel; the extra
      // room goes upward, onto the priced line items, which is the point of the shot.
      anchor: 'bottom',
      anchorMargin: 10,
      note: 'the Approve button beside the priced total',
    },
    {
      key: 'followup',
      out: 'feature-followup.png',
      subject: () => followRow,
      extra: null,
      note: 'the drafted follow-up waiting on one tap',
    },
  ];

  const emitted = {};
  for (const target of targets) {
    const subject = target.subject();
    await subject.scrollIntoViewIfNeeded();
    // Park the subject at viewport center so a 320px strip always has room around it.
    await subject.evaluate((el) => el.scrollIntoView({block: 'center', behavior: 'instant'}));
    await page.waitForTimeout(500);
    let box = await subject.boundingBox();
    if (!box) throw new Error(`no bounding box for ${target.key}`);
    if (target.extra) {
      const extraBox = await target.extra().boundingBox();
      if (!extraBox) throw new Error(`no bounding box for ${target.key} context element`);
      box = union(box, extraBox);
    }
    const cx = box.x + box.width / 2;
    const cy = box.y + box.height / 2;
    const wantY =
      target.anchor === 'bottom'
        ? box.y + box.height + (target.anchorMargin ?? 0) - STRIP.height
        : cy - STRIP.height / 2;
    const clipX = Math.round(clamp(cx - STRIP.width / 2, 0, VIEWPORT.width - STRIP.width));
    const clipY = Math.round(clamp(wantY, 0, VIEWPORT.height - STRIP.height));
    const assetOut = join(workspace.assetsDir, target.out);
    const publicOut = join(publicDir, target.out);
    await page.screenshot({path: assetOut, clip: {x: clipX, y: clipY, width: STRIP.width, height: STRIP.height}});
    copyFileSync(assetOut, publicOut);
    // CameraSubject is CENTER x/y plus width/height, in the still's own pixels (DPR applied).
    const focus = {
      x: Math.round((cx - clipX) * DPR),
      y: Math.round((cy - clipY) * DPR),
      w: Math.round(box.width * DPR),
      h: Math.round(box.height * DPR),
    };
    const inside =
      focus.x - focus.w / 2 >= 0 &&
      focus.y - focus.h / 2 >= 0 &&
      focus.x + focus.w / 2 <= STRIP.width * DPR &&
      focus.y + focus.h / 2 <= STRIP.height * DPR;
    emitted[target.key] = {
      screenshot: `truckside/${target.out}`,
      note: target.note,
      focus,
      focusInsideStill: inside,
    };
    console.log(
      `wrote ${assetOut}  clip {x:${clipX},y:${clipY},w:${STRIP.width},h:${STRIP.height}}  focus ${JSON.stringify(focus)} inside=${inside}`,
    );
  }

  writeFileSync(
    join(workspace.propsDir, 'truckside-feature-focus.json'),
    JSON.stringify(
      {version: 1, viewport: {width: STRIP.width * DPR, height: STRIP.height * DPR}, features: emitted},
      null,
      2,
    ) + '\n',
  );
  console.log('feature stills OK');
} catch (err) {
  console.error(String(err?.stack ?? err?.message ?? err));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
