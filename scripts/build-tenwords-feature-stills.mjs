// Feature-act stills for the TenWords launch video. All three panels show REAL
// product surfaces only; nothing is staged, composited, or invented.
//
//   feature-enforced <- the approved capture at t=36.0s: six folded paragraphs,
//                       each exactly ten words, each marked by a red pilcrow
//   feature-private  <- the extension's own options page (the product repo's
//                       Chrome Web Store screenshot): the Anthropic key field,
//                       and the line stating the key stays in this browser profile
//   feature-restore  <- the approved capture at t=30.5s: the condensed page with
//                       its ten-word TL;DR banner and the "restore original" link
//
// Crops are in each source's own pixels and stay landscape, because FeaturePanel's
// row layout sizes the panel off the image's aspect. Outputs land in
// studio/public/tenwords/ (gitignored, like every other brand's screenshots).
//
// Usage: node scripts/build-tenwords-feature-stills.mjs
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
const dest = join(studio, 'public', 'tenwords');
const capture = join(dest, 'demo.mp4');
const optionsShot = join('C:', 'Projects', 'tenwords', 'docs', 'store-assets', 'shot-options.png');

// FeaturePanel zooms each still to 1.04 about 50%/30%, eating ~2.8% off the bottom,
// so every crop ends in page background rather than across a control.
const shots = [
  // 1440x900 capture: the article column only (the page's purple navigation box
  // sits to its right and would fight the monochrome ground), holding four
  // consecutive folded paragraphs, each exactly ten words behind a red pilcrow.
  {name: 'feature-enforced.png', src: capture, ss: '36.0', crop: '640:412:250:60'},
  // 1280x800 options page, cropped to just the block that carries the evidence:
  // header, key field, buttons, and the line naming where the key is stored.
  // FeaturePanel's 1.04 zoom eats ~2% off EVERY edge, and this page starts its text
  // 20px from the left, so the crop is padded out onto the brand's paper ground:
  // without the pad the render clips the leading letter of five lines.
  {
    name: 'feature-private.png',
    src: optionsShot,
    vf: 'crop=1280:290:0:0,pad=1400:370:60:40:0xfbfbfb',
    // Remotion's bundled ffmpeg has no `pad` filter (verified), so this one shot
    // goes through plain ffmpeg on PATH, the same hop master-audio.mjs makes.
    plainFfmpeg: true,
  },
  // 1440x900 capture: the whole condensed page, banner and restore link included.
  {name: 'feature-restore.png', src: capture, ss: '30.5', crop: '1440:820:0:0'},
];

for (const s of shots) {
  if (!existsSync(s.src)) {
    console.error(`build-tenwords-feature-stills: missing source ${s.src}`);
    process.exit(1);
  }
}
mkdirSync(dest, {recursive: true});

for (const {name, src, crop, vf, ss, plainFfmpeg} of shots) {
  const out = join(dest, name);
  // Arg-array invocation with the win32 shell hop, same as judge-palette.mjs.
  const ffArgs = [
    '-y', '-hide_banner', '-loglevel', 'error',
    ...(ss ? ['-ss', ss] : []),
    '-i', src,
    '-frames:v', '1', '-update', '1', '-vf', vf ?? `crop=${crop}`,
    out,
  ];
  if (plainFfmpeg) {
    execFileSync('ffmpeg', ffArgs, {cwd: studio, stdio: 'inherit'});
  } else {
    // Arg-array invocation with the win32 shell hop, same as judge-palette.mjs.
    execFileSync('npx', ['remotion', 'ffmpeg', ...ffArgs], {
      cwd: studio,
      stdio: 'inherit',
      shell: process.platform === 'win32',
    });
  }
  if (!existsSync(out)) {
    console.error(`build-tenwords-feature-stills: ffmpeg produced no output for ${name}`);
    process.exit(1);
  }
  console.log(`wrote studio/public/tenwords/${name} (${vf ?? `crop=${crop}`}${ss ? ` at t=${ss}s` : ''})`);
}
