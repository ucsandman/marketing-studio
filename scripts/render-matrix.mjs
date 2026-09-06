// Responsive export matrix: fan one picture-locked composition into every social
// aspect (16:9 / 1:1 / 4:5 / 9:16) by RESPONSIVE LAYOUT, not crops. The installed
// Remotion (4.0.486) has no --width/--height CLI flags, so dimensions are overridden
// via optional {formatWidth, formatHeight} props that LaunchVideo/SocialClip's
// calculateMetadata reads (Root.tsx); we merge them into a temp props file per
// platform and pass --props.
//
// Usage: node scripts/render-matrix.mjs <brand> [--comp LaunchVideo|SocialClip|WrapClip]
//          [--only <platformId>] [--props <path>] [--stills-only] [--webm] [--production] [--verify-production]
//   --stills-only   render a single text-bearing still per platform (layout proof,
//                   no CPU for full video). Otherwise renders full .mp4 per platform.
//   --only <id>     render just the one platform row matching scripts/platforms.json's
//                   `id` (e.g. social-1x1) — cheap smoke-test path, combinable with --comp.
//   --props <path>  override the per-comp base props file (see the --props note below).
//   --webm          additionally transcode each rendered mp4 to VP9/Opus webm
//                   (skipped with a log line, never a failure, if the bundled ffmpeg
//                   lacks libvpx-vp9/libopus — probed once via `remotion ffmpeg -encoders`).
//   --production    require an explicit production-plan.json source route and run
//                   judge-production --strict on every final matrix row.
//   --verify-production  with --production, re-run only the strict evidence gate
//                   for existing matrix media; never re-render a review-pending file.
//
// Outputs land in out/<brand>/matrix/<id>.mp4 (or .png for stills; plus <id>.webm when
// --webm is supported). Every rendered mp4 is remuxed in place for faststart (moov atom
// moved to the front) via a temp-file-then-rename swap so partial writes never clobber
// the original. If out/<brand>/marketing/run.json exists, an `exports` array is
// appended/updated with {id, path, width, height, bytes} per rendered file (atomic
// temp+rename, bytes reflect the post-faststart size); when no run.json exists the
// manifest step is silently skipped.
//
// Captions: platforms flagged {captioned:true} (the muted-autoplay 9:16/1:1 rows)
// also get an extra <id>-captioned variant with the VO burned into on-screen
// captions — but only when props/<brand>-audio.json exists (else skipped, one log
// line). LaunchVideo reads caption text from the merged `audio` manifest; SocialClip
// from a merged `voLines` array (it has no audio track). WrapClip is different: its
// captions are already baked into the per-segment props (props/<brand>-wrap-<id>.json's
// `captions` array is always burned by WrapClip.tsx), so wrap-* platform rows never set
// {captioned:true} — there is no on/off toggle to layer on top, and this mechanism's
// LaunchVideo/SocialClip-specific merge (`withCaptions`) doesn't apply to it.
//
// --props <path>: override the per-comp base props file entirely. WrapClip has no
// single canonical base props file (unlike <brand>-launch.json / <brand>-social-*.json)
// — each segment gets its own props/<brand>-wrap-<segmentId>.json from
// build-wrap-props.mjs — so this bypasses matrix-props.mjs's resolveBaseProps and reads
// the given file directly for every matched platform row. When set, outputs nest under
// out/<brand>/matrix/wrap-<segmentId>/ (segmentId parsed off the props filename) instead
// of the flat matrix dir, and the segment id is folded into each rendered id — and the
// run.json manifest key — so re-running the matrix for a different segment of the same
// brand doesn't clobber the previous segment's manifest rows. Wrap rows are gated on
// it: a plain brand-wide run skips them with a log line (they'd otherwise render
// placeholder slates off the social-props fallback), and --comp WrapClip without
// --props is a usage error.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {basename, dirname, join, relative, resolve} from 'node:path';
import {makeBaseLoader, productionHeroFrame, withBoundCaptions, withFormat} from './lib/matrix-props.mjs';
import {matchBudget} from './check-budgets.mjs';
import {evaluateProduction} from './judge-production.mjs';
import {loadProductionBundle} from './lib/production-quality.mjs';
import {projectArg, resolveWorkspace, resolveWorkspacePath} from './lib/workspace.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const studio = join(root, 'studio');
const remotionCli = join(studio, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
const remotion = (args, options = {}) => execFileSync(process.execPath, [remotionCli, ...args], {cwd: studio, ...options});
const REGISTERED_COMPOSITIONS = new Set([
  'ComponentGallery', 'StagedGallery', 'SocialClip', 'ProductDemo', 'LogoReveal',
  'LaunchVideo', 'PostflopFilm', 'DashClawFilm', 'AnimatedOG', 'StoreTile', 'Card',
  'WrapClip', 'AgentSession',
]);

const args = process.argv.slice(2);
const brand = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--project');
const project = projectArg(args);
const stillsOnly = args.includes('--stills-only');
// Headless-Chrome workers per render. Unset = Remotion's core-count default.
const concurrency =
  args.find((a) => a.startsWith('--concurrency='))?.split('=')[1] ||
  process.env.REMOTION_CONCURRENCY ||
  '';
const webmFlag = args.includes('--webm');
const production = args.includes('--production');
const verifyProduction = args.includes('--verify-production');
const compIdx = args.indexOf('--comp');
const compFilter = compIdx >= 0 ? args[compIdx + 1] : null;
const onlyIdx = args.indexOf('--only');
const onlyFilter = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
const propsIdx = args.indexOf('--props');
const propsOverrideArg = propsIdx >= 0 ? args[propsIdx + 1] : null;

if (!brand) {
  console.error('usage: node scripts/render-matrix.mjs <brand> [--comp LaunchVideo|SocialClip|WrapClip] [--only <id>] [--props <path>] [--stills-only] [--webm] [--production]');
  process.exit(1);
}
const workspace = resolveWorkspace(root, {brand, project});
const portable = (path) => relative(workspace.projectRoot, path).replaceAll('\\', '/');
if (!existsSync(workspace.projectRoot) || !statSync(workspace.projectRoot).isDirectory()) {
  console.error(`matrix: --project must name an existing product repository: ${workspace.projectRoot}`);
  process.exit(1);
}

if (verifyProduction && !production) {
  console.error('matrix: --verify-production requires --production');
  process.exit(1);
}
if (verifyProduction && stillsOnly) {
  console.error('matrix: --verify-production requires video rows, not --stills-only layout proofs');
  process.exit(1);
}
const productionDelivery = production && !stillsOnly;

// WrapClip has no canonical base props file for resolveBaseProps to fall back on
// (each segment gets its own from build-wrap-props.mjs), so asking for it without
// --props could only render a meaningless placeholder slate — fail loudly instead.
if (compFilter === 'WrapClip' && !propsOverrideArg) {
  console.error('--comp WrapClip requires --props props/<brand>-wrap-<segmentId>.json (emitted by scripts/build-wrap-props.mjs) — WrapClip has no canonical base props file');
  process.exit(1);
}

// The converse guard: --props is wrap-only. Without --comp WrapClip it would feed
// wrap props to launch/social rows (zod strips the unknown keys, so they render
// wrong-basis junk into the segment dir and register bogus run.json rows).
if (propsOverrideArg && compFilter !== 'WrapClip') {
  console.error('--props is only valid with --comp WrapClip — launch/social rows read their canonical props files');
  process.exit(1);
}

const platforms = JSON.parse(readFileSync(join(root, 'scripts', 'platforms.json'), 'utf8'));
if (compFilter && !REGISTERED_COMPOSITIONS.has(compFilter)) {
  console.error(`matrix: unknown composition ${JSON.stringify(compFilter)}`);
  process.exit(1);
}

const sha256File = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');
const productionPlanPath = join(workspace.marketingDir, 'production-plan.json');
let productionPlan = null;
let productionShotPlan = null;
if (production) {
  if (!existsSync(productionPlanPath)) {
    console.error(`matrix: --production requires ${portable(productionPlanPath)} (the directed source route)`);
    process.exit(1);
  }
  try {
    productionPlan = JSON.parse(readFileSync(productionPlanPath, 'utf8'));
  } catch (error) {
    console.error(`matrix: invalid production plan: ${error.message}`);
    process.exit(1);
  }
  if (productionPlan?.version !== 1 || typeof productionPlan.selectedComposition !== 'string' || !productionPlan.exports) {
    console.error('matrix: production-plan.json must provide version: 1, selectedComposition, and explicit exports routes');
    process.exit(1);
  }
  for (const key of ['direction', 'shotPlan']) {
    const ref = productionPlan[key]?.path;
    const path = typeof ref === 'string' ? resolveWorkspacePath(workspace, ref) : null;
    if (!path || !existsSync(path)) {
      console.error(`matrix: production plan ${key}.path must reference an existing product artifact`);
      process.exit(1);
    }
  }
  productionShotPlan = JSON.parse(readFileSync(resolveWorkspacePath(workspace, productionPlan.shotPlan.path), 'utf8'));
  for (const family of ['launch', 'social']) {
    const route = productionPlan.exports[family];
    if (!route || typeof route.composition !== 'string') {
      console.error(`matrix: production plan exports.${family} requires an explicit composition`);
      process.exit(1);
    }
    if (!REGISTERED_COMPOSITIONS.has(route.composition)) {
      console.error(`matrix: production plan exports.${family}.composition is not a registered composition`);
      process.exit(1);
    }
    if (route.composition === 'LaunchVideo' || route.composition === 'SocialClip') {
      if (typeof route.props !== 'string') {
        console.error(`matrix: production plan exports.${family}.props is required for ${route.composition}; template defaults are not a directed source`);
        process.exit(1);
      }
    }
  }
  if (productionPlan.exports.launch.composition !== productionPlan.selectedComposition) {
    console.error('matrix: production-plan selectedComposition must match exports.launch.composition; the directorial default cannot be metadata-only');
    process.exit(1);
  }
  if (compFilter || propsOverrideArg) {
    console.error('matrix: --production takes composition and props only from production-plan.json; remove --comp/--props');
    process.exit(1);
  }
}

const productionRoute = (platform, captioned = false) => {
  const family = platform.id.startsWith('launch-') ? 'launch' : 'social';
  const route = productionPlan.exports[family];
  if (!captioned) return route;
  if (!platform.captioned) return route;
  if (!route.captioned) {
    console.error(`matrix: production route exports.${family} does not declare a captioned source for ${platform.id}`);
    process.exit(1);
  }
  return typeof route.captioned === 'object' ? {...route, ...route.captioned} : route;
};

const productionBaseProps = (route) => {
  let base = {};
  if (route.props) {
    const propsPath = resolveWorkspacePath(workspace, route.props);
    if (!existsSync(propsPath)) {
      console.error(`matrix: production route props file not found inside product repo: ${route.props}`);
      process.exit(1);
    }
    base = JSON.parse(readFileSync(propsPath, 'utf8'));
  }
  return {...base, ...(route.renderProps && typeof route.renderProps === 'object' ? route.renderProps : {})};
};

// Audio manifest gates the captioned variants; absent -> caption rows are skipped.
const audioPropsPath = join(workspace.propsDir, `${brand}-audio.json`);
const audioManifest = !production && existsSync(audioPropsPath)
  ? JSON.parse(readFileSync(audioPropsPath, 'utf8'))
  : null;

// A text-bearing frame per composition (headline act) — the layout proof frame.
const stillFrame = (comp) => (comp === 'LaunchVideo' ? 240 : 40);

// See the --props header comment above: when given, every platform row's base props
// come from this one file instead of resolveBaseProps, and outputs/ids get namespaced
// by the segment id parsed off its filename (props/<brand>-wrap-<segmentId>.json).
let propsOverrideData = null;
let segmentId = null;
if (propsOverrideArg) {
  const propsOverridePath = resolveWorkspacePath(workspace, propsOverrideArg);
  if (!existsSync(propsOverridePath)) {
    console.error(`--props file not found: ${propsOverridePath}`);
    process.exit(1);
  }
  propsOverrideData = JSON.parse(readFileSync(propsOverridePath, 'utf8'));
  const base = basename(propsOverridePath, '.json');
  const prefix = `${brand}-wrap-`;
  segmentId = base.startsWith(prefix) ? base.slice(prefix.length) : base;
}

const matrixRelDir = segmentId ? `matrix/wrap-${segmentId}` : 'matrix';
const outDir = segmentId ? join(workspace.matrixDir, `wrap-${segmentId}`) : workspace.matrixDir;
const propsDir = join(outDir, '.props');
mkdirSync(propsDir, {recursive: true});

const loadBase = makeBaseLoader(workspace, brand);

// Probe the bundled ffmpeg for VP9/Opus once, only when --webm was requested. Never
// fails the run: unsupported means webm transcoding is skipped per-file, logged once.
let webmSupported = false;
if (webmFlag && !stillsOnly) {
  const encoders = remotion(['ffmpeg', '-encoders'], {encoding: 'utf8'});
  webmSupported = /libvpx-vp9/.test(encoders) && /libopus/.test(encoders);
  if (!webmSupported) {
    console.log('matrix: --webm requested but the bundled ffmpeg lacks libvpx-vp9/libopus — webm transcoding will be skipped for every file');
  }
}

// Remux an mp4 in place for faststart (moov atom moved to the front, so playback can
// start before the whole file downloads). Renders via a temp file then swaps it in —
// Remotion's ffmpeg build has no in-place edit, and a temp+rename avoids ever leaving
// a partially-written file at the real path.
const remuxFaststart = (mp4Path) => {
  const tmpPath = `${mp4Path}.faststart.tmp.mp4`;
  remotion(['ffmpeg', '-y', '-i', mp4Path, '-c', 'copy', '-movflags', '+faststart', tmpPath], {stdio: 'inherit'});
  if (!existsSync(tmpPath)) {
    console.error(`FAILED: faststart remux did not produce ${tmpPath}`);
    process.exit(1);
  }
  unlinkSync(mp4Path);
  renameSync(tmpPath, mp4Path);
};

// A rendered mp4 that lands OVER its check-budgets.mjs cap (real captured footage
// in the source, e.g. a raw-motion demo act, encodes far heavier than the mostly
// static/vector content the default render settings were sized for) gets a single
// bitrate-targeted re-encode to fit, instead of blocking delivery. One-pass ABR
// with a maxrate/bufsize cap converges close enough to its target average bitrate
// over a multi-second clip; a 10% margin below the byte cap absorbs container
// overhead and rate-control variance. Audio is fixed at 128kbps AAC. Never called
// for files already under budget, so passing brands' output stays byte-identical.
const reencodeToBudget = (mp4Path, maxBytes) => {
  const durationOut = remotion(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'default=noprint_wrappers=1:nokey=1', mp4Path], {encoding: 'utf8'});
  const durationS = parseFloat(durationOut.trim());
  const audioBps = 128_000;
  const totalTargetBps = Math.floor((maxBytes * 8 * 0.9) / durationS);
  const videoBps = Math.max(totalTargetBps - audioBps, 200_000);
  const tmpPath = `${mp4Path}.budget.tmp.mp4`;
  remotion(['ffmpeg', '-y', '-i', mp4Path, '-c:v', 'libx264', '-preset', 'slow', '-b:v', String(videoBps), '-maxrate', String(Math.round(videoBps * 1.15)), '-bufsize', String(videoBps * 2), '-c:a', 'aac', '-b:a', '128k', '-movflags', '+faststart', tmpPath], {stdio: 'inherit'});
  if (!existsSync(tmpPath)) {
    console.error(`FAILED: budget re-encode did not produce ${tmpPath}`);
    process.exit(1);
  }
  unlinkSync(mp4Path);
  renameSync(tmpPath, mp4Path);
};

