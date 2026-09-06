// Opening clips for the sidetap social posts, sliced out of the already-approved
// demo capture (product public workspace, 1600x1000, 25 fps, vp8):
//   social-x-open.webm        <- the kill-switch beat: red bezel, refused agent tap,
//                                RESUME. Matches the X copy, which leads on the stop
//                                button and the audit log.
//   social-linkedin-open.webm <- the credibility beat: the check dots, the overlay
//                                where every check names its own fix, then the agent
//                                taking over.
// Sourcing both from the demo means one approved take, one redaction pass. The clips
// these replaced were captured against the pre-dashboard viewer and additionally
// showed the Windows user name unmasked, which is why they could not be reused.
//
// Usage: node scripts/build-sidetap-social-opens.mjs --project <repo>
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, statSync} from 'node:fs';
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

const clips = [
  {name: 'social-x-open.webm', ss: '36.5', t: '8.9'},
  {name: 'social-linkedin-open.webm', ss: '4.5', t: '9.0'},
];

if (!existsSync(capture)) {
  console.error(`build-sidetap-social-opens: missing source ${capture}`);
  process.exit(1);
}
mkdirSync(dest, {recursive: true});

for (const {name, ss, t} of clips) {
  const out = join(dest, name);
  // Re-encode rather than stream-copy: a copy would start on the previous keyframe
  // and the clip would open on a frozen frame. Arg-array invocation with the win32
  // shell hop, same as build-sidetap-feature-stills.mjs.
  const args = [
    'ffmpeg', '-y', '-ss', ss, '-t', t, '-i', capture,
    '-c:v', 'libvpx', '-b:v', '2M', '-deadline', 'good', '-cpu-used', '2', '-an', out,
  ];
  execFileSync(process.execPath, [remotionCli, ...args], {cwd: studio, stdio: 'ignore'});
  if (!existsSync(out) || statSync(out).size === 0) {
    console.error(`build-sidetap-social-opens: ffmpeg produced no output for ${name}`);
    process.exit(1);
  }
  console.log(`wrote ${out} (t=${ss}s +${t}s)`);
}
