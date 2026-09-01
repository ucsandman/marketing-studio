#!/usr/bin/env node
// Quality judge #3 — brand-palette compliance.
//
// Samples frames from a rendered still or video, quantizes to a coarse color
// grid (shared scripts/lib/png.mjs), and flags dominant colors that are BOTH
// (a) close to a color the brand's voice FORBIDS (parsed from the "never <color>"
//     rules in brands/<brand>.json voice — e.g. noban: "profit is gold, never
//     green") AND
// (b) far from every brand token (so a legitimate on-brand green like noban's
//     `safe` token is NOT flagged — it sits right on a token).
//
// False-positive guard (PLAYBOOK Phase-4 lesson: product screenshots inside a
// frame carry the PRODUCT's own colors): pass --mask-region x,y,w,h to skip a
// screenshot region, and every finding is classified 'high' confidence (a
// full-frame wash) => FAIL, or 'low' (a small region, likely product UI) => WARN.
//
// Advisor to the Phase-4 judge: exit 0; `--strict` exits 1 on a FAIL verdict.
//
// Usage: node scripts/judge-palette.mjs <brand> <video-or-png> [--frames N] [--mask-region x,y,w,h] [--strict] [--json]
// Output: out/<brand>/marketing/judge-palette.json
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync, rmSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, extname, resolve} from 'node:path';
import {decodePng, quantize, rgbToHsv, hexToRgb, colorDistance} from './lib/png.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const studio = join(root, 'studio');

const SAT_THRESHOLD = 0.35; // ignore washed-out/near-gray pixels
const MIN_VALUE = 0.15; // ignore near-black pixels
const DIST_THRESHOLD = 90; // RGB euclidean: "far from every brand token"
const FRACTION_FLOOR = 0.02; // ignore trace buckets
const HIGH_FRAC = 0.25; // forbidden coverage over this = full-frame wash = FAIL
const BUCKET = 32;

// Basic color-name -> hue range(s) map for parsing brand color rules.
const HUE_RANGES = {
  red: [[0, 15], [345, 360]],
  orange: [[15, 45]],
  yellow: [[45, 70]],
  gold: [[40, 60]],
  green: [[70, 165]],
  cyan: [[165, 195]],
  blue: [[195, 255]],
  purple: [[255, 290]],
  violet: [[255, 290]],
  magenta: [[290, 345]],
  pink: [[290, 345]],
};

// Parse "never <color>" rules out of a brand voice string.
export function parseForbiddenColors(voice) {
  const found = new Set();
  const re = /never\s+([a-z]+)/gi;
  let m;
  while ((m = re.exec(voice)) !== null) {
    const name = m[1].toLowerCase();
    if (HUE_RANGES[name]) found.add(name);
  }
  return [...found];
}

function forbiddenRangesFor(colors) {
  return colors.flatMap((c) => HUE_RANGES[c] || []);
}

function inRanges(hue, ranges) {
  return ranges.some(([lo, hi]) => hue >= lo && hue < hi);
}

// Analyze one decoded frame. Returns the aggregate forbidden coverage and the
// single largest offending bucket (or null).
export function analyzeFrame(img, {tokens, forbiddenRanges, mask}) {
  const {buckets} = quantize(img, {bucket: BUCKET, mask});
  let forbiddenFraction = 0;
  let offending = null;
  for (const b of buckets) {
    if (b.fraction < FRACTION_FLOOR) break; // sorted desc; nothing smaller matters
    const {h, s, v} = rgbToHsv(b.r, b.g, b.b);
    if (s < SAT_THRESHOLD || v < MIN_VALUE) continue;
    if (!inRanges(h, forbiddenRanges)) continue;
    const minDist = Math.min(...tokens.map((t) => colorDistance(b, t)));
    if (minDist <= DIST_THRESHOLD) continue; // close to a real brand token -> allowed
    forbiddenFraction += b.fraction;
    if (!offending || b.fraction > offending.fraction) {
      offending = {r: b.r, g: b.g, b: b.b, hue: Math.round(h), sat: Number(s.toFixed(2)), fraction: b.fraction, minDistToToken: Math.round(minDist)};
    }
  }
  return {forbiddenFraction, offending};
}

// ---- frame sources ----------------------------------------------------------

function extractVideoFrames(videoPath, n) {
  // Parse duration from ffmpeg's stderr (it prints "Duration: HH:MM:SS.ss").
  let durSec = 0;
  try {
    execFileSync('npx', ['remotion', 'ffmpeg', '-hide_banner', '-i', videoPath], {
      cwd: studio,
      stdio: 'pipe',
      shell: process.platform === 'win32',
    });
  } catch (err) {
    const stderr = (err.stderr || '').toString();
    const m = stderr.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
    if (m) durSec = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]);
  }
  if (!durSec) throw new Error(`judge-palette: could not read duration of ${videoPath}`);
  const framesDir = join(root, 'out', 'palette-frames');
  rmSync(framesDir, {recursive: true, force: true});
  mkdirSync(framesDir, {recursive: true});
  const imgs = [];
  for (let i = 0; i < n; i++) {
    const t = (durSec * (i + 0.5)) / n; // evenly spaced, avoid the exact 0/end
    const p = join(framesDir, `f${i}.png`);
    execFileSync(
      'npx',
      ['remotion', 'ffmpeg', '-i', videoPath, '-ss', t.toFixed(3), '-frames:v', '1', '-update', '1', '-pix_fmt', 'rgb24', p, '-y'],
      {cwd: studio, stdio: 'pipe', shell: process.platform === 'win32'},
    );
    imgs.push({timeMs: Math.round(t * 1000), img: decodePng(readFileSync(p))});
  }
  return imgs;
}

