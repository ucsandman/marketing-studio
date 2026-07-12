#!/usr/bin/env node
/**
 * record-dashclaw-demo.mjs - records a DashClaw walkthrough for ProductDemo.
 *
 * Prereq: the DashClaw app running in demo mode on localhost:3001:
 *   cd C:\Projects\DashClaw
 *   npx next build
 *   DASHCLAW_MODE=demo node node_modules/next/dist/bin/next start -p 3001
 * (DASHCLAW_MODE=demo serves fixtures with no auth; the build must NOT set
 *  NEXT_PUBLIC_DASHCLAW_MODE=demo so the client shows no "Demo Mode" chrome.)
 *
 * Admin view on /approvals: the app renders a "Read-only access" banner and
 * mutes Allow/Deny whenever the viewer is not an admin, and /api/session/effective
 * is a demo passthrough that reports the real (unauthenticated) cookie state.
 * We intercept it to report an admin viewer, and intercept /api/actions to serve
 * a curated, on-message pending queue built from DashClaw's own governance
 * stories, plus a stateful POST /api/approvals/:id so the one-click Allow beat
 * actually removes the card. This is capture presentation only; no product code
 * is touched.
 *
 * Output: ../../studio/public/dashclaw/demo.webm + ../../props/dashclaw-demo.json
 *
 * Camera focus rects are MEASURED from each target element's real boundingBox
 * (viewport px == webm px because recordVideo.size == viewport), never derived
 * from click points. Pages are separate routes, so we navigate with goto.
 */
import {chromium} from '@playwright/test';
import {copyFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Recorder} from './recorder.mjs';
import {cacheKey, checkCache, storeCache} from '../../scripts/lib/cache.mjs';
import {captureKeyParts} from './capture-cache.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const PORT = process.env.DC_PORT ?? '3001';
// Product repo: the app is reached over the port, but the cache must fingerprint
// the source it films. Default matches the launch command in this file's header.
const DC_ROOT = process.env.DC_ROOT ?? 'C:/Projects/DashClaw';
const base = `http://localhost:${PORT}`;
const VIEWPORT = {width: 1440, height: 900};
const VIEW_HOLD_MS = 3800;
const SETTLE_MS = 750; // let entrance animations / scroll settle before measuring

// --- Footage cache gate (before the app-reachability check or browser launch) ---
const argv = process.argv.slice(2);
const FORCE = argv.includes('--force');
const CHECK_ONLY = argv.includes('--cache-check-only');
const videoOut = join(ROOT, 'studio', 'public', 'dashclaw', 'demo.webm');
const propsOut = join(ROOT, 'props', 'dashclaw-demo.json');
const CACHE_ARTIFACTS = [videoOut, propsOut];
const keyParts = captureKeyParts({
  repo: DC_ROOT,
  scriptPath: fileURLToPath(import.meta.url),
  config: {viewport: VIEWPORT, holdMs: VIEW_HOLD_MS, settleMs: SETTLE_MS},
});
const CACHE_KEY = cacheKey(keyParts);
const CACHE_ENABLED = keyParts.productHead !== null; // null => product repo unresolvable, cannot verify inputs

if (CHECK_ONLY) {
  const {hit} = CACHE_ENABLED ? checkCache('dashclaw', 'capture', CACHE_KEY, CACHE_ARTIFACTS) : {hit: false};
  console.log(hit ? 'HIT' : 'MISS');
  process.exit(0);
}
if (!CACHE_ENABLED) {
  console.log(`capture cache: product git state unavailable at ${DC_ROOT} — caching disabled this run`);
} else if (!FORCE) {
  const {hit} = checkCache('dashclaw', 'capture', CACHE_KEY, CACHE_ARTIFACTS);
  if (hit) {
    console.log(`capture cache hit — reusing ${videoOut}`);
    process.exit(0);
  }
}

try {
  const res = await fetch(`${base}/api/actions?status=pending_approval`, {signal: AbortSignal.timeout(3000)});
  if (res.status >= 500) throw new Error(`server error ${res.status}`);
} catch {
  console.error(`App unreachable at ${base}. Start it in demo mode: cd C:\\Projects\\DashClaw && DASHCLAW_MODE=demo node node_modules/next/dist/bin/next start -p ${PORT}`);
  process.exit(1);
}

