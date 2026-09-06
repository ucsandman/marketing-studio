#!/usr/bin/env node
// Quality judge #6 — cross-asset brand drift.
//
// Every other judge in this repo scores ONE asset and answers "is this file
// good". This one scores the whole product-owned brand asset directory and answers a question
// none of them can: "do these twenty files look like one brand".
//
// Why a set judge has to exist: drift is invisible per asset. Two hundred
// individually on-palette renders can fragment into three or four visually
// distinct brands, each internally consistent, and a per-file gate — including
// judge-palette, including a human approving one storyboard frame — cannot see
// it. Only a comparison across the set can.
//
// Two signals per asset (scripts/lib/drift.mjs), because they fail apart:
//   tokenShare  ABSOLUTE. Share of colourful pixels sitting on a brand token.
//               Catches an asset that went off-palette even if every sibling
//               went off-palette the same way.
//   driftZ      RELATIVE. Distance from the set centroid in standard deviations.
//               Catches the asset that does not belong with its siblings,
//               whatever the siblings agreed on.
//
// Verdict follows judge-palette's two-condition idiom, for the same reason: a
// captured product screenshot legitimately carries the PRODUCT's colours
// (PLAYBOOK Phase-4 lesson), so a low tokenShare alone is not proof of
// anything. One signal is a WARN. BOTH on the same asset — off the palette AND
// unlike its siblings — is a FAIL.
//
// On thresholds: no published number maps an image distance to "a human would
// call this a different brand". Chromatic (YIQ 0.063), Playwright
// (maxDiffPixelRatio 0.01-0.025), Arize and pHash all answer the same way —
// calibrate against your own labelled data. So driftZ carries NO absolute
// threshold: it is measured against this set's own dispersion, and the report
// always states the basis (n, mean, stdev, trustworthy) so the number is never
// quoted bare. Sets smaller than MIN_SET report distances and no z-scores.
//
// Advisor like the other judges: exit 0; `--strict` exits 1 on a FAIL verdict.
//
// Usage: node scripts/judge-drift.mjs <brand> [--ref <dir>] [--no-video] [--strict] [--json]
//   --ref <dir>   measure against the centroid of a curated known-good directory
//                 instead of the set's own centre. This is how you calibrate:
//                 point it at assets you have approved, and drift becomes
//                 "distance from approved" rather than "distance from average".
//                 Mission Control fills that directory for you: every approve
//                 snapshots the artifact into approved/<YYYY-MM-DD>/ under the brand.
// Output: <product-repo>/marketing/assets/<brand>/marketing/judge-drift.json
//         <product-repo>/marketing/assets/<brand>/marketing/drift-sheet.html
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, extname, relative, basename} from 'node:path';
import {decodePng, hexToRgb} from './lib/png.mjs';
import {describe as describeImage, scoreSet, MIN_SET} from './lib/drift.mjs';
import {projectArg, resolveWorkspace, resolveWorkspacePath} from './lib/workspace.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/** driftZ at or above this = "does not sit with its siblings". 2 sigma is the
 * conventional outlier line; it is a WARN on its own, never a FAIL. */
const Z_WARN = 2;
/** tokenShare below this = "most of this asset's colour is off-palette". */
const TOKEN_SHARE_FLOOR = 0.5;
/** An asset with less colour than this has too little signal to judge on
 * tokenShare — a near-greyscale still is not evidence of drift. */
const COLOUR_FLOOR = 0.02;

const IMAGE_EXT = new Set(['.png']);
const VIDEO_EXT = new Set(['.mp4', '.webm', '.mov']);

// Directories under out/<brand>/ that are this judge's own scratch or output,
// or another tool's temp frames — scoring them would feed the judge its own
// exhaust.
//
// `approved` is here for a sharper reason than scratch: out/<brand>/approved/
// holds COPIES of assets that are already in the set (Mission Control snapshots
// each artifact there on approve). Walking into it would count every approved
// asset twice, pulling the centroid toward the approved subset and shrinking the
// dispersion every z-score is measured in — the calibration reference silently
// contaminating the population it calibrates.
const SKIP_DIRS = new Set(['palette-frames', 'drift-frames', 'approved']);