// Transcode an mp4 to VP9/Opus webm alongside it. Only called when webmSupported.
const transcodeWebm = (mp4Path, webmPath) => {
  remotion(['ffmpeg', '-y', '-i', mp4Path, '-c:v', 'libvpx-vp9', '-b:v', '0', '-crf', '36', '-c:a', 'libopus', webmPath], {stdio: 'inherit'});
  if (!existsSync(webmPath)) {
    console.error(`FAILED: webm transcode did not produce ${webmPath}`);
    process.exit(1);
  }
  return statSync(webmPath).size;
};

// Render one variant (props already merged), verify it landed, return its manifest row.
const renderVariant = (id, comp, width, height, props) => {
  const propsPath = join(propsDir, `${id}.json`);
  writeFileSync(propsPath, JSON.stringify(props));
  const ext = stillsOnly ? 'png' : 'mp4';
  const outFile = join(outDir, `${id}.${ext}`);
  // --concurrency caps how many headless Chrome instances render in parallel.
  // Remotion's default scales with core count and each worker holds a browser,
  // so on a busy workstation a full-length 1080p row OOMs mid-render — and the
  // failure surfaces as a bare "Command failed" with NO Remotion error, which
  // reads like a props bug. Measured 2026-08-17: died at frame 256/2424 with
  // 2.6GB free of 32GB. Pass --concurrency=N (or REMOTION_CONCURRENCY) to fit
  // the machine; omit for Remotion's default.
  if (!REGISTERED_COMPOSITIONS.has(comp)) throw new Error(`refusing unregistered composition ${JSON.stringify(comp)}`);
  const renderArgs = stillsOnly
    ? ['still', comp, outFile, `--props=${propsPath}`, `--public-dir=${workspace.publicDir}`, `--frame=${production ? productionHeroFrame(productionShotPlan, stillFrame(comp)) : stillFrame(comp)}`]
    : ['render', comp, outFile, `--props=${propsPath}`, `--public-dir=${workspace.publicDir}`, ...(concurrency ? [`--concurrency=${concurrency}`] : [])];
  console.log(`matrix: ${id} (${width}x${height}) -> ${portable(outFile)}`);
  try {
    remotion(renderArgs, {stdio: 'inherit'});
  } catch (e) {
    // A mid-render death is nearly always the machine running out of memory for
    // the Chrome workers, and it arrives as a bare "Command failed" with no
    // Remotion diagnostic. Retry ONCE serially before giving up: one worker is
    // slow but fits anywhere, and losing a whole matrix run to transient memory
    // pressure costs far more than the extra minutes. A genuine props/comp bug
    // fails identically the second time, so this cannot mask a real error.
    if (stillsOnly || concurrency === '1') throw e;
    console.error(`matrix: ${id} died mid-render; retrying once at --concurrency=1`);
    remotion(['render', comp, outFile, `--props=${propsPath}`, `--public-dir=${workspace.publicDir}`, '--concurrency=1'], {stdio: 'inherit'});
  }
  if (!existsSync(outFile)) {
    console.error(`FAILED: ${outFile} was not produced`);
    process.exit(1);
  }

  if (!stillsOnly) {
    remuxFaststart(outFile);
    const budget = matchBudget(outFile);
    if (budget && statSync(outFile).size > budget.maxBytes) {
      const beforeMb = (statSync(outFile).size / (1024 * 1024)).toFixed(2);
      console.log(`matrix: ${id} OVER budget (${beforeMb}MB > ${(budget.maxBytes / (1024 * 1024)).toFixed(2)}MB, ${budget.label}) — re-encoding to fit`);
      reencodeToBudget(outFile, budget.maxBytes);
      remuxFaststart(outFile);
      console.log(`matrix: ${id} re-encoded to ${(statSync(outFile).size / (1024 * 1024)).toFixed(2)}MB`);
    }
    if (webmFlag && webmSupported) {
      const webmFile = join(outDir, `${id}.webm`);
      const webmBytes = transcodeWebm(outFile, webmFile);
      console.log(`matrix: ${id} webm -> ${portable(webmFile)} (${webmBytes} bytes)`);
    }
  }

  return {id, path: relative(workspace.projectRoot, outFile).replace(/\\/g, '/'), width, height, bytes: statSync(outFile).size};
};

