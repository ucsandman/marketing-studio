// Responsive export matrix: fan one picture-locked composition into every social
// aspect (16:9 / 1:1 / 4:5 / 9:16) by RESPONSIVE LAYOUT, not crops. The installed
// Remotion (4.0.486) has no --width/--height CLI flags, so dimensions are overridden
// via optional {formatWidth, formatHeight} props that LaunchVideo/SocialClip's
// calculateMetadata reads (Root.tsx); we merge them into a temp props file per
// platform and pass --props.
//
// Usage: node scripts/render-matrix.mjs <brand> [--comp LaunchVideo|SocialClip|WrapClip]
//          [--only <platformId>] [--props <path>] [--stills-only] [--webm]
//   --stills-only   render a single text-bearing still per platform (layout proof,
//                   no CPU for full video). Otherwise renders full .mp4 per platform.
//   --only <id>     render just the one platform row matching scripts/platforms.json's
//                   `id` (e.g. social-1x1) — cheap smoke-test path, combinable with --comp.
//   --props <path>  override the per-comp base props file (see the --props note below).
//   --webm          additionally transcode each rendered mp4 to VP9/Opus webm
//                   (skipped with a log line, never a failure, if the bundled ffmpeg
//                   lacks libvpx-vp9/libopus — probed once via `remotion ffmpeg -encoders`).
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
import {execSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {basename, dirname, join, resolve} from 'node:path';
import {makeBaseLoader, withFormat} from './lib/matrix-props.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const studio = join(root, 'studio');

const args = process.argv.slice(2);
const brand = args.find((a) => !a.startsWith('--'));
const stillsOnly = args.includes('--stills-only');
const webmFlag = args.includes('--webm');
const compIdx = args.indexOf('--comp');
const compFilter = compIdx >= 0 ? args[compIdx + 1] : null;
const onlyIdx = args.indexOf('--only');
const onlyFilter = onlyIdx >= 0 ? args[onlyIdx + 1] : null;
const propsIdx = args.indexOf('--props');
const propsOverrideArg = propsIdx >= 0 ? args[propsIdx + 1] : null;

if (!brand) {
  console.error('usage: node scripts/render-matrix.mjs <brand> [--comp LaunchVideo|SocialClip|WrapClip] [--only <id>] [--props <path>] [--stills-only] [--webm]');
  process.exit(1);
}

// WrapClip has no canonical base props file for resolveBaseProps to fall back on
// (each segment gets its own from build-wrap-props.mjs), so asking for it without
// --props could only render a meaningless placeholder slate — fail loudly instead.
if (compFilter === 'WrapClip' && !propsOverrideArg) {
  console.error('--comp WrapClip requires --props props/<brand>-wrap-<segmentId>.json (emitted by scripts/build-wrap-props.mjs) — WrapClip has no canonical base props file');
  process.exit(1);
}

const platforms = JSON.parse(readFileSync(join(root, 'scripts', 'platforms.json'), 'utf8'));

// Audio manifest gates the captioned variants; absent -> caption rows are skipped.
const audioPropsPath = join(root, 'props', `${brand}-audio.json`);
const audioManifest = existsSync(audioPropsPath)
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
  const propsOverridePath = resolve(root, propsOverrideArg);
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
const outDir = join(root, 'out', brand, matrixRelDir);
const propsDir = join(outDir, '.props');
mkdirSync(propsDir, {recursive: true});

const loadBase = makeBaseLoader(root, brand);

// Probe the bundled ffmpeg for VP9/Opus once, only when --webm was requested. Never
// fails the run: unsupported means webm transcoding is skipped per-file, logged once.
let webmSupported = false;
if (webmFlag && !stillsOnly) {
  const encoders = execSync('npx remotion ffmpeg -encoders', {cwd: studio, encoding: 'utf8'});
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
  execSync(`npx remotion ffmpeg -y -i "${mp4Path}" -c copy -movflags +faststart "${tmpPath}"`, {
    cwd: studio,
    stdio: 'inherit',
  });
  if (!existsSync(tmpPath)) {
    console.error(`FAILED: faststart remux did not produce ${tmpPath}`);
    process.exit(1);
  }
  unlinkSync(mp4Path);
  renameSync(tmpPath, mp4Path);
};

// Transcode an mp4 to VP9/Opus webm alongside it. Only called when webmSupported.
const transcodeWebm = (mp4Path, webmPath) => {
  execSync(
    `npx remotion ffmpeg -y -i "${mp4Path}" -c:v libvpx-vp9 -b:v 0 -crf 36 -c:a libopus "${webmPath}"`,
    {cwd: studio, stdio: 'inherit'},
  );
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
  const cmd = stillsOnly
    ? `npx remotion still ${comp} "${outFile}" --props="${propsPath}" --frame=${stillFrame(comp)}`
    : `npx remotion render ${comp} "${outFile}" --props="${propsPath}"`;
  console.log(`matrix: ${id} (${width}x${height}) -> out/${brand}/${matrixRelDir}/${id}.${ext}`);
  execSync(cmd, {cwd: studio, stdio: 'inherit'});
  if (!existsSync(outFile)) {
    console.error(`FAILED: ${outFile} was not produced`);
    process.exit(1);
  }

  if (!stillsOnly) {
    remuxFaststart(outFile);
    if (webmFlag && webmSupported) {
      const webmFile = join(outDir, `${id}.webm`);
      const webmBytes = transcodeWebm(outFile, webmFile);
      console.log(`matrix: ${id} webm -> out/${brand}/${matrixRelDir}/${id}.webm (${webmBytes} bytes)`);
    }
  }

  return {id, path: `out/${brand}/${matrixRelDir}/${id}.${ext}`, width, height, bytes: statSync(outFile).size};
};

// Merge caption data into a base props object per composition.
const withCaptions = (comp, base) =>
  comp === 'LaunchVideo'
    ? {...base, audio: audioManifest, burnCaptions: true}
    : {
        ...base,
        voLines: audioManifest.lines.map(({act, text, durationMs}) => ({act, text, durationMs})),
        burnCaptions: true,
      };

const rendered = [];
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
  const base = withFormat(propsOverrideData ?? loadBase(p.comp), p.width, p.height);
  rendered.push(renderVariant(p.id, p.comp, p.width, p.height, base));

  if (p.captioned) {
    if (!audioManifest) {
      console.log(`matrix: skipped ${p.id}-captioned (no props/${brand}-audio.json)`);
      continue;
    }
    rendered.push(
      renderVariant(`${p.id}-captioned`, p.comp, p.width, p.height, withCaptions(p.comp, base)),
    );
  }
}

if (rendered.length === 0) {
  console.error(`no platforms matched${compFilter ? ` --comp ${compFilter}` : ''}${onlyFilter ? ` --only ${onlyFilter}` : ''}`);
  process.exit(1);
}

// Register in the marketing run manifest when one exists (atomic write).
const runJson = join(root, 'out', brand, 'marketing', 'run.json');
if (existsSync(runJson)) {
  const data = JSON.parse(readFileSync(runJson, 'utf8'));
  const byId = new Map((Array.isArray(data.exports) ? data.exports : []).map((e) => [e.id, e]));
  for (const r of rendered) {
    // Segment-scope the manifest key so re-running the matrix for a different
    // WrapClip segment doesn't overwrite the previous segment's rows (both would
    // otherwise share the same platforms.json id, e.g. "wrap-16x9").
    const key = segmentId ? `${segmentId}-${r.id}` : r.id;
    byId.set(key, {...r, id: key});
  }
  data.exports = [...byId.values()];
  const tmp = `${runJson}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, runJson);
  console.log(`manifest: registered ${rendered.length} exports in out/${brand}/marketing/run.json`);
}

console.log(`matrix OK: ${rendered.length} ${stillsOnly ? 'stills' : 'videos'} in out/${brand}/matrix/`);