// Files that live under out/<brand>/ but are TOOLING output rather than brand
// assets. Measured: judge-audio writes a waveform diagnostic PNG next to its
// report, and it scored 11.2 sd from the dashclaw centroid — a correct reading of
// a wrong input, and exactly the kind of false alarm that teaches an operator to
// ignore a gate. mission-control's proof screenshots are the same class. Excluded
// files are LISTED in the report: a set judge whose denominator quietly shrinks
// stops covering things without anyone noticing.
const SKIP_FILE_RE = [
  /^judge-/, // another judge's own diagnostic plot
  /^mc-proof-/, // mission-control proof screenshots
];

// ---- collection --------------------------------------------------------------

export function isToolingArtifact(fileName) {
  return SKIP_FILE_RE.some((re) => re.test(fileName));
}

export function collectAssets(dir, {includeVideo}) {
  const found = [];
  const excluded = [];
  const walk = (d) => {
    for (const e of readdirSync(d, {withFileTypes: true})) {
      if (e.isDirectory()) {
        if (SKIP_DIRS.has(e.name) || e.name === 'node_modules') continue;
        walk(join(d, e.name));
        continue;
      }
      const ext = extname(e.name).toLowerCase();
      const isCandidate = IMAGE_EXT.has(ext) || (includeVideo && VIDEO_EXT.has(ext));
      if (!isCandidate) continue;
      if (isToolingArtifact(e.name)) {
        excluded.push(relToRoot(join(d, e.name)));
        continue;
      }
      found.push({path: join(d, e.name), kind: IMAGE_EXT.has(ext) ? 'image' : 'video'});
    }
  };
  walk(dir);
  found.sort((a, b) => a.path.localeCompare(b.path));
  excluded.sort();
  return {found, excluded};
}

/** Duration in seconds, parsed from ffmpeg's own stderr banner. ffmpeg exits
 * non-zero with no output file, which is the expected path here — the same
 * technique judge-palette uses, so this repo only needs ffmpeg, never ffprobe. */
function videoDurationSec(path) {
  let text = '';
  try {
    execFileSync('ffmpeg', ['-hide_banner', '-i', path], {stdio: 'pipe', encoding: 'utf8'});
  } catch (err) {
    text = `${err.stdout ?? ''}${err.stderr ?? ''}`;
  }
  const m = text.match(/Duration:\s*(\d+):(\d+):(\d+\.\d+)/);
  return m ? Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) : 0;
}

/** One representative frame from the middle of a video, as a decoded PNG. */
function midFrame(path, framesDir, index) {
  const dur = videoDurationSec(path);
  const out = join(framesDir, `v${index}.png`);
  execFileSync(
    'ffmpeg',
    ['-hide_banner', '-loglevel', 'error', '-ss', (dur / 2).toFixed(3), '-i', path,
     '-frames:v', '1', '-update', '1', '-pix_fmt', 'rgb24', '-y', out],
    {stdio: 'pipe'},
  );
  return decodePng(readFileSync(out));
}

function describeAll(assets, tokens, framesDir) {
  const items = [];
  const skipped = [];
  assets.forEach((a, i) => {
    let img;
    try {
      img = a.kind === 'image' ? decodePng(readFileSync(a.path)) : midFrame(a.path, framesDir, i);
    } catch (err) {
      // A file this judge cannot read is reported, never silently dropped: a
      // shrinking denominator is how a set judge quietly stops covering things.
      skipped.push({file: relToRoot(a.path), reason: err.message.split('\n')[0]});
      return;
    }
    const d = describeImage(img, tokens);
    items.push({
      id: relToRoot(a.path),
      kind: a.kind,
      width: img.width,
      height: img.height,
      vector: d.vector,
      tokenShare: d.tokenShare,
      colourfulFraction: d.colourfulFraction,
    });
  });
  return {items, skipped};
}

const relToRoot = (p) => relative(root, p).replaceAll('\\', '/');

/**
 * What the z-scores were measured against, in words. Never omitted: a z-score
 * quoted without its basis is a number with no meaning, and "2.1 sd from the
 * average of whatever happened to be on disk" and "2.1 sd from 14 assets a human
 * approved" are different claims. With --ref the count comes along too, because
 * a reference set of 3 is not a reference set.
 */
export function calibrationBasis(refInfo) {
  return refInfo ? `${refInfo.assets} approved asset(s) in ${refInfo.dir}` : "the set's own centroid";
}

// ---- review page -------------------------------------------------------------

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'})[c]);

/**
 * Worst-first review page.
 *
 * The layout is the finding, not decoration: visual working memory holds 3-4
 * items with accuracy and collapses past ~9, so a flat 20-tile sheet is already
 * past where an unaided eye reliably catches the outlier. Sorting by drift score
 * and putting the top offenders in their own band means the reviewer's attention
 * lands on the two or three tiles that might actually be wrong, instead of
 * scanning the whole set unaided.
 */
