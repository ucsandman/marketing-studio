// Launch-cut of the approved TenWords product demo.
//
// The approved product-workspace capture (55.2s) is longer than a
// 30-90s launch film can spend on one act, so the launch video plays a TRIMMED
// window of the SAME footage: nothing is re-captured, re-staged, or re-timed.
// The window is chosen from the capture's own telemetry beats:
//   2.0s   the real article, paragraphs running long (camera already pushing in)
//   7.7s   the shortcut hands the whole page to TenWords
//   18.3s  THE FOLD - every paragraph collapses to exactly ten words
//   22.6s  the red pilcrow beat, then the push into two folded paragraphs
//   27.8s  the whole article gets its one ten-word line, camera back to full page
//   33.4s  cut (before the scroll beats, which the film does not need)
// The restore beat (49.9s) is deliberately OUTSIDE this window: the launch film
// carries the restore in its closing feature act, not in the demo act.
//
// Outputs (both gitignored, like every other brand's footage):
//   public/tenwords/launch-demo.mp4
//   props/tenwords-launch-demo.json   (both below the product workspace)
//
// Usage: node scripts/build-tenwords-launch-demo.mjs --project <repo>
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
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
const workspace = resolveWorkspace(root, {brand: 'tenwords', project: projectArg(process.argv.slice(2))});
const publicDir = join(workspace.publicDir, 'tenwords');
const source = join(publicDir, 'demo.mp4');
const target = join(publicDir, 'launch-demo.mp4');

const START_MS = 2000;
const END_MS = 33400;

// A focus or step event landing in the last GUARD_MS of the cut would start a
// camera move or a caption the viewer never gets to read; drop those.
const GUARD_MS = 900;

if (!existsSync(source)) {
  console.error(`build-tenwords-launch-demo: missing source ${source}`);
  process.exit(1);
}

const demo = JSON.parse(readFileSync(join(workspace.propsDir, 'tenwords-demo.json'), 'utf8'));
const durationMs = END_MS - START_MS;

// Re-base the telemetry onto the cut. The step that is ACTIVE at START_MS is kept
// and re-anchored to t=0 (DemoStage picks the last step at or before now, so a
// dropped opening step would leave the act captionless).
const inWindow = (e) => e.t >= START_MS && e.t <= END_MS - GUARD_MS;
const activeStep = [...demo.telemetry.events]
  .filter((e) => e.type === 'step' && e.t <= START_MS)
  .pop();
const events = [
  ...(activeStep ? [{...activeStep, t: 0}] : []),
  ...demo.telemetry.events.filter(inWindow).map((e) => ({...e, t: e.t - START_MS})),
];

const args = [
  'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error',
  '-ss', String(START_MS / 1000),
  '-to', String(END_MS / 1000),
  '-i', source,
  // Re-encode: a stream copy would start at the previous keyframe and desync every
  // telemetry beat against the picture.
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p',
  '-an', '-movflags', '+faststart',
  target,
];
execFileSync(process.execPath, [remotionCli, ...args], {cwd: studio, stdio: 'inherit'});
if (!existsSync(target)) {
  console.error('build-tenwords-launch-demo: ffmpeg produced no output');
  process.exit(1);
}

mkdirSync(workspace.propsDir, {recursive: true});
const propsOut = join(workspace.propsDir, 'tenwords-launch-demo.json');
writeFileSync(
  propsOut,
  JSON.stringify(
    {
      brandId: 'tenwords',
      video: 'tenwords/launch-demo.mp4',
      cta: demo.cta,
      telemetry: {viewport: demo.telemetry.viewport, durationMs, events},
    },
    null,
    2,
  ) + '\n',
);
console.log(
  `wrote ${target} and ${propsOut} ` +
    `(${START_MS}-${END_MS}ms, ${durationMs}ms, ${events.length} events)`,
);
