// Launch-cut of the approved postflop product demo.
//
// The approved product-workspace capture (49.5s) is longer than a
// 30-90s launch film can spend on one act, so the launch video plays a TRIMMED cut
// of the SAME footage: nothing is re-captured, re-staged, or re-timed.
//
// Unlike the tenwords cut this one is THREE windows, because the approved demo
// narration has two movements and the capture puts them 17s apart:
//   "Give it a board, both ranges, stacks, pot and sizings."  -> window A
//   "Then walk the whole tree: per hand strategies, E Vs,
//    blockers, every runout."                                 -> windows B + C
// Windows, chosen from the capture's own telemetry beats:
//   A 1.4-13.8s   board/stacks/pot/sizings, both ranges, the 0.05% convergence
//                 target. Ends before the preflight beat.
//   B 30.6-39.5s  the 13x13 grid split by action, then one cell opened to its
//                 combos, mixes and EVs. Ends before the node-lock beat.
//   C 43.2-47.2s  walking the tree and the runout ladder.
// Deliberately OUTSIDE the cut: preflight (14.1s), the solve + exploitability
// beats (18.5-27.6s) and the node lock (40.1s). Feature acts 1 and 3 carry those,
// the same way the tenwords cut leaves its restore beat to a feature act.
//
// A rest focus is injected 900ms BEFORE every window boundary after the first (900ms
// is cameraAt's own TRANSITION_MS). Without it the camera holds the outgoing window's
// zoom over the incoming picture and only then pulls back, which reads as a random
// crop for the first second of the new shot; injected early, the shot releases to the
// whole page and the cut lands on a settled wide frame.
//
// Outputs (both gitignored, like every other brand's footage):
//   public/postflop/launch-demo.mp4
//   props/postflop-launch-demo.json   (both below the product workspace)
//
// Usage: node scripts/build-postflop-launch-demo.mjs --project <repo>
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
const workspace = resolveWorkspace(root, {brand: 'postflop', project: projectArg(process.argv.slice(2))});
const publicDir = join(workspace.publicDir, 'postflop');
const source = join(publicDir, 'demo.webm');
const target = join(publicDir, 'launch-demo.mp4');

const WINDOWS = [
  [1400, 13800],
  [30600, 39500],
  [43200, 47200],
];

// A focus or step event landing in the last GUARD_MS of a window would start a
// camera move or a caption the viewer never gets to read; drop those.
const GUARD_MS = 900;

// How far before a cut the camera starts releasing; matches lib/camera's TRANSITION_MS.
const REST_LEAD_MS = 900;

if (!existsSync(source)) {
  console.error(`build-postflop-launch-demo: missing source ${source}`);
  process.exit(1);
}

const demo = JSON.parse(readFileSync(join(workspace.propsDir, 'postflop-demo.json'), 'utf8'));
const vp = demo.telemetry.viewport;

// Re-base the telemetry onto the cut, window by window. The step ACTIVE at the
// first window's start is kept and re-anchored to t=0 (DemoStage picks the last
// step at or before now, so a dropped opening step would leave the act
// captionless).
const activeStep = [...demo.telemetry.events]
  .filter((e) => e.type === 'step' && e.t <= WINDOWS[0][0])
  .pop();

let cursor = 0;
const events = activeStep ? [{...activeStep, t: 0}] : [];
for (const [start, end] of WINDOWS) {
  if (cursor > 0) {
    // Rest focus: w/h equal to the viewport makes cameraAt's fill scale 1, i.e. the
    // frame is back on the whole page by the time the cut lands.
    events.push({
      type: 'focus',
      t: Math.max(0, cursor - REST_LEAD_MS),
      x: vp.width / 2,
      y: vp.height / 2,
      w: vp.width,
      h: vp.height,
    });
  }
  for (const e of demo.telemetry.events) {
    if (e.t < start || e.t > end - GUARD_MS) continue;
    events.push({...e, t: e.t - start + cursor});
  }
  cursor += end - start;
}
const durationMs = cursor;

// One invocation, one decode: trim each window off the same input and concat.
// The trim filter cuts on decoded frames, so every telemetry beat stays where the
// re-based times above say it is (a stream copy would start at the previous
// keyframe and desync the whole act).
const chains = WINDOWS.map(
  ([start, end], i) => `[0:v]trim=${start / 1000}:${end / 1000},setpts=PTS-STARTPTS[w${i}]`,
).join(';');
const concat = `${WINDOWS.map((_, i) => `[w${i}]`).join('')}concat=n=${WINDOWS.length}:v=1:a=0[out]`;

// Remotion's bundled binary omits filters this graph needs, so use the system
// ffmpeg verified by launch.py --check. The argv array preserves the graph verbatim.
const args = [
  '-y', '-hide_banner', '-loglevel', 'error',
  '-i', source,
  '-filter_complex', `${chains};${concat}`,
  '-map', '[out]',
  '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-pix_fmt', 'yuv420p',
  '-an', '-movflags', '+faststart',
  target,
];
execFileSync('ffmpeg', args, {cwd: studio, stdio: 'inherit'});
if (!existsSync(target)) {
  console.error('build-postflop-launch-demo: ffmpeg produced no output');
  process.exit(1);
}

mkdirSync(workspace.propsDir, {recursive: true});
const propsOut = join(workspace.propsDir, 'postflop-launch-demo.json');
writeFileSync(
  propsOut,
  JSON.stringify(
    {...demo, video: 'postflop/launch-demo.mp4', telemetry: {viewport: vp, durationMs, events}},
    null,
    2,
  ) + '\n',
);
console.log(
  `wrote ${target} + ${propsOut} ` +
    `(${WINDOWS.length} windows, ${(durationMs / 1000).toFixed(1)}s, ${events.length} events)`,
);