// A review can be missing while the expensive render is already correct. Keep that
// media in place and let --verify-production resume at the gate, rather than making
// approval depend on an unnecessary second render.
const existingVariant = (id, width, height) => {
  const outFile = join(outDir, `${id}.mp4`);
  if (!existsSync(outFile)) {
    console.error(`matrix: --verify-production needs existing ${portable(outFile)}`);
    process.exit(1);
  }
  return {id, path: relative(workspace.projectRoot, outFile).replace(/\\/g, '/'), width, height, bytes: statSync(outFile).size};
};

// Merge caption data into a base props object per composition.
const rendered = [];
const deliveryEvidence = [];
const deliveryEvidencePath = join(workspace.marketingDir, 'delivery-evidence.json');
const previousDelivery = existsSync(deliveryEvidencePath)
  ? JSON.parse(readFileSync(deliveryEvidencePath, 'utf8'))
  : null;
const previousById = new Map((Array.isArray(previousDelivery?.exports) ? previousDelivery.exports : []).map((entry) => [entry.id, entry]));
const rowArtifacts = (id) => {
  const safeId = String(id).replace(/[^a-z0-9_-]+/gi, '-');
  const dir = resolveWorkspacePath(workspace, join(workspace.marketingDir, 'production-reports', safeId));
  return {
    dir,
    stillsDir: join(dir, 'stills'),
    evidencePath: join(dir, 'evidence.json'),
    sheetPath: join(dir, 'sheet.html'),
    reviewPath: join(dir, 'review.json'),
    reportPath: join(dir, 'report.json'),
  };
};

