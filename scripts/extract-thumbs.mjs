// Thumbnail/poster extraction: for each aspect in scripts/platforms.json matching
// --comp (default LaunchVideo), renders ONE still at the strongest text-bearing
// frame via `npx remotion still`, reusing the same formatWidth/formatHeight props
// mechanism render-matrix.mjs uses (scripts/lib/matrix-props.mjs).
//
// Usage: node scripts/extract-thumbs.mjs <brand> [--comp LaunchVideo]
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

if (!brand) {
  console.error('usage: node scripts/extract-thumbs.mjs <brand> [--comp LaunchVideo]');
  process.exit(1);
}

const platforms = JSON.parse(readFileSync(join(root, 'scripts', 'platforms.json'), 'utf8')).filter(
  (p) => p.comp === comp,
);
if (platforms.length === 0) {
  console.error(`no platforms in scripts/platforms.json match --comp ${comp}`);
  process.exit(1);
}

// Strongest text-bearing frame per composition. LaunchVideo: the hook act begins
// right after the logo act (mirrors LOGO_LEN in studio/src/lib/launchTiming.ts,
// which is fixed regardless of feature count/telemetry length), and hook-start +
// ~70 frames reads best per this repo's render proofs. SocialClip: frame 40, the
// same layout-proof frame render-matrix.mjs already uses (inside the Headline
// sequence's fully-visible window).
const LOGO_LEN = 150; // must match studio/src/lib/launchTiming.ts
const stillFrame = (c) => (c === 'LaunchVideo' ? LOGO_LEN + 70 : 40);

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
  const props = withFormat(loadBase(p.comp), p.width, p.height);
  const propsPath = join(propsDir, `${p.id}.json`);
  writeFileSync(propsPath, JSON.stringify(props));
  const outFile = join(outDir, `thumb-${aspect}.jpg`);
  const cmd = `npx remotion still ${p.comp} "${outFile}" --props="${propsPath}" --frame=${stillFrame(p.comp)} --image-format=jpeg`;
  console.log(`thumbs: ${aspect} (${p.width}x${p.height}) -> out/${brand}/thumbs/thumb-${aspect}.jpg`);
  try {
    execSync(cmd, {cwd: studio, stdio: 'inherit'});
  } catch (err) {
    // --image-format=jpeg not supported by the installed Remotion CLI: fall back
    // to png (documented fallback, one log line, not a hard failure).
    console.log(`thumbs: --image-format=jpeg failed, falling back to png: ${err.message}`);
    const pngFile = join(outDir, `thumb-${aspect}.png`);
    execSync(
      `npx remotion still ${p.comp} "${pngFile}" --props="${propsPath}" --frame=${stillFrame(p.comp)}`,
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
