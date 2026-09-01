// Feature-act plates for the postflop launch video. The direction (The Proof
// Sheet, out/postflop/marketing/direction.md) sets real workbench footage under
// ink rules as framed plates, and the brand voice is explicit that "the product is
// the imagery": every plate is a REAL region of the already-approved demo capture,
// nothing is re-captured, re-staged, or invented.
//
//   feature-convergence <- the SOLVE view's report interval + convergence panel
//                          (exploitability, the descending curve, the per-report
//                          ITER / BB / % OF POT table). t=22.5s.
//   feature-tree        <- the Inspector's two 13x13 grids: strategy split by
//                          action, and the EV surface. t=31.8s.
//   feature-lock        <- the same grid after a node lock, carrying the product's
//                          own LOCK UPDATED badge, plus the sidebar's measured
//                          exploitability block. t=41.0s.
// The convergence and lock beats are deliberately OUTSIDE the launch demo cut
// (scripts/build-postflop-launch-demo.mjs), so the film shows each of them once.
//
// Outputs studio/public/postflop/feature-*.png (gitignored, like every other
// brand's screenshots).
//
// Usage: node scripts/build-postflop-feature-stills.mjs
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
const dest = join(studio, 'public', 'postflop');
const capture = join(dest, 'demo.webm');

// Crops are `w:h:x:y` in the capture's own 1920x1080 pixels. Each one starts on a
// panel's own ink rule, never mid-content: a wider convergence crop reaches back
// into the range editor and half-cuts a range string and a helper line, and
// half-legible text reads as a broken render (PLAYBOOK: end the window BEFORE any
// ragged self-clipped edge). That is why the convergence plate is the narrow one.
const shots = [
  {name: 'feature-convergence.png', crop: '395:312:1525:548', ss: '22.5'},
  {name: 'feature-tree.png', crop: '845:500:205:150', ss: '31.8'},
  {name: 'feature-lock.png', crop: '630:520:0:150', ss: '41.0'},
];

// Every crop is then fitted (aspect preserved, lanczos) onto ONE mount board of
// this size and centred on it, the board filled with the brand's `surface` so it is
// seamless with FeaturePanel's own plate ground. All three plates become the same
// rectangle, which is what makes them read as figures on one spec sheet rather than
// three unrelated screenshots.
//
// Fit, not pad-only: padding alone left the narrow convergence column floating in a
// mostly empty box (first contact sheet), and cropping alone made the panel upscale
// that same column 2.5x, which was visibly soft. Fitting to a common board costs at
// most 1.9x on the narrowest crop and 1.05x on the widest.
// INSET is ground reserved on every side. FeaturePanel zooms its plate 1.00 -> 1.04
// and clips the overflow, which at this plate size eats ~18 board px per edge; with
// a flush fit that came straight off the crop's own edge text ("OOP STRATEGY" read
// "OP STRATEGY" in launch-v1). The inset is what the zoom consumes instead.
const BOARD = {w: 900, h: 540, inset: 28, color: '0xF4F1E8'};

if (!existsSync(capture)) {
  console.error(`build-postflop-feature-stills: missing source ${capture}`);
  process.exit(1);
}
mkdirSync(dest, {recursive: true});

for (const {name, crop, ss} of shots) {
  const out = join(dest, name);
  // Offsets are computed here, not with ffmpeg's `(ow-iw)/2`: the npx hop needs
  // `shell: true` on win32 and cmd.exe eats the parentheses. Plain `ffmpeg` on PATH
  // (launch.py --check verifies it) with no shell passes the filter through verbatim.
  const [cw, ch] = crop.split(':').map(Number);
  const k = Math.min((BOARD.w - 2 * BOARD.inset) / cw, (BOARD.h - 2 * BOARD.inset) / ch);
  const fw = Math.round((cw * k) / 2) * 2;
  const fh = Math.round((ch * k) / 2) * 2;
  const vf =
    `crop=${crop},scale=${fw}:${fh}:flags=lanczos,pad=${BOARD.w}:${BOARD.h}:` +
    `${Math.round((BOARD.w - fw) / 2)}:${Math.round((BOARD.h - fh) / 2)}:${BOARD.color}`;
  const args = ['-y', '-hide_banner', '-loglevel', 'error', '-ss', ss, '-i', capture, '-frames:v', '1', '-update', '1', '-vf', vf, out];
  execFileSync('ffmpeg', args, {cwd: studio, stdio: 'inherit'});
  if (!existsSync(out)) {
    console.error(`build-postflop-feature-stills: ffmpeg produced no output for ${name}`);
    process.exit(1);
  }
  console.log(`wrote studio/public/postflop/${name} (crop ${crop} @ ${ss}s -> ${BOARD.w}x${BOARD.h})`);
}