const currentBundle = () => loadProductionBundle(workspace.projectRoot, brand, productionPlanPath, {
  directionPath: join(workspace.marketingDir, 'direction.json'),
  shotPlanPath: join(workspace.marketingDir, 'shot-plan.json'),
});

const reuseApprovedEvidence = (row, paths) => {
  const previous = previousById.get(row.id);
  if (!previous || !existsSync(paths.evidencePath) || !existsSync(paths.reviewPath) || !existsSync(paths.reportPath)) return null;
  const bundle = currentBundle();
  const renderPath = resolveWorkspacePath(workspace, row.path);
  if (bundle.findings.length || previous.sha256 !== sha256File(renderPath) || previous.planSha256 !== bundle.productionPlanSha256 || previous.sourceBundleSha256 !== bundle.sourceBundleSha256) return null;
  const checked = evaluateProduction({workspace, brand, productionPlanPath, renderPath, evidencePath: paths.evidencePath, reviewPath: paths.reviewPath});
  const report = JSON.parse(readFileSync(paths.reportPath, 'utf8'));
  if (checked.verdict !== 'PASS' || report.verdict !== 'PASS' || report.input?.renderSha256 !== previous.sha256) return null;
  console.log(`matrix: ${row.id} production evidence is current; preserved existing samples, review, report, and timestamps`);
  return previous;
};