// Curated, on-message pending queue built from DashClaw's canonical governance
// stories (deploy gate, destructive ops, financial, outbound). Field shapes
// match the live GET /api/actions row exactly.
const inMin = (m) => new Date(Date.now() + m * 60_000).toISOString();
const agoMin = (m) => new Date(Date.now() - m * 60_000).toISOString();
const CURATED = [
  {
    action_id: 'ar_deploy_4f2a91c', agent_id: 'deploy-bot', agent_name: 'Deploy Bot',
    action_type: 'deploy', declared_goal: 'Deploy build 4f2a91c to production-api',
    risk_score: 82, status: 'pending_approval', timestamp_start: agoMin(2),
    approval_expires_at: inMin(13), act_content_hash: 'sha256:4f2a91c0b7',
    systems_touched: '["production-api","aws-lambda"]',
    reasoning: 'Latest verified build passed CI. Rolling to production behind the deploy gate.',
  },
  {
    action_id: 'ar_purge_customers', agent_id: 'data-pipeline', agent_name: 'Data Pipeline',
    action_type: 'delete', declared_goal: 'Drop 12,480 expired rows from the customers table',
    risk_score: 94, status: 'pending_approval', timestamp_start: agoMin(5),
    approval_expires_at: inMin(10),
    systems_touched: '["postgres-prod","customer-data"]',
    reasoning: 'Retention policy flagged rows past the 90-day window. Irreversible on customer data.',
  },
  {
    action_id: 'ar_refund_sub1m2x', agent_id: 'refund-agent', agent_name: 'Refund Agent',
    action_type: 'api', declared_goal: 'Issue a $12,000 refund to Stripe customer sub_1M2x',
    risk_score: 88, status: 'pending_approval', timestamp_start: agoMin(8),
    approval_expires_at: inMin(7), act_content_hash: 'sha256:9a1c33ef20',
    systems_touched: '["stripe"]',
    reasoning: 'Escalation ticket 4471 requests a full refund above the auto-approve ceiling.',
  },
  {
    action_id: 'ar_announce_4200', agent_id: 'outreach-bot', agent_name: 'Outreach Bot',
    action_type: 'message', declared_goal: 'Send the launch announcement to 4,200 subscribers',
    risk_score: 61, status: 'pending_approval', timestamp_start: agoMin(12),
    approval_expires_at: inMin(4),
    systems_touched: '["sendgrid"]',
    reasoning: 'Outbound campaign approved in draft. Send is gated by the outbound message rule.',
  },
];
const resolved = new Set();
const pendingPayload = () => {
  const actions = CURATED.filter((a) => !resolved.has(a.action_id));
  const stats = {
    total: actions.length, completed: 0, failed: 0, running: 0,
    high_risk: actions.filter((a) => a.risk_score >= 70).length,
    avg_risk: actions.length ? actions.reduce((s, a) => s + a.risk_score, 0) / actions.length : 0,
    total_cost: 0,
  };
  return {actions, total: actions.length, stats, lastUpdated: new Date().toISOString()};
};