function main() {
  const argv = process.argv.slice(2);
  const strict = argv.includes('--strict');
  const asJson = argv.includes('--json');
  const framesIdx = argv.indexOf('--frames');
  const frames = framesIdx >= 0 ? Math.max(1, parseInt(argv[framesIdx + 1], 10)) : 5;
  const maskIdx = argv.indexOf('--mask-region');
  let mask = null;
  if (maskIdx >= 0) {
    const [x, y, w, h] = argv[maskIdx + 1].split(',').map((v) => parseInt(v, 10));
    if ([x, y, w, h].some((v) => Number.isNaN(v))) {
      console.error('judge-palette: --mask-region expects x,y,w,h integers');
      process.exit(1);
    }
    mask = {x, y, w, h};
  }
  const positional = argv.filter((a, i) => {
    if (a.startsWith('--')) return false;
    const prev = argv[i - 1];
    return prev !== '--frames' && prev !== '--mask-region';
  });
  const [brand, input] = positional;
  if (!brand || !input) {
    console.error('usage: node scripts/judge-palette.mjs <brand> <video-or-png> [--frames N] [--mask-region x,y,w,h] [--strict] [--json]');
    process.exit(1);
  }

  const brandPath = join(root, 'brands', `${brand}.json`);
  if (!existsSync(brandPath)) {
    console.error(`judge-palette: missing ${brandPath}`);
    process.exit(1);
  }
  const brandDef = JSON.parse(readFileSync(brandPath, 'utf8'));
  const tokens = Object.values(brandDef.colors).map(hexToRgb);
  const forbiddenColors = parseForbiddenColors(brandDef.voice || '');
  const forbiddenRanges = forbiddenRangesFor(forbiddenColors);

  // Absolute either way: extractVideoFrames shells out to ffmpeg with cwd=studio, so
  // a cwd-relative path that exists here (the documented "run from the repo root"
  // case) would resolve against studio/ and fail to open.
  const inputPath = existsSync(input) ? resolve(input) : join(root, input);
  if (!existsSync(inputPath)) {
    console.error(`judge-palette: input not found: ${input}`);
    process.exit(1);
  }

  const ext = extname(inputPath).toLowerCase();
  const isPng = ext === '.png';
  const frameImgs = isPng
    ? [{timeMs: null, img: decodePng(readFileSync(inputPath))}]
    : extractVideoFrames(inputPath, frames);

  const frameReports = frameImgs.map((fi, index) => {
    const {forbiddenFraction, offending} = analyzeFrame(fi.img, {tokens, forbiddenRanges, mask});
    let confidence = null;
    let level = 'PASS';
    if (forbiddenFraction > 0) {
      confidence = forbiddenFraction >= HIGH_FRAC ? 'high' : 'low';
      level = confidence === 'high' ? 'FAIL' : 'WARN';
    }
    return {index, timeMs: fi.timeMs, forbiddenFraction: Number(forbiddenFraction.toFixed(3)), offending, confidence, level};
  });

  const findings = frameReports
    .filter((f) => f.level !== 'PASS')
    .map((f) => ({
      check: 'forbidden-color',
      level: f.level,
      frame: f.index,
      confidence: f.confidence,
      forbiddenFraction: f.forbiddenFraction,
      offending: f.offending,
      message:
        f.confidence === 'high'
          ? `Frame ${f.index}: forbidden ${forbiddenColors.join('/')} washes ${(f.forbiddenFraction * 100).toFixed(0)}% of the frame (rgb ${f.offending.r},${f.offending.g},${f.offending.b}, hue ${f.offending.hue}), far from every brand token.`
          : `Frame ${f.index}: a small forbidden-${forbiddenColors.join('/')} region (${(f.forbiddenFraction * 100).toFixed(0)}%, rgb ${f.offending.r},${f.offending.g},${f.offending.b}) — likely product UI; masking may be warranted.`,
    }));

  const verdict = findings.some((f) => f.level === 'FAIL') ? 'FAIL' : 'PASS';
  const report = {
    judge: 'palette',
    brand,
    generatedAt: new Date().toISOString(),
    verdict,
    input: {path: input, type: isPng ? 'png' : 'video', frames: frameImgs.length, mask},
    forbidden: {colors: forbiddenColors, hueRanges: forbiddenRanges},
    thresholds: {SAT_THRESHOLD, MIN_VALUE, DIST_THRESHOLD, HIGH_FRAC},
    frames: frameReports,
    findings,
  };

  const outDir = join(root, 'out', brand, 'marketing');
  mkdirSync(outDir, {recursive: true});
  const outPath = join(outDir, 'judge-palette.json');
  writeFileSync(outPath, JSON.stringify(report, null, 2));

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `judge-palette [${brand}]: ${verdict} — ${forbiddenColors.length} forbidden-color rule(s) parsed from voice [${forbiddenColors.join(', ') || 'none'}]; ${findings.length} violation(s) checked across ${frameImgs.length} frame(s)`,
    );
    for (const f of findings) console.log(`  [${f.level}] ${f.check}: ${f.message}`);
    if (findings.length === 0) console.log('  no forbidden-color findings');
    console.log(`  report -> out/${brand}/marketing/judge-palette.json`);
  }

  process.exit(strict && verdict === 'FAIL' ? 1 : 0);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
