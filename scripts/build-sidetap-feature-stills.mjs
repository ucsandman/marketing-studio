// Feature-act stills for the sidetap launch video. All three panels show REAL
// surfaces only, cropped out of the already-approved demo capture
// (product public workspace, 1600x1000, 25 fps):
//   feature-tree    <- the activity beat at t=23s: phone streaming while the feed
//                      lists what the agent just did, char counts and all
//   feature-stop    <- the STOP beat at t=39s: red bezel, STOPPED badge, RESUME
//   feature-signing <- the checks OVERLAY at t=9.5s, including the
//                      "input signature (7-day)" countdown row
// Timestamps track the 2026-08-10 re-shoot against the zero-scroll dashboard: the
// checks moved from an always-on column into an overlay, and the old console beat
// (tap_text("General") on screen) no longer exists, so feature-tree now sources the
// activity feed instead. Re-time these whenever the capture is re-shot.
// Crops are in the capture's own pixels and are landscape (~16:10) because
// FeaturePanel's landscape row layout sizes the panel off the image's aspect.
// Nothing is re-captured and nothing is invented; this script is the source of truth
// for product-owned public/sidetap/feature-*.png.
//
// Usage: node scripts/build-sidetap-feature-stills.mjs --project <repo>
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {projectArg, resolveWorkspace} from './lib/workspace.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const studio = join(root, 'studio');
const remotionCli = join(studio, 'node_modules', '@remotion', 'cli', 'remotion-cli.js');
const workspace = resolveWorkspace(root, {brand: 'sidetap', project: projectArg(process.argv.slice(2))});
const dest = join(workspace.publicDir, 'sidetap');
const capture = join(dest, 'demo.webm');

// FeaturePanel zooms the still to 1.04 about origin 50%/30%, which eats ~2.8% off the
// bottom of the image. Each crop therefore ends in dead page background, never across
// a control: feature-stop would otherwise cut the red RESUME bar into a stray red
// sliver at the panel edge, and feature-tree would clip the phone's bottom bezel.
const shots = [
  {name: 'feature-tree.png', crop: '1584:850:8:0', ss: '23.0'},
  {name: 'feature-stop.png', crop: '1584:990:8:0', ss: '39.0'},
  {name: 'feature-signing.png', crop: '760:474:420:291', ss: '9.5'},
];

if (!existsSync(capture)) {
  console.error(`build-sidetap-feature-stills: missing source ${capture}`);
  process.exit(1);
}
mkdirSync(dest, {recursive: true});

for (const {name, crop, ss} of shots) {
  const out = join(dest, name);
  // Arg-array invocation with the win32 shell hop, same as judge-palette.mjs.
  const args = ['ffmpeg', '-y', '-ss', ss, '-i', capture, '-frames:v', '1', '-update', '1', '-vf', `crop=${crop}`, out];
  execFileSync(process.execPath, [remotionCli, ...args], {cwd: studio, stdio: 'ignore'});
  if (!existsSync(out)) {
    console.error(`build-sidetap-feature-stills: ffmpeg produced no output for ${name}`);
    process.exit(1);
  }
  console.log(`wrote ${out} (t=${ss}s crop ${crop})`);
}
