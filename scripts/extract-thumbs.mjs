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
//   5. stillFrame(comp)            this script's built-in default (documented below)
// No brand's props/<brand>-launch.json sets `posterFrame` today (build-launch-props.mjs
// does not emit it) — tiers 3/4 are dormant until a future builder change adds it; the
// zod schema in studio/src/templates/LaunchVideo.tsx strips unknown keys, so the field
// is harmless to read speculatively even where absent.
//
// Outputs: out/<brand>/thumbs/thumb-<aspect>.jpg (falls back to .png if the
// installed Remotion CLI still build rejects --image-format=jpeg).
import {execSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {makeBaseLoader, withFormat} from './lib/matrix-props.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const studio = join(root, 'studio');

const args = process.argv.slice(2);
const brand = args.find((a) => !a.startsWith('--'));
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

const usage = 'usage: node scripts/extract-thumbs.mjs <brand> [--comp LaunchVideo] [--frame <n>] [--frame-<aspect> <n>]';
if (!brand) {
  console.error(usage);
  process.exit(1);
}

const platforms = JSON.parse(readFileSync(join(root, 'scripts', 'platforms.json'), 'utf8')).filter(
  (p) => p.comp === comp,
);
if (platforms.length === 0) {
  console.error(`no platforms in scripts/platforms.json match --comp ${comp}`);
  process.exit(1);
}

// Built-in default (tier 5): the strongest text-bearing frame per composition when
// nothing more specific was chosen. LaunchVideo: the hook act begins right after the
// logo act (mirrors LOGO_LEN in studio/src/lib/launchTiming.ts, which is fixed
// regardless of feature count/telemetry length), and hook-start + ~70 frames reads
// best per this repo's render proofs. SocialClip: frame 40, the same layout-proof
// frame render-matrix.mjs already uses (inside the Headline sequence's fully-visible
// window). These are starting points, not guarantees — verify at 200px wide per brand.
const LOGO_LEN = 150; // must match studio/src/lib/launchTiming.ts
const stillFrame = (c) => (c === 'LaunchVideo' ? LOGO_LEN + 70 : 40);

// Resolves the frame to render for one aspect per the precedence table above.
function pickPosterFrame(aspect, comp, base) {
  if (Number.isFinite(perAspectFrameArgs[aspect])) return perAspectFrameArgs[aspect];
  if (Number.isFinite(globalFrameArg)) return globalFrameArg;
  const pf = base?.posterFrame;
  if (pf && typeof pf === 'object' && Number.isFinite(pf[aspect])) return pf[aspect];
  if (Number.isFinite(pf)) return pf;
  return stillFrame(comp);
}

const outDir = join(root, 'out', brand, 'thumbs');
const propsDir = join(outDir, '.props');
mkdirSync(propsDir, {recursive: true});

const loadBase = makeBaseLoader(root, brand);

// scripts/lib/matrix-props.mjs's resolveBaseProps() exits the process if the base
// props file is missing, so touch it once up front via loadBase for a clean error.
loadBase(comp);

const aspectOf = (id) => id.replace(/^(launch|social)-/, '');

const written = [];
for (const p of platforms) {
  const aspect = aspectOf(p.id);
  const base = loadBase(p.comp);
  const props = withFormat(base, p.width, p.height);
  const propsPath = join(propsDir, `${p.id}.json`);
  writeFileSync(propsPath, JSON.stringify(props));
  const frame = pickPosterFrame(aspect, p.comp, base);
  const outFile = join(outDir, `thumb-${aspect}.jpg`);
  const cmd = `npx remotion still ${p.comp} "${outFile}" --props="${propsPath}" --frame=${frame} --image-format=jpeg`;
  console.log(`thumbs: ${aspect} (${p.width}x${p.height}) frame ${frame} -> out/${brand}/thumbs/thumb-${aspect}.jpg`);
  try {
    execSync(cmd, {cwd: studio, stdio: 'inherit'});
  } catch (err) {
    // --image-format=jpeg not supported by the installed Remotion CLI: fall back
    // to png (documented fallback, one log line, not a hard failure).
    console.log(`thumbs: --image-format=jpeg failed, falling back to png: ${err.message}`);
    const pngFile = join(outDir, `thumb-${aspect}.png`);
    execSync(
      `npx remotion still ${p.comp} "${pngFile}" --props="${propsPath}" --frame=${frame}`,
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
