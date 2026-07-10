// Responsive export matrix: fan one picture-locked composition into every social
// aspect (16:9 / 1:1 / 4:5 / 9:16) by RESPONSIVE LAYOUT, not crops. The installed
// Remotion (4.0.486) has no --width/--height CLI flags, so dimensions are overridden
// via optional {formatWidth, formatHeight} props that LaunchVideo/SocialClip's
// calculateMetadata reads (Root.tsx); we merge them into a temp props file per
// platform and pass --props.
//
// Usage: node scripts/render-matrix.mjs <brand> [--comp LaunchVideo|SocialClip] [--stills-only]
//   --stills-only   render a single text-bearing still per platform (layout proof,
//                   no CPU for full video). Otherwise renders full .mp4 per platform.
//
// Outputs land in out/<brand>/matrix/<id>.mp4 (or .png for stills). If
// out/<brand>/marketing/run.json exists, an `exports` array is appended/updated with
// {id, path, width, height, bytes} per rendered file (atomic temp+rename); when no
// run.json exists the manifest step is silently skipped.
//
// Captions: platforms flagged {captioned:true} (the muted-autoplay 9:16/1:1 rows)
// also get an extra <id>-captioned variant with the VO burned into on-screen
// captions — but only when props/<brand>-audio.json exists (else skipped, one log
// line). LaunchVideo reads caption text from the merged `audio` manifest; SocialClip
// from a merged `voLines` array (it has no audio track).
import {execSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync} from 'node:fs';
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
const stillsOnly = args.includes('--stills-only');
const compIdx = args.indexOf('--comp');
const compFilter = compIdx >= 0 ? args[compIdx + 1] : null;

if (!brand) {
  console.error('usage: node scripts/render-matrix.mjs <brand> [--comp LaunchVideo|SocialClip] [--stills-only]');
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

const outDir = join(root, 'out', brand, 'matrix');
const propsDir = join(outDir, '.props');
mkdirSync(propsDir, {recursive: true});

const loadBase = makeBaseLoader(root, brand);

// Render one variant (props already merged), verify it landed, return its manifest row.
const renderVariant = (id, comp, width, height, props) => {
  const propsPath = join(propsDir, `${id}.json`);
  writeFileSync(propsPath, JSON.stringify(props));
  const ext = stillsOnly ? 'png' : 'mp4';
  const outFile = join(outDir, `${id}.${ext}`);
  const cmd = stillsOnly
    ? `npx remotion still ${comp} "${outFile}" --props="${propsPath}" --frame=${stillFrame(comp)}`
    : `npx remotion render ${comp} "${outFile}" --props="${propsPath}"`;
  console.log(`matrix: ${id} (${width}x${height}) -> out/${brand}/matrix/${id}.${ext}`);
  execSync(cmd, {cwd: studio, stdio: 'inherit'});
  if (!existsSync(outFile)) {
    console.error(`FAILED: ${outFile} was not produced`);
    process.exit(1);
  }
  return {id, path: `out/${brand}/matrix/${id}.${ext}`, width, height, bytes: statSync(outFile).size};
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
  console.error(`no platforms matched${compFilter ? ` --comp ${compFilter}` : ''}`);
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

console.log(`matrix OK: ${rendered.length} ${stillsOnly ? 'stills' : 'videos'} in out/${brand}/matrix/`);