const ATTENTION_BAND = 6;

function writeSheet(sheetDir, brand, report) {
  const sheetPath = join(sheetDir, 'drift-sheet.html');
  const cell = (a) => {
    const src = relative(sheetDir, join(root, a.id)).replaceAll('\\', '/');
    const z = a.driftZ === null ? 'n/a' : a.driftZ.toFixed(2);
    const ts = a.tokenShare === null ? 'n/a' : `${(a.tokenShare * 100).toFixed(0)}%`;
    const cls = a.level === 'FAIL' ? 'fail' : a.level === 'WARN' ? 'warn' : 'ok';
    return `      <figure class="${cls}">
        <img src="${escapeHtml(src)}" alt="${escapeHtml(a.id)}" loading="lazy">
        <figcaption>
          <span class="name" title="${escapeHtml(a.id)}">${escapeHtml(basename(a.id))}</span>
          <span class="nums"><b>z</b> ${z} &nbsp; <b>tok</b> ${ts}</span>
        </figcaption>
      </figure>`;
  };
  const attention = report.assets.slice(0, ATTENTION_BAND);
  const rest = report.assets.slice(ATTENTION_BAND);
  const basis = report.calibration.trustworthy
    ? `${report.calibration.basis} — n=${report.calibration.n}, mean ${report.calibration.mean.toFixed(4)}, sd ${report.calibration.stdev.toFixed(4)}`
    : `${report.calibration.basis} — n=${report.calibration.n}, below the ${MIN_SET}-asset floor or zero dispersion, so no z-scores were computed`;

  const html = `<!doctype html>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Drift sheet — ${escapeHtml(brand)}</title>
<style>
  :root{color-scheme:dark;--bg:#0d0f12;--card:#14171b;--line:#262b31;--ink:#e6e8eb;--dim:#8a929b;
        --ok:#3fd08c;--warn:#e0a552;--fail:#eb4b4b;}
  *{box-sizing:border-box;}
  body{margin:0;background:var(--bg);color:var(--ink);
       font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;}
  header{padding:20px 24px;border-bottom:1px solid var(--line);}
  header h1{margin:0;font-size:16px;font-weight:650;}
  header .sub{color:var(--dim);font-size:13px;margin-top:4px;}
  header .verdict{display:inline-block;margin-left:8px;padding:1px 8px;border-radius:3px;
                  font-size:12px;font-weight:700;letter-spacing:.04em;}
  .v-PASS{background:rgba(63,208,140,.15);color:var(--ok);}
  .v-FAIL{background:rgba(235,75,75,.15);color:var(--fail);}
  h2{margin:0;padding:20px 24px 0;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:var(--dim);}
  h2 .hint{text-transform:none;letter-spacing:0;color:#5f6672;font-weight:400;}
  /* The attention band is capped at 3 across so its tiles stay big enough to
     actually JUDGE from — drift is not visible in a 260px thumbnail, and this
     page exists to be judged from, not skimmed. The overflow grid below it can
     be dense, because it is a reference list rather than a review surface. */
  .grid{display:grid;gap:16px;padding:16px 24px 24px;max-width:1600px;
        grid-template-columns:repeat(auto-fill,minmax(min(100%,340px),1fr));}
  .grid.attention{grid-template-columns:repeat(auto-fit,minmax(min(100%,320px),1fr));max-width:1180px;}
  details .grid{grid-template-columns:repeat(auto-fill,minmax(min(100%,210px),1fr));}
  figure{margin:0;background:var(--card);border:1px solid var(--line);border-radius:10px;overflow:hidden;}
  figure.warn{border-color:var(--warn);}
  figure.fail{border-color:var(--fail);box-shadow:0 0 0 1px var(--fail);}
  figure img{display:block;width:100%;height:auto;background:#0a0c0e;}
  figcaption{display:flex;justify-content:space-between;gap:8px;align-items:baseline;
             padding:8px 12px;font-size:12px;border-top:1px solid #21262c;}
  .name{font-weight:600;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}
  .nums{color:#7fb2ff;font-variant-numeric:tabular-nums;white-space:nowrap;}
  .nums b{color:var(--dim);font-weight:600;}
  details{margin:0 24px 32px;}
  summary{cursor:pointer;color:var(--dim);font-size:13px;padding:8px 0;}
  .legend{padding:0 24px 32px;color:var(--dim);font-size:13px;max-width:74ch;line-height:1.65;}
  .legend code{color:var(--ink);}
</style>
<header>
  <h1>Drift sheet &middot; ${escapeHtml(brand)}<span class="verdict v-${report.verdict}">${report.verdict}</span></h1>
  <div class="sub">${report.assets.length} asset(s) scored as a set &middot; cohesion basis: ${escapeHtml(basis)}</div>
</header>

<h2>Needs attention <span class="hint">— sorted worst first; a reviewer's eye is reliable over about ${ATTENTION_BAND} tiles, not twenty</span></h2>
<main class="grid attention">
${attention.map(cell).join('\n')}
</main>

${rest.length ? `<details>
  <summary>${rest.length} more, in drift order</summary>
  <div class="grid">
${rest.map(cell).join('\n')}
  </div>
</details>` : ''}

<p class="legend">
  <code>z</code> is distance from the set centroid in standard deviations — a RELATIVE
  measure with no absolute threshold, because no published number maps an image
  distance to "a human would call this a different brand". <code>tok</code> is the share of
  colourful pixels sitting on a brand token: an ABSOLUTE measure. Either one alone is a
  WARN. Both on the same asset is a FAIL, because a captured product screenshot
  legitimately carries the product's own colours and low <code>tok</code> by itself proves nothing.
  Calibrate by pointing <code>--ref &lt;dir&gt;</code> at assets you have already approved.
</p>
`;
  writeFileSync(sheetPath, html);
  return sheetPath;
}

