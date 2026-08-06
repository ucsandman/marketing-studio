// Responsive export matrix: fan one picture-locked composition into every social
// aspect (16:9 / 1:1 / 4:5 / 9:16) by RESPONSIVE LAYOUT, not crops. The installed
// Remotion (4.0.486) has no --width/--height CLI flags, so dimensions are overridden
// via optional {formatWidth, formatHeight} props that LaunchVideo/SocialClip's
// calculateMetadata reads (Root.tsx); we merge them into a temp props file per
// platform and pass --props.
//
// Usage: node scripts/render-matrix.mjs <brand> [--comp LaunchVideo|SocialClip]
//          [--only <platformId>] [--stills-only] [--webm]
//   --stills-only   render a single text-bearing still per platform (layout proof,
//                   no CPU for full video). Otherwise renders full .mp4 per platform.
//   --only <id>     render just the one platform row matching scripts/platforms.json's
//                   `id` (e.g. social-1x1) — cheap smoke-test path, combinable with --comp.
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
// from a merged `voLines` array (it has no audio track).
import {execSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {makeBaseLoader, stillFrameForComposition, withFormat} from './lib/matrix-props.mjs';

export function resolveMatrixOutputDirectory(root, brand, postId) {
  return postId ? join(root, 'out', brand, 'posts', postId) : join(root, 'out', brand, 'matrix');
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (isMain) {
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
const postIdx = args.indexOf('--post');
const postId = postIdx >= 0 ? args[postIdx + 1] : null;

if (!brand) {
  console.error('usage: node scripts/render-matrix.mjs <brand> [--comp LaunchVideo|SocialClip] [--post <id>] [--only <id>] [--stills-only] [--webm]');
  process.exit(1);
}
if (postIdx >= 0 && !postId) {
  console.error('render-matrix: --post requires an id');
  process.exit(1);
}
if (postId && compFilter && compFilter !== 'MotionVariant') {
  console.error('render-matrix: --post only supports MotionVariant');
  process.exit(1);
}

const platforms = JSON.parse(readFileSync(join(root, 'scripts', 'platforms.json'), 'utf8'));

// Audio manifest gates the captioned variants; absent -> caption rows are skipped.
const audioPropsPath = join(root, 'props', `${brand}-audio.json`);
const audioManifest = existsSync(audioPropsPath)
  ? JSON.parse(readFileSync(audioPropsPath, 'utf8'))
  : null;

const outDir = resolveMatrixOutputDirectory(root, brand, postId);
const propsDir = join(outDir, '.props');
mkdirSync(propsDir, {recursive: true});

const loadBase = makeBaseLoader(root, brand, postId);

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
    ? `npx remotion still ${comp} "${outFile}" --props="${propsPath}" --frame=${stillFrameForComposition(comp, 240)}`
    : `npx remotion render ${comp} "${outFile}" --props="${propsPath}"`;
  const outputBase = postId ? `out/${brand}/posts/${postId}` : `out/${brand}/matrix`;
  console.log(`matrix: ${id} (${width}x${height}) -> ${outputBase}/${id}.${ext}`);
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
      console.log(`matrix: ${id} webm -> out/${brand}/matrix/${id}.webm (${webmBytes} bytes)`);
    }
  }

  return {id, path: `${postId ? `out/${brand}/posts/${postId}` : `out/${brand}/matrix`}/${id}.${ext}`, width, height, bytes: statSync(outFile).size};
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
  if (postId && p.comp !== 'MotionVariant') continue;
  if (compFilter && p.comp !== compFilter) continue;
  if (onlyFilter && p.id !== onlyFilter) continue;
  const base = withFormat(loadBase(p.comp), p.width, p.height);
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
  for (const r of rendered) byId.set(r.id, r);
  data.exports = [...byId.values()];
  const tmp = `${runJson}.tmp`;
  writeFileSync(tmp, JSON.stringify(data, null, 2));
  renameSync(tmp, runJson);
  console.log(`manifest: registered ${rendered.length} exports in out/${brand}/marketing/run.json`);
}

console.log(`matrix OK: ${rendered.length} ${stillsOnly ? 'stills' : 'videos'} in ${postId ? `out/${brand}/posts/${postId}/` : `out/${brand}/matrix/`}`);
}
