#!/usr/bin/env node
// Quality judge #2 — demo pacing / dead-air detector.
//
// Two checks over a product demo:
//   A. telemetry-only: any span between click/focus events longer than
//      DWELL_MS with no activity is a dwell WARNING (advisory).
//   B. frame-diff: inside each zoom hold, extract frames 1s apart (via
//      `npx remotion ffmpeg`, PLAYBOOK extraction pattern), decode with the
//      repo's pure-node PNG decoder, and measure the mean absolute pixel delta
//      between consecutive frames. Near-zero delta across a whole hold = the
//      picture is frozen = dead-air FAIL.
//
// If studio/public/<brand>/demo.webm is absent, only check A runs and the
// report says so. Advisor to the Phase-4 judge: exit 0; `--strict` exits 1 on a
// FAIL verdict.
//
// Usage: node scripts/judge-demo-pacing.mjs <brand> [--strict] [--json]
// Output: <product-repo>/marketing/assets/<brand>/marketing/judge-demo-pacing.json
import {existsSync, mkdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {decodePng, meanAbsDelta} from './lib/png.mjs';
import {ffmpeg} from './lib/remotion.mjs';
import {projectArg, resolveWorkspace} from './lib/workspace.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const DWELL_MS = 3500; // check A: activity gap over this = dwell warning
const SAMPLE_MS = 1000; // check B: frame sampling interval inside a hold
const MAX_SAMPLES = 6; // cap extracts per hold to bound cost
// demo.webm is the RAW capture; the Remotion camera zoom is layered on at RENDER
// time, not baked into the file. So a calm-but-live hold (the app UI just sitting
// there while the caption is read) still shows real, small pixel change from
// cursor/compression/subtle UI motion (deltas ~0.1-1.0 per channel on 0-255).
// True dead air is a BROKEN capture that recorded literally identical frames
// (delta ~= 0). Hence "near-zero" is genuinely near-zero: a hold only FAILs when
// EVERY sampled pair is below this floor. Setting it looser cries wolf on live
// footage (the whole point is to catch a frozen capture, not a quiet screen).
const DEAD_DELTA = 0.2; // mean per-channel abs delta below this on EVERY pair = frozen
const EDGE_MARGIN_MS = 200; // keep samples off the exact hold boundary

// Check A: gaps in the click/focus activity timeline (including the 0..first and
// last..end boundaries) that exceed DWELL_MS.
export function computeDwells(events, durationMs, dwellMs = DWELL_MS) {
  const activity = events
    .filter((e) => e.type === 'click' || e.type === 'focus')
    .map((e) => e.t)
    .sort((a, b) => a - b);
  const marks = [0, ...activity, durationMs];
  const findings = [];
  for (let i = 1; i < marks.length; i++) {
    const gap = marks[i] - marks[i - 1];
    if (gap > dwellMs) {
      findings.push({
        check: 'dwell',
        level: 'WARN',
        fromMs: marks[i - 1],
        toMs: marks[i],
        gapMs: gap,
        message: `No click/focus for ${gap}ms (${marks[i - 1]}ms -> ${marks[i]}ms); confirm something moves on screen.`,
      });
    }
  }
  return findings;
}

// Zoom holds: each focus event holds until the next click/focus event (or end).
export function computeHolds(events, durationMs) {
  const sorted = [...events].sort((a, b) => a.t - b.t);
  const holds = [];
  for (let i = 0; i < sorted.length; i++) {
    if (sorted[i].type !== 'focus') continue;
    const start = sorted[i].t;
    let end = durationMs;
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j].type === 'click' || sorted[j].type === 'focus') {
        end = sorted[j].t;
        break;
      }
    }
    if (end - start >= SAMPLE_MS) holds.push({start, end});
  }
  return holds;
}

function sampleTimes(hold) {
  const times = [];
  for (let t = hold.start; t <= hold.end - EDGE_MARGIN_MS && times.length < MAX_SAMPLES; t += SAMPLE_MS) {
    times.push(t);
  }
  if (times.length < 2) times.push(hold.end - EDGE_MARGIN_MS);
  return times;
}

function extractFrame(webm, ms, outPath) {
  // Accurate seek (-ss after -i decodes to the exact time) so consecutive
  // samples inside a hold are truly different frames, not the same keyframe.
  ffmpeg(['-i', webm, '-ss', (ms / 1000).toFixed(3), '-frames:v', '1', '-update', '1', '-pix_fmt', 'rgb24', outPath, '-y'], {
    quiet: true,
  });
}