// ---- main --------------------------------------------------------------------

function main() {
  const argv = process.argv.slice(2);
  const strict = argv.includes('--strict');
  const asJson = argv.includes('--json');
  const includeVideo = !argv.includes('--no-video');
  const refIdx = argv.indexOf('--ref');
  const refDir = refIdx >= 0 ? argv[refIdx + 1] : null;
  const brand = argv.find((a, i) => !a.startsWith('--') && argv[i - 1] !== '--ref' && argv[i - 1] !== '--project');

  if (!brand) {
    console.error('usage: node scripts/judge-drift.mjs <brand> --project <product-repo> [--ref <dir>] [--no-video] [--strict] [--json]');
    process.exit(1);
  }
  let ws;
  try {
    ws = resolveWorkspace(root, {brand, project: projectArg(argv)});
  } catch (err) {
    console.error(`judge-drift: ${err.message}`);
    process.exit(1);
  }

  const brandPath = join(root, 'brands', `${brand}.json`);
  if (!existsSync(brandPath)) {
    console.error(`judge-drift: missing ${brandPath}`);
    process.exit(1);
  }
  const brandDef = JSON.parse(readFileSync(brandPath, 'utf8'));
  const tokens = Object.values(brandDef.colors).map(hexToRgb);

  const assetRoot = ws.brandOut;
  if (!existsSync(assetRoot)) {
    console.error(`judge-drift: no rendered assets at ${assetRoot} — render something first.`);
    process.exit(1);
  }

  const framesDir = join(ws.marketingDir, 'drift-frames');
  rmSync(framesDir, {recursive: true, force: true});
  mkdirSync(framesDir, {recursive: true});

  const {found: assets, excluded} = collectAssets(assetRoot, {includeVideo});
  if (assets.length === 0) {
    console.error(`judge-drift: found no scoreable assets under ${assetRoot}`);
    process.exit(1);
  }
  const {items, skipped} = describeAll(assets, tokens, framesDir);
  if (items.length === 0) {
    console.error(`judge-drift: every candidate under ${assetRoot} failed to decode`);
    process.exit(1);
  }

  // Optional curated reference centroid — the calibration mechanism.
  let refCentroid = null;
  let refInfo = null;
  if (refDir) {
    let rd;
    try {
      rd = resolveWorkspacePath(ws, refDir);
    } catch (err) {
      console.error(`judge-drift: ${err.message}`);
      process.exit(1);
    }
    if (!existsSync(rd)) {
      console.error(`judge-drift: --ref directory not found: ${refDir}`);
      process.exit(1);
    }
    const {found: refAssets} = collectAssets(rd, {includeVideo});
    const {items: refItems} = describeAll(refAssets, tokens, framesDir);
    if (refItems.length === 0) {
      console.error(`judge-drift: --ref directory has no scoreable assets: ${refDir}`);
      process.exit(1);
    }
    const {centroid: c} = scoreSet(refItems);
    refCentroid = c;
    refInfo = {dir: relToRoot(rd), assets: refItems.length};
  }

  const {mean, stdev, n, trustworthy, scored} = scoreSet(items, refCentroid);

  const assetsOut = scored.map((a) => {
    const judgeable = a.tokenShare !== null && a.colourfulFraction >= COLOUR_FLOOR;
    const offPalette = judgeable && a.tokenShare < TOKEN_SHARE_FLOOR;
    const unlikeSiblings = a.driftZ !== null && a.driftZ >= Z_WARN;
    const level = offPalette && unlikeSiblings ? 'FAIL' : offPalette || unlikeSiblings ? 'WARN' : 'PASS';
    return {
      id: a.id,
      kind: a.kind,
      dimensions: `${a.width}x${a.height}`,
      tokenShare: a.tokenShare === null ? null : Number(a.tokenShare.toFixed(3)),
      colourfulFraction: Number(a.colourfulFraction.toFixed(3)),
      distance: Number(a.distance.toFixed(5)),
      driftZ: a.driftZ === null ? null : Number(a.driftZ.toFixed(2)),
      offPalette,
      unlikeSiblings,
      level,
    };
  });

  const findings = assetsOut
    .filter((a) => a.level !== 'PASS')
    .map((a) => ({
      check: a.offPalette && a.unlikeSiblings ? 'brand-drift' : a.offPalette ? 'off-palette' : 'set-outlier',
      level: a.level,
      file: a.id,
      driftZ: a.driftZ,
      tokenShare: a.tokenShare,
      message:
        a.offPalette && a.unlikeSiblings
          ? `Only ${(a.tokenShare * 100).toFixed(0)}% of this asset's colour sits on a brand token AND it is ${a.driftZ.toFixed(1)} sd from the set centroid — off the palette and unlike its siblings.`
          : a.offPalette
            ? `Only ${(a.tokenShare * 100).toFixed(0)}% of colourful pixels sit on a brand token (floor ${TOKEN_SHARE_FLOOR * 100}%). If this is captured product UI that is expected; if it is a rendered comp it is off palette.`
            : `${a.driftZ.toFixed(1)} sd from the set centroid: this asset does not sit with its siblings. Compare it against the others on the drift sheet before shipping the set.`,
    }));

  const verdict = findings.some((f) => f.level === 'FAIL') ? 'FAIL' : 'PASS';
  const report = {
    judge: 'drift',
    brand,
    generatedAt: new Date().toISOString(),
    verdict,
    input: {assetRoot: relToRoot(assetRoot), scored: items.length, includeVideo, skipped, excluded},
    reference: refInfo,
    calibration: {
      n,
      mean: Number(mean.toFixed(5)),
      stdev: Number(stdev.toFixed(5)),
      trustworthy: Boolean(trustworthy),
      basis: calibrationBasis(refInfo),
      note: trustworthy
        ? null
        : `dispersion not meaningful (n < ${MIN_SET} or stdev 0); distances reported, z-scores withheld`,
    },
    thresholds: {Z_WARN, TOKEN_SHARE_FLOOR, COLOUR_FLOOR},
    assets: assetsOut,
    findings,
  };

  const outDir = ws.marketingDir;
  mkdirSync(outDir, {recursive: true});
  writeFileSync(join(outDir, 'judge-drift.json'), JSON.stringify(report, null, 2));
  const sheetPath = writeSheet(outDir, brand, report);
  rmSync(framesDir, {recursive: true, force: true});

  if (asJson) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(
      `judge-drift [${brand}]: ${verdict} — ${items.length} asset(s) as a set, ` +
        `basis: ${report.calibration.basis}, ` +
        `cohesion mean ${mean.toFixed(4)} sd ${stdev.toFixed(4)}${trustworthy ? '' : ' (dispersion not meaningful)'}`,
    );
    for (const f of findings) console.log(`  [${f.level}] ${f.check} ${f.file}: ${f.message}`);
    if (findings.length === 0) console.log('  no drift findings — the set reads as one brand');
    for (const s of skipped) console.log(`  [SKIP] ${s.file}: ${s.reason}`);
    if (excluded.length) console.log(`  excluded ${excluded.length} tooling artifact(s) (judge diagnostics / proof screenshots), not brand assets`);
    console.log(`  report -> ${join(outDir, 'judge-drift.json')}`);
    console.log(`  sheet  -> ${relToRoot(sheetPath)}`);
  }

  process.exit(strict && verdict === 'FAIL' ? 1 : 0);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) main();
