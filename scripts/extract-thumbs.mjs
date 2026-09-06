// Thumbnail/poster extraction: for each aspect in scripts/platforms.json matching
// --comp (default LaunchVideo), renders ONE still at a CHOSEN poster frame via
// `npx remotion still`, reusing the same formatWidth/formatHeight props mechanism
// render-matrix.mjs uses (scripts/lib/matrix-props.mjs).
//
// Usage: node scripts/extract-thumbs.mjs <brand> [--comp LaunchVideo]
//          [--frame <n>] [--frame-<aspect> <n>]
//   --frame <n>           poster frame override for every aspect this run touches.
//   --frame-<aspect> <n>  per-aspect override (e.g. --frame-16x9 220), wins over
//                         --frame. <aspect> matches the thumb-<aspect> naming below
//                         (16x9, 9x16, 1x1, 4x5).
//
// POSTER FRAME RULE (why this script takes a frame argument at all): the chosen
// frame must be a SETTLED, fully-legible moment — never mid-motion, never a
// half-typed line, never a cursor visible mid-travel or mid-click. Test every
// chosen frame at 200px wide (thumbnail-rail size): if the claim is not readable
// that small, pick a different frame or shorten the copy it depends on, don't
// just widen the still.
//
// Frame precedence (highest wins):
//   1. --frame-<aspect> <n>        CLI, this run, one aspect
//   2. --frame <n>                 CLI, this run, every aspect
//   3. base.posterFrame[<aspect>]  optional per-aspect map in props/<brand>-launch.json,
//                                  if a builder script ever adds one — NEVER hand-edit
//                                  the generated JSON, add it via build-launch-props.mjs's
//                                  builder pattern (see docs/PLAYBOOK.md "Process")
//   4. base.posterFrame            same field as a single frame number for every aspect
//   5. timing lookup (LaunchVideo only): first frame of the first feature act, plus a
//                                  small settle offset, resolved via launchTiming() —
//                                  the SAME import path scripts/judge-av-sync.mjs uses,
//                                  never re-derived. Falls through when the brand has
//                                  no feature acts or its props/launchTiming import
//                                  can't be read (missing props, parse error, etc).
//   6. stillFrame(comp)            built-in constant fallback (documented below)
// No brand's props/<brand>-launch.json sets `posterFrame` today (build-launch-props.mjs
// does not emit it) — tiers 3/4 are dormant until a future builder change adds it; the
// zod schema in studio/src/templates/LaunchVideo.tsx strips unknown keys, so the field
// is harmless to read speculatively even where absent.
//
// Whichever tier wins, the console log for each aspect names it — a poster landing
// on the wrong act should be visible in the log, not just in the still.
//
// Outputs: out/<brand>/thumbs/thumb-<aspect>.jpg (falls back to .png if the
// installed Remotion CLI still build rejects --image-format=jpeg).
import {execSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';
import {makeBaseLoader, withFormat} from './lib/matrix-props.mjs';
import {projectArg, resolveWorkspace} from './lib/workspace.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const studio = join(root, 'studio');

// --- pure helpers (exported for scripts/extract-thumbs.test.mjs) ---

// Frames of settle after a cut before an entrance kicker has fully decayed
// (settleOn's exp envelope in studio/src/lib/depth.ts, SETTLE_TAU_FRAMES=6, is down
// to ~0.007 by frame 30) — long enough that the first feature act's poster never
// catches the reveal mid-motion.
export const FEATURE_SETTLE_FRAMES = 30;

// The pure choice: given a launchTiming()-shaped timing object, the first frame of
// the first feature act (plus the settle offset), or null when there's no feature
// act to point at (timing.features empty/absent). Mirrors the hand-built `timing`
// fixture convention scripts/judge-av-sync.test.mjs already uses, so this stays
// testable without a TS import.
export function pickFeatureFrame(timing, settle = FEATURE_SETTLE_FRAMES) {
  const first = timing?.features?.[0];
  if (!first || !Number.isFinite(first.from)) return null;
  return first.from + settle;
}

// --- CLI ---

// Built-in default (tier 6): the strongest text-bearing frame per composition when
// nothing more specific was chosen. LaunchVideo: the hook act begins right after the
// logo act (mirrors LOGO_LEN in studio/src/lib/launchTiming.ts, which is fixed
// regardless of feature count/telemetry length), and hook-start + ~70 frames reads
// best per this repo's render proofs. SocialClip: frame 40, the same layout-proof
// frame render-matrix.mjs already uses (inside the Headline sequence's fully-visible
// window). These are starting points, not guarantees — verify at 200px wide per brand.
const LOGO_LEN = 150; // must match studio/src/lib/launchTiming.ts
const stillFrame = (c) => (c === 'LaunchVideo' ? LOGO_LEN + 70 : 40);

// Loads props/<brand>-{launch,audio,demo}.json and resolves launchTiming() exactly
// as scripts/judge-av-sync.mjs does (same dynamic TS import, same four arguments),
// then applies pickFeatureFrame. Never throws: any missing/unreadable input or
// import failure resolves to {frame: null, source: <why>} so the caller falls
// through to the constant tier instead of dying mid-run.
export async function resolveTimingFrame(brand, workspace) {
  const launchPath = join(workspace.propsDir, `${brand}-launch.json`);
  if (!existsSync(launchPath)) return {frame: null, source: `no props/${brand}-launch.json`};
  try {
    const launch = JSON.parse(readFileSync(launchPath, 'utf8'));
    const audioPath = join(workspace.propsDir, `${brand}-audio.json`);
    const lines = existsSync(audioPath) ? JSON.parse(readFileSync(audioPath, 'utf8')).lines ?? [] : [];
    // The demo duration that actually renders is the one EMBEDDED in the launch
    // props (Root.tsx calculateMetadata and judge-av-sync both read only that).
    // props/<brand>-demo.json can be a different capture (tenwords: 55177ms there
    // vs 31400ms embedded), so reading it here put the poster 714 frames off.
    const telemetryDurationMs = launch.demo?.telemetry?.durationMs ?? null;
    const features = Array.isArray(launch.features) ? launch.features : [];
    const mod = await import(new URL('../studio/src/lib/launchTiming.ts', import.meta.url));
    const timing = mod.launchTiming(
      telemetryDurationMs,
      features.length,
      launch.actLengths ?? null,
      mod.voTimingFrom(lines, features.length, {force: launch.voTiming ?? null}),
    );
    const frame = pickFeatureFrame(timing);
    return frame == null
      ? {frame: null, source: `${brand} has no feature acts`}
      : {frame, source: 'timing lookup (first feature act)'};
  } catch (err) {
    return {frame: null, source: `timing lookup failed: ${err.message}`};
  }
}

// Resolves the frame to render for one aspect per the precedence table above.
// timingLookup is {frame, source} from resolveTimingFrame (computed once per run,
// not per aspect — the same brand/comp timing applies to every aspect).
function pickPosterFrame(aspect, comp, base, timingLookup) {
  if (Number.isFinite(perAspectFrameArgs[aspect])) {
    return {frame: perAspectFrameArgs[aspect], source: `--frame-${aspect}`};
  }
  if (Number.isFinite(globalFrameArg)) return {frame: globalFrameArg, source: '--frame'};
  const pf = base?.posterFrame;
  if (pf && typeof pf === 'object' && Number.isFinite(pf[aspect])) {
    return {frame: pf[aspect], source: `posterFrame.${aspect}`};
  }
  if (Number.isFinite(pf)) return {frame: pf, source: 'posterFrame'};
  if (Number.isFinite(timingLookup?.frame)) {
    return {frame: timingLookup.frame, source: timingLookup.source};
  }
  return {frame: stillFrame(comp), source: `constant fallback (${timingLookup?.source ?? 'no timing lookup'})`};
}

const args = process.argv.slice(2);
const brand = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--project');
const project = projectArg(args);
const compIdx = args.indexOf('--comp');
const comp = compIdx >= 0 ? args[compIdx + 1] : 'LaunchVideo';

// --frame <n> / --frame-<aspect> <n>: see the precedence table above. Both fail
// loudly on a non-numeric value — a silently-ignored typo would fall back to a
// frame nobody chose, defeating the point of this script.
const frameIdx = args.indexOf('--frame');
let globalFrameArg = null;
if (frameIdx >= 0) {
  globalFrameArg = Number(args[frameIdx + 1]);
  if (!Number.isFinite(globalFrameArg)) {
    console.error(`--frame requires a number, got ${JSON.stringify(args[frameIdx + 1])}`);
    process.exit(1);
  }
}
const perAspectFrameArgs = {};
for (let i = 0; i < args.length; i++) {
  const m = /^--frame-(.+)$/.exec(args[i]);
  if (!m) continue;
  const n = Number(args[i + 1]);
  if (!Number.isFinite(n)) {
    console.error(`${args[i]} requires a number, got ${JSON.stringify(args[i + 1])}`);
    process.exit(1);
  }
  perAspectFrameArgs[m[1]] = n;
}

const usage = 'usage: node scripts/extract-thumbs.mjs <brand> --project <product-repo> [--comp LaunchVideo] [--frame <n>] [--frame-<aspect> <n>]';

async function main() {
  if (!brand) {
    console.error(usage);
    process.exit(1);
  }
  const workspace = resolveWorkspace(root, {brand, project});

  const platforms = JSON.parse(readFileSync(join(root, 'scripts', 'platforms.json'), 'utf8')).filter(
    (p) => p.comp === comp,
  );
  if (platforms.length === 0) {
    console.error(`no platforms in scripts/platforms.json match --comp ${comp}`);
    process.exit(1);
  }

  const outDir = workspace.thumbsDir;
  const propsDir = join(outDir, '.props');
  mkdirSync(propsDir, {recursive: true});

  const loadBase = makeBaseLoader(workspace, brand);

  // scripts/lib/matrix-props.mjs's resolveBaseProps() exits the process if the base
  // props file is missing, so touch it once up front via loadBase for a clean error.
  loadBase(comp);

  const timingLookup =
    comp === 'LaunchVideo' ? await resolveTimingFrame(brand, workspace) : {frame: null, source: 'timing lookup skipped (not LaunchVideo)'};

  const aspectOf = (id) => id.replace(/^(launch|social)-/, '');

  const written = [];
  for (const p of platforms) {
    const aspect = aspectOf(p.id);
    const base = loadBase(p.comp, {portrait: p.height > p.width});
    const props = withFormat(base, p.width, p.height);
    const propsPath = join(propsDir, `${p.id}.json`);
    writeFileSync(propsPath, JSON.stringify(props));
    const {frame, source} = pickPosterFrame(aspect, p.comp, base, timingLookup);
    const outFile = join(outDir, `thumb-${aspect}.jpg`);
    const cmd = `npx remotion still ${p.comp} "${outFile}" --props="${propsPath}" --public-dir="${workspace.publicDir}" --frame=${frame} --image-format=jpeg`;
    console.log(
      `thumbs: ${aspect} (${p.width}x${p.height}) frame ${frame} [${source}] -> out/${brand}/thumbs/thumb-${aspect}.jpg`,
    );
    try {
      execSync(cmd, {cwd: studio, stdio: 'inherit'});
    } catch (err) {
      // --image-format=jpeg not supported by the installed Remotion CLI: fall back
      // to png (documented fallback, one log line, not a hard failure).
      console.log(`thumbs: --image-format=jpeg failed, falling back to png: ${err.message}`);
      const pngFile = join(outDir, `thumb-${aspect}.png`);
      execSync(
        `npx remotion still ${p.comp} "${pngFile}" --props="${propsPath}" --public-dir="${workspace.publicDir}" --frame=${frame}`,
        {cwd: studio, stdio: 'inherit'},
      );
      if (!existsSync(pngFile)) {
        console.error(`FAILED: ${pngFile} was not produced`);
        process.exit(1);
      }
      written.push(pngFile);
      continue;
    }
    if (!existsSync(outFile)) {
      console.error(`FAILED: ${outFile} was not produced`);
      process.exit(1);
    }
    written.push(outFile);
  }

  console.log(`thumbs OK: ${written.length} stills in out/${brand}/thumbs/`);
}

// Import-safe (the test file imports the pure helpers above): only run when
// executed directly, matching build-wrap-props.mjs's isMain convention.
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) main();