const hasCurrentSamples = (row, paths) => {
  if (!existsSync(paths.evidencePath)) return false;
  try {
    const evidence = JSON.parse(readFileSync(paths.evidencePath, 'utf8'));
    const bundle = currentBundle();
    const renderPath = resolveWorkspacePath(workspace, row.path);
    if (bundle.findings.some((item) => item.level === 'FAIL' || item.level === 'INCOMPLETE')) return false;
    if (evidence.planSha256 !== bundle.productionPlanSha256 || evidence.sourceBundleSha256 !== bundle.sourceBundleSha256 || evidence.renderSha256 !== sha256File(renderPath)) return false;
    if (!Array.isArray(evidence.samples) || !evidence.samples.length) return false;
    return evidence.samples.every((sample) => {
      const imagePath = resolveWorkspacePath(workspace, sample.imagePath);
      return existsSync(imagePath) && sample.imageSha256 === sha256File(imagePath);
    });
  } catch {
    return false;
  }
};

const runProductionJudge = (row) => {
  const paths = rowArtifacts(row.id);
  const renderPath = resolveWorkspacePath(workspace, row.path);
  const reused = verifyProduction ? reuseApprovedEvidence(row, paths) : null;
  if (reused) {
    deliveryEvidence.push(reused);
    return;
  }
  mkdirSync(paths.dir, {recursive: true});
  if (!hasCurrentSamples(row, paths)) {
    execFileSync(process.execPath, [
      join(root, 'scripts', 'contact-sheet.mjs'), brand,
      '--project', workspace.projectRoot,
      '--plan', productionPlanPath,
      '--render', renderPath,
      '--evidence', paths.evidencePath,
      '--sheet', paths.sheetPath,
      '--stills-dir', paths.stillsDir,
    ], {cwd: root, stdio: 'inherit'});
  } else {
    console.log(`matrix: ${row.id} samples still match the plan, source bundle, and rendered bytes; preserved evidence timestamps and hashes`);
  }
  copyFileSync(paths.evidencePath, join(workspace.marketingDir, 'production-evidence.json'));
  const genericReview = join(workspace.marketingDir, 'review.json');
  const reviewPath = existsSync(paths.reviewPath) ? paths.reviewPath : genericReview;
  try {
    execFileSync(process.execPath, [
      join(root, 'scripts', 'judge-production.mjs'), brand,
      '--project', workspace.projectRoot,
      '--plan', productionPlanPath,
      '--render', renderPath,
      '--evidence', paths.evidencePath,
      '--review', reviewPath,
      '--report', paths.reportPath,
      '--strict',
    ], {cwd: root, stdio: 'inherit'});
  } catch {
    console.error(`matrix: production judge rejected ${row.id}; no delivery evidence was recorded`);
    process.exit(1);
  }
  if (!existsSync(paths.reportPath)) {
    console.error(`matrix: production judge passed without writing ${portable(paths.reportPath)}`);
    process.exit(1);
  }
  const report = JSON.parse(readFileSync(paths.reportPath, 'utf8'));
  const renderSha256 = sha256File(renderPath);
  if (report.verdict !== 'PASS' || report.input?.renderSha256 !== renderSha256) {
    console.error(`matrix: production judge evidence does not bind PASS to ${row.id}'s rendered bytes`);
    process.exit(1);
  }
  if (reviewPath === genericReview) copyFileSync(genericReview, paths.reviewPath);
  const bundle = currentBundle();
  deliveryEvidence.push({
    id: row.id,
    path: row.path,
    sha256: renderSha256,
    bytes: row.bytes,
    planSha256: bundle.productionPlanSha256,
    sourceBundleSha256: bundle.sourceBundleSha256,
    directionSha256: bundle.direction?.sha256 ?? null,
    shotPlanSha256: bundle.shotPlan?.sha256 ?? null,
    evidence: portable(paths.evidencePath),
    sheet: portable(paths.sheetPath),
    review: portable(paths.reviewPath),
    report: portable(paths.reportPath),
  });
};
for (const p of platforms) {
  if (compFilter && p.comp !== compFilter) continue;
  if (onlyFilter && p.id !== onlyFilter) continue;
  // WrapClip rows only render off an explicit per-segment --props file — a plain
  // brand-wide run must not fall through to resolveBaseProps' social fallback and
  // render placeholder slates (same skip pattern as the audio-manifest gate above).
  if (p.comp === 'WrapClip' && !propsOverrideData) {
    console.log(`matrix: skipped ${p.id} (WrapClip rows need --props props/${brand}-wrap-<segmentId>.json)`);
    continue;
  }
  const route = production ? productionRoute(p) : null;
  const comp = route?.composition ?? p.comp;
  const base = withFormat(
    route ? productionBaseProps(route) : propsOverrideData ?? loadBase(p.comp, {portrait: p.height > p.width}),
    p.width,
    p.height,
  );
  const mainRow = verifyProduction
    ? existingVariant(p.id, p.width, p.height)
    : renderVariant(p.id, comp, p.width, p.height, base);
  rendered.push(mainRow);
  if (productionDelivery) runProductionJudge(mainRow);

  if (p.captioned) {
    if (!production && !audioManifest) {
      console.log(`matrix: skipped ${p.id}-captioned (no props/${brand}-audio.json)`);
      continue;
    }
    const captionRoute = production ? productionRoute(p, true) : null;
    const captionComp = captionRoute?.composition ?? p.comp;
    if (captionComp !== 'LaunchVideo' && captionComp !== 'SocialClip') {
      console.error(`matrix: ${p.id}-captioned requires LaunchVideo or SocialClip; production route selected ${captionComp}`);
      process.exit(1);
    }
    const captionBase = production
      ? withFormat(productionBaseProps(captionRoute), p.width, p.height)
      : base;
    let captionProps;
    try {
      captionProps = withBoundCaptions(captionComp, captionBase, production ? captionBase.audio : audioManifest);
    } catch (error) {
      console.error(`matrix: ${p.id}-captioned refuses unbound caption input: ${error.message}`);
      process.exit(1);
    }
    const captionRow = verifyProduction
      ? existingVariant(`${p.id}-captioned`, p.width, p.height)
      : renderVariant(`${p.id}-captioned`, captionComp, p.width, p.height, captionProps);
    rendered.push(captionRow);
    if (productionDelivery) runProductionJudge(captionRow);
  }
}

