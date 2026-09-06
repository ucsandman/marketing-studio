// Shared take-rendering helpers for tournament #24 (hook A/B) and #28 (hero-take
// variants). A "take" is one rendered clip — either a full composition or a frame
// subset via Remotion's `--frames` flag — registered as a candidate variant in
// Mission Control's run.json so the operator picks the winner from the browser
// (radio buttons + selectedVariant, mission-control.mjs's existing contract).
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import {basename, dirname, join} from 'node:path';
import {ffmpeg, remotion} from './remotion.mjs';

const compositions = new Set(['LaunchVideo', 'LogoReveal']);

const stripExt = (p) => basename(p).replace(/\.[^.]+$/, '');

// Renders one take: writes `props` to a temp JSON file alongside `outPath`, invokes
// `npx remotion render <comp> <outPath> --props=<tmp> [--frames=<frames>]`, and
// verifies the output landed. `frames` (optional) is a Remotion --frames range
// string, e.g. '150-335' — used to render only one act (the hook A/B and
// launch-hook takes). Omit it to render the full composition.
export function renderTake({comp, outPath, props, frames, publicDir}) {
  if (!publicDir) throw new Error('renderTake requires a product workspace publicDir');
  if (!compositions.has(comp)) throw new Error(`renderTake refuses unregistered composition ${JSON.stringify(comp)}`);
  if (frames && !/^\d+(?:-\d+)?$/.test(frames)) throw new Error(`renderTake received an invalid frame range: ${frames}`);
  mkdirSync(dirname(outPath), {recursive: true});
  const propsDir = join(dirname(outPath), '.props');
  mkdirSync(propsDir, {recursive: true});
  const propsPath = join(propsDir, `${stripExt(outPath)}.json`);
  writeFileSync(propsPath, JSON.stringify(props));
  console.log(`takes: rendering ${comp} -> ${outPath}${frames ? ` (frames ${frames})` : ''}`);
  remotion(['render', comp, outPath, `--props=${propsPath}`, `--public-dir=${publicDir}`, ...(frames ? [`--frames=${frames}`] : [])]);
  if (!existsSync(outPath)) {
    console.error(`FAILED: ${outPath} was not produced`);
    process.exit(1);
  }
  return {path: outPath, bytes: statSync(outPath).size};
}

// Extracts a first-frame JPEG poster from a rendered video via the bundled ffmpeg
// (PLAYBOOK-established idiom: `npx remotion ffmpeg ... -frames:v 1 ...`).
// Returns the poster's absolute path (same dir, .jpg extension).
export function posterFor(videoPath) {
  const posterPath = videoPath.replace(/\.[^.]+$/, '.jpg');
  ffmpeg(['-y', '-i', videoPath, '-frames:v', '1', posterPath]);
  if (!existsSync(posterPath)) {
    console.error(`FAILED: poster was not produced for ${videoPath}`);
    process.exit(1);
  }
  return posterPath;
}

// Sets an asset's `variants` array in out/<brand>/marketing/run.json to the given
// list ([{id, path, label}]), atomically (temp file + rename, mirroring
// mission-control.mjs's atomicWrite) and re-reading the manifest at write time so
// a concurrently-running skill process's edits aren't clobbered. Returns true when
// written, false when there is no run.json for this brand or no matching asset
// entry — variants are additive metadata for Mission Control's picker, never
// load-bearing for the render itself, so both cases are a silent no-op.
export function registerVariants(workspace, assetId, variants) {
  if (!workspace?.marketingDir) throw new Error('registerVariants requires a product workspace');
  const runPath = join(workspace.marketingDir, 'run.json');
  if (!existsSync(runPath)) return false;
  let run;
  try {
    run = JSON.parse(readFileSync(runPath, 'utf8'));
  } catch {
    return false;
  }
  if (!Array.isArray(run.assets)) return false;
  const entry = run.assets.find((a) => a.id === assetId);
  if (!entry) return false;
  entry.variants = variants;
  const tmp = join(
    dirname(runPath),
    `.${basename(runPath)}.tmp-${process.pid}-${Math.random().toString(36).slice(2)}`,
  );
  writeFileSync(tmp, JSON.stringify(run, null, 2) + '\n');
  renameSync(tmp, runPath);
  return true;
}