// Kill the Next.js dev-tools indicator (dark circular "N"). It lives inside a
// SHADOW ROOT, so a light-DOM removal never reaches it. Walk every shadow root
// on an interval and remove it, so it never lands in a frame. (Belt-and-braces:
// `next start` production mode does not show it, but keep the sweep.)
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

  // --- Admin view + curated queue interception (capture presentation only) ---
  await context.route('**/api/session/effective', (route) =>
    route.fulfill({json: {authenticated: true, authType: 'local', role: 'admin', isAdmin: true}}));
  await context.route('**/api/actions**', (route) => {
    const status = new URL(route.request().url()).searchParams.get('status');
    if (status === 'pending_approval') return route.fulfill({json: pendingPayload()});
    if (status === 'expired') return route.fulfill({json: {actions: [], total: 0, lastUpdated: new Date().toISOString()}});
    return route.continue();
  });
  await context.route('**/api/approvals/**', (route) => {
    if (route.request().method() === 'POST') {
      const id = new URL(route.request().url()).pathname.split('/').pop();
      resolved.add(id);
      return route.fulfill({json: {ok: true, action_id: id, status: 'approved'}});
    }
    return route.continue();
  });

  const page = await context.newPage();
  const rec = new Recorder();

  const focusOn = async (selector, {padX, padY, biasY = 0} = {}) => {
    const loc = page.locator(selector).first();
    await loc.scrollIntoViewIfNeeded();
    await page.waitForTimeout(SETTLE_MS);
    const box = await loc.boundingBox();
    if (!box) throw new Error(`focus target ${selector} has no bounding box`);
    const f = clampFocus(box, {padX, padY});
    f.y = Math.min(Math.max(f.y + biasY, f.h / 2), VIEWPORT.height - f.h / 2);
    rec.focusAt(f.x, f.y, {w: f.w, h: f.h});
  };

  rec.start();

  // 1. Approvals - the hero queue, established wide
  await page.goto(`${base}/approvals`, {waitUntil: 'domcontentloaded'});
  await page.getByText('Awaiting Approval').first().waitFor({timeout: 20_000});
  await page.waitForTimeout(SETTLE_MS);
  rec.step('Every action your unattended agent tries is intercepted and held here.');
  await focusOn('[data-entity-type="decision"]', {padX: 44, padY: 150}); // top card + a peek of the next
  await page.waitForTimeout(VIEW_HOLD_MS);

  // 2. Approvals - tighten on the top card: risk, systems, act-binding, controls
  rec.step('Risk scored, systems named, bound to the exact command.');
  await focusOn('[data-entity-type="decision"]', {padX: 40, padY: 46});
  await page.waitForTimeout(VIEW_HOLD_MS);

  // 3. Approvals - the one-click Allow. Card resolves, the queue shrinks.
  rec.step('One click releases it. The decision is recorded.');
  const allowBtn = page.locator('[data-entity-type="decision"]').first().getByRole('button', {name: 'Allow'});
  await rec.click(allowBtn); // logs cursor + performs the real click
  await page.waitForTimeout(1600); // let the list re-fetch and the card fall away
  rec.focusAt(720, 430, {w: 1180, h: 720}); // ease back out to the shortened queue
  await page.waitForTimeout(VIEW_HOLD_MS);

  // 4. Decisions - the causal-chain ledger
  await page.goto(`${base}/decisions`, {waitUntil: 'domcontentloaded'});
  await page.locator('[data-entity-type="decision"]').first().waitFor({timeout: 20_000});
  await page.waitForTimeout(SETTLE_MS);
  rec.step('Every governed action, chained to the decision that allowed it.');
  await focusOn('[data-entity-type="decision"]', {padX: 44, padY: 190}); // a run of ledger rows
  await page.waitForTimeout(VIEW_HOLD_MS);

  // 5. Policies - the "One Ledger, Many Lenses" workbench
  await page.goto(`${base}/policies`, {waitUntil: 'domcontentloaded'});
  await page.getByRole('button', {name: /New rule/i}).first().waitFor({timeout: 20_000});
  await page.waitForTimeout(SETTLE_MS + 400);
  rec.step('One ledger, many lenses. Every rule that governs your agents.');
  rec.focusAt(720, 360, {w: 1220, h: 620}); // posture hero + top of the ledger (tuned from frames)
  await page.waitForTimeout(VIEW_HOLD_MS);

  const telemetry = rec.finish(VIEWPORT);
  const video = page.video();
  await context.close(); // flushes the webm
  const src = await video.path();

  const destDir = join(ROOT, 'studio', 'public', 'dashclaw');
  mkdirSync(destDir, {recursive: true});
  copyFileSync(src, join(destDir, 'demo.webm'));

  const props = {
    brandId: 'dashclaw',
    video: 'dashclaw/demo.webm',
    cta: 'Govern your agents · dashclaw.io',
    telemetry,
  };
  writeFileSync(join(ROOT, 'props', 'dashclaw-demo.json'), JSON.stringify(props, null, 2) + '\n');
  if (CACHE_ENABLED) storeCache('dashclaw', 'capture', CACHE_KEY, CACHE_ARTIFACTS, {productRepo: DC_ROOT, productHead: keyParts.productHead});
  console.log(`capture OK: ${telemetry.durationMs}ms, ${telemetry.events.length} events`);
  console.log('wrote studio/public/dashclaw/demo.webm and props/dashclaw-demo.json');
} catch (err) {
  console.error(String(err?.message ?? err));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
}