async function main() {
  const argv = process.argv.slice(2);
  const strict = argv.includes('--strict');
  const asJson = argv.includes('--json');
  const brand = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--project');
  if (!brand) {
    console.error('usage: node scripts/judge-demo-pacing.mjs <brand> --project <product-repo> [--strict] [--json]');
    process.exit(1);
  }
  let ws;
  try {
    ws = resolveWorkspace(root, {brand, project: projectArg(argv)});
  } catch (err) {
    console.error(`judge-demo-pacing: ${err.message}`);
    process.exit(1);
  }

  const demoPath = join(ws.propsDir, `${brand}-demo.json`);
  if (!existsSync(demoPath)) {
    console.error(`judge-demo-pacing: missing ${demoPath}`);
    process.exit(1);
  }
  const demo = JSON.parse(readFileSync(demoPath, 'utf8'));
  const telemetry = demo.telemetry ?? {};
  const events = Array.isArray(telemetry.events) ? telemetry.events : [];
  const durationMs = telemetry.durationMs ?? 0;

  const findings = [...computeDwells(events, durationMs)];

  const webm = join(ws.publicDir, 'demo.webm');
  const webmPresent = existsSync(webm);
  const holdReports = [];

  if (webmPresent) {
    const framesDir = join(ws.marketingDir, 'pacing-frames');
    rmSync(framesDir, {recursive: true, force: true});
    mkdirSync(framesDir, {recursive: true});
    const holds = computeHolds(events, durationMs);
    holds.forEach((hold, hi) => {
      const times = sampleTimes(hold);
      const imgs = [];
      times.forEach((t, ti) => {
        const p = join(framesDir, `hold${hi}-${ti}-${t}ms.png`);
        extractFrame(webm, t, p);
        if (!existsSync(p)) throw new Error(`frame extract failed: ${p}`);
        imgs.push(decodePng(readFileSync(p)));
      });
      const deltas = [];
      for (let i = 1; i < imgs.length; i++) deltas.push(Number(meanAbsDelta(imgs[i - 1], imgs[i]).toFixed(3)));
      const maxDelta = deltas.length ? Math.max(...deltas) : 0;
      const dead = deltas.length > 0 && deltas.every((d) => d < DEAD_DELTA);
      holdReports.push({holdIndex: hi, startMs: hold.start, endMs: hold.end, sampleTimesMs: times, deltas, maxDelta});
      if (dead) {
        findings.push({
          check: 'dead-air',
          level: 'FAIL',
          holdIndex: hi,
          startMs: hold.start,
          endMs: hold.end,
          maxDelta,
          message: `Zoom hold ${hold.start}ms -> ${hold.end}ms is frozen (max frame delta ${maxDelta} < ${DEAD_DELTA}); nothing moves.`,
        });
      }
    });
  }

  const verdict = findings.some((f) => f.level === 'FAIL') ? 'FAIL' : 'PASS';
  const report = {
    judge: 'demo-pacing',
    brand,
    generatedAt: new Date().toISOString(),
    verdict,
    checks: {
      telemetry: true,
      frameDiff: webmPresent,
    },
    note: webmPresent
      ? undefined
      : `studio/public/${brand}/demo.webm absent — check A (telemetry) only.`,
    summary: {
      durationMs,
      activityEvents: events.filter((e) => e.type === 'click' || e.type === 'focus').length,
      holds: holdReports.length,
      dwellWarnings: findings.filter((f) => f.check === 'dwell').length,
      deadAirFails: findings.filter((f) => f.check === 'dead-air').length,
    },
    holds: holdReports,
    findings,
  };

  const outDir = ws.marketingDir;
  mkdirSync(outDir, {recursive: true});
  const outPath = join(outDir, 'judge-demo-pacing.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`judge-demo-pacing [${brand}]: ${verdict} (checks: telemetry${webmPresent ? '+frame-diff' : ' only'})`);
    for (const h of holdReports) {
      console.log(`  hold ${h.startMs}-${h.endMs}ms deltas=[${h.deltas.join(', ')}] max=${h.maxDelta}`);
    }
    for (const f of findings) console.log(`  [${f.level}] ${f.check}: ${f.message}`);
    console.log(`  report -> ${outPath}`);
  }

  process.exit(strict && verdict === 'FAIL' ? 1 : 0);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