if (rendered.length === 0) {
  console.error(`no platforms matched${compFilter ? ` --comp ${compFilter}` : ''}${onlyFilter ? ` --only ${onlyFilter}` : ''}`);
  process.exit(1);
}

// Register in the marketing run manifest when one exists (atomic write).
const runJson = join(workspace.marketingDir, 'run.json');
if (!stillsOnly && existsSync(runJson)) {
  const data = JSON.parse(readFileSync(runJson, 'utf8'));
  const byId = new Map((Array.isArray(data.exports) ? data.exports : []).map((e) => [e.id, e]));
  for (const r of rendered) {
    // Segment-scope the manifest key so re-running the matrix for a different
    // WrapClip segment doesn't overwrite the previous segment's rows (both would
    // otherwise share the same platforms.json id, e.g. "wrap-16x9").
    const key = segmentId ? `${segmentId}-${r.id}` : r.id;
    const evidence = deliveryEvidence.find((e) => e.id === r.id);
    byId.set(key, {...r, id: key, ...(evidence ? {production: evidence} : {})});
  }
  data.exports = [...byId.values()];
  const tmp = `${runJson}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, runJson);
  console.log(`manifest: registered ${rendered.length} exports in ${portable(runJson)}`);
}

if (productionDelivery) {
  const bundle = currentBundle();
  const mergedEvidence = new Map((Array.isArray(previousDelivery?.exports) ? previousDelivery.exports : []).map((entry) => [entry.id, entry]));
  for (const entry of deliveryEvidence) mergedEvidence.set(entry.id, entry);
  const next = JSON.stringify({
    version: 1,
    brand,
    plan: portable(productionPlanPath),
    planSha256: bundle.productionPlanSha256,
    sourceBundleSha256: bundle.sourceBundleSha256,
    exports: [...mergedEvidence.values()],
  }, null, 2) + '\n';
  const unchanged = existsSync(deliveryEvidencePath) && readFileSync(deliveryEvidencePath, 'utf8') === next;
  if (!unchanged) writeFileSync(deliveryEvidencePath, next);
  console.log(`matrix: ${unchanged ? 'preserved' : 'wrote'} hash-bound production evidence for ${mergedEvidence.size} exports`);
}

console.log(
  production && stillsOnly
    ? `matrix layout proof: ${rendered.length} stills in ${portable(outDir)} (not delivery media; run manifest unchanged)`
    : `matrix OK: ${rendered.length} ${stillsOnly ? 'stills' : 'videos'} in ${portable(outDir)}${stillsOnly ? ' (run manifest unchanged)' : ''}`,
);
