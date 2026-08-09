// Feature-act stills for the phone-claude launch video. All three panels show REAL
// surfaces only, cropped out of the already-approved demo capture
// (studio/public/phoneclaude/demo.webm, 1600x1000, 25 fps):
//   feature-tree    <- the live viewer at t=17s: phone streaming while the agent
//                      drives it, with the tap_text("General") helper line on screen
//   feature-stop    <- the STOP beat at t=33.8s: red bezel, STOPPED badge, RESUME
//   feature-signing <- the doctor CHECKS column at t=6.5s, including the
//                      "input signature (7-day)" countdown row
// Crops are in the capture's own pixels and are landscape (~16:10) because
// FeaturePanel's landscape row layout sizes the panel off the image's aspect.
// Nothing is re-captured and nothing is invented; this script is the source of truth
// for studio/public/phoneclaude/feature-*.png (gitignored, like every other brand's
// screenshots).
//
// Usage: node scripts/build-phoneclaude-feature-stills.mjs
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const studio = join(root, 'studio');
const dest = join(studio, 'public', 'phoneclaude');
const capture = join(dest, 'demo.webm');

// FeaturePanel zooms the still to 1.04 about origin 50%/30%, which eats ~2.8% off the
// bottom of the image. Each crop therefore ends in dead page background, never across
// a control: feature-stop would otherwise cut the red RESUME bar into a stray red
// sliver at the panel edge, and feature-tree would clip the phone's bottom bezel.
const shots = [
  {name: 'feature-tree.png', crop: '1360:850:200:0', ss: '17.0'},
  {name: 'feature-stop.png', crop: '1584:990:8:0', ss: '33.8'},
  {name: 'feature-signing.png', crop: '580:363:735:350', ss: '6.5'},
];

if (!existsSync(capture)) {
  console.error(`build-phoneclaude-feature-stills: missing source ${capture}`);
  process.exit(1);
}
mkdirSync(dest, {recursive: true});

for (const {name, crop, ss} of shots) {
  const out = join(dest, name);
  // Arg-array invocation with the win32 shell hop, same as judge-palette.mjs.
  const args = ['remotion', 'ffmpeg', '-y', '-ss', ss, '-i', capture, '-frames:v', '1', '-update', '1', '-vf', `crop=${crop}`, out];
  execFileSync('npx', args, {cwd: studio, stdio: 'ignore', shell: process.platform === 'win32'});
  if (!existsSync(out)) {
    console.error(`build-phoneclaude-feature-stills: ffmpeg produced no output for ${name}`);
    process.exit(1);
  }
  console.log(`wrote studio/public/phoneclaude/${name} (t=${ss}s crop ${crop})`);
}
