// Feature-act stills for the CostClaw launch video. The three feature panels show
// REAL product surfaces only, cropped out of the already-approved audit run:
//   feature-leak  <- the local HTML report's priced-exposure hero + stat tiles
//   feature-score <- the same report's six-pillar setup score
//   feature-local <- the terminal capture, showing the command reading local logs
// Nothing is re-captured and nothing is invented; this script is the source of truth
// for studio/public/costclaw/feature-*.png (gitignored, like every other brand's
// screenshots).
//
// Usage: node scripts/build-costclaw-feature-stills.mjs
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
const dest = join(studio, 'public', 'costclaw');

// Report screenshot is 3200x6156 (a 2x full-page render of the 1600px-wide report);
// the demo capture is 1440x900. Crops are in each source's own pixels.
const report = join(root, 'out', 'costclaw', 'marketing', 'polish', 'html-after.png');
const capture = join(dest, 'demo.webm');

const shots = [
  {name: 'feature-leak.png', src: report, crop: '1600:1000:800:360'},
  {name: 'feature-score.png', src: report, crop: '1600:700:800:2170'},
  {name: 'feature-local.png', src: capture, crop: '1080:675:180:30', ss: '6.5'},
];

for (const {src} of shots) {
  if (!existsSync(src)) {
    console.error(`build-costclaw-feature-stills: missing source ${src}`);
    process.exit(1);
  }
}
mkdirSync(dest, {recursive: true});

for (const {name, src, crop, ss} of shots) {
  const out = join(dest, name);
  // Arg-array invocation with the win32 shell hop, same as judge-palette.mjs.
  const args = ['remotion', 'ffmpeg', '-y'];
  if (ss) args.push('-ss', ss);
  args.push('-i', src, '-frames:v', '1', '-update', '1', '-vf', `crop=${crop}`, out);
  execFileSync('npx', args, {cwd: studio, stdio: 'ignore', shell: process.platform === 'win32'});
  if (!existsSync(out)) {
    console.error(`build-costclaw-feature-stills: ffmpeg produced no output for ${name}`);
    process.exit(1);
  }
  console.log(`wrote studio/public/costclaw/${name} (crop ${crop})`);
}
