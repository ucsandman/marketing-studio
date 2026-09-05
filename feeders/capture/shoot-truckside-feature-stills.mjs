#!/usr/bin/env node
/**
 * shoot-truckside-feature-stills.mjs - three 16:10 product-surface stills for the
 * LaunchVideo feature panels, cropped from the LIVE seeded dashboard (real
 * surfaces only, never staged). Lives in feeders/capture so it resolves the same
 * @playwright/test the record-*-demo scripts do. Prereq: the app running:
 *   cd C:\Projects\tradesdesk && DEMO_MODE=1 npm run dev:next   (port 3007)
 *
 * Output: studio/public/truckside/feature-{reception,quoting,followup}.png
 */
import {chromium} from '@playwright/test';
import {mkdirSync} from 'node:fs';
import {join, resolve, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = process.env.TS_PORT ?? '3007';
const PASSCODE = process.env.TS_PASSCODE ?? 'trucksidedemo';
const base = `http://localhost:${PORT}`;
const VIEWPORT = {width: 1440, height: 900};
const CW = 1120; // 16:10 crop
const CH = 700;

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

const shots = [
  {sel: 'section:has(h2:has-text("missed calls"))', out: 'feature-reception.png'},
  {sel: 'section:has(h2:has-text("Quotes awaiting approval"))', out: 'feature-quoting.png'},
  {sel: 'section:has(h2:has-text("Follow-ups"))', out: 'feature-followup.png'},
];

const destDir = join(ROOT, 'studio', 'public', 'truckside');
mkdirSync(destDir, {recursive: true});
let browser;
try {
  browser = await chromium.launch();
  const context = await browser.newContext({viewport: VIEWPORT, deviceScaleFactor: 2});
  await context.addInitScript(HIDE_DEVTOOLS);
  const login = await context.request.post(`${base}/api/login`, {form: {passcode: PASSCODE}});
  if (!login.ok()) throw new Error(`owner login failed ${login.status()} (set OWNER_PASSCODE on the server)`);
  const page = await context.newPage();
  await page.goto(`${base}/app`, {waitUntil: 'networkidle'});
  await page.getByRole('heading', {name: /Summit Garage/i}).waitFor({timeout: 20_000});

  for (const {sel, out} of shots) {
    const loc = page.locator(sel).first();
    await loc.scrollIntoViewIfNeeded();
    await page.waitForTimeout(700);
    const box = await loc.boundingBox();
    if (!box) throw new Error(`no bounding box for ${sel}`);
    const x = Math.round(Math.max(0, Math.min(box.x + box.width / 2 - CW / 2, VIEWPORT.width - CW)));
    const y = Math.round(Math.max(0, Math.min(box.y - 20, VIEWPORT.height - CH)));
    await page.screenshot({path: join(destDir, out), clip: {x, y, width: CW, height: CH}});
    console.log(`wrote studio/public/truckside/${out}  clip {x:${x},y:${y},w:${CW},h:${CH}}`);
  }
  console.log('feature stills OK');
} catch (err) {
  console.error(String(err?.message ?? err));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
