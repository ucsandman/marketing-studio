// Feature-act stills for the practicalsystems launch video. All three panels show
// REAL surfaces only, cropped out of the already-approved demo capture
// (product public workspace, 1440x900, 25 fps). The brand's whole
// claim is "nothing staged", so a staged construction would contradict the film:
//   feature-loop       <- the hero at t=11s: the live agent_log feed, real cycle rows
//                         (ceo picks, qa PASS, pnl closed books revenue $0 cost $0.30)
//                         plus the honesty caption under it
//   feature-governance <- the fleet table at t=21.5s: eight agents with duties and the
//                         amber human-gate tags (pick: human-approved, dispatch:
//                         governance-gated, send: human-gated)
//   feature-proof      <- the scoreboard at t=31.5s: three $0 cards read from Stripe,
//                         including the owner-test-charge exclusion note
// Crops are in the capture's own pixels, ~1.6:1 to 2.5:1 so the small mono text scales
// UP into FeaturePanel's ~994px landscape image column instead of down. Each one ends
// in dead page background, never across a control, because FeaturePanel zooms the still
// to 1.04 about origin 50%/30% and eats a few percent off the edges.
// Re-time these whenever the capture is re-shot. Nothing is re-captured and nothing is
// invented; this script is the source of truth for
// product-owned public/practicalsystems/feature-*.png.
//
// Usage: node scripts/build-practicalsystems-feature-stills.mjs --project <repo>
import {existsSync, mkdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {ffmpeg} from './lib/remotion.mjs';
import {projectArg, resolveWorkspace} from './lib/workspace.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = resolveWorkspace(root, {brand: 'practicalsystems', project: projectArg(process.argv.slice(2))});
const dest = join(workspace.publicDir, 'practicalsystems');
const capture = join(dest, 'demo.webm');

const shots = [
  {name: 'feature-loop.png', crop: '716:400:626:170', ss: '11.0'},
  {name: 'feature-governance.png', crop: '860:480:290:205', ss: '21.5'},
  {name: 'feature-proof.png', crop: '856:320:292:252', ss: '31.5'},
];

if (!existsSync(capture)) {
  console.error(`build-practicalsystems-feature-stills: missing source ${capture}`);
  process.exit(1);
}
mkdirSync(dest, {recursive: true});

for (const {name, crop, ss} of shots) {
  const out = join(dest, name);
  // Arg-array invocation with the win32 shell hop, same as build-sidetap-feature-stills.
  const args = ['-y', '-ss', ss, '-i', capture, '-frames:v', '1', '-update', '1', '-vf', `crop=${crop}`, out];
  ffmpeg(args);
  if (!existsSync(out)) {
    console.error(`build-practicalsystems-feature-stills: ffmpeg produced no output for ${name}`);
    process.exit(1);
  }
  console.log(`wrote ${out} (t=${ss}s crop ${crop})`);
}
