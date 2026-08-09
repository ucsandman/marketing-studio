// TenWords OG statics: og.png (native 1200x630 still, bar-free), the 8s
// animated og.mp4/og.gif loop (motion kept), and the README GIF cut from the
// REAL product-demo footage (studio/public/tenwords/demo.mp4 -- the approved
// single-batch Speed_reading capture, not a Remotion composition render). No
// ComfyUI hero or background loop is staged for this brand -- direction.md
// (Galley Proof) calls for a flat paper ground with zero glow/bloom, which
// matches tenwords.json (effects.wash: 0, grade.bloom: 0) exactly, so the
// procedural backdrop IS the argument-ground look, not a placeholder.
//
// showFloatBar defaults true on AnimatedOG (a real progress-style scrubber
// suits the animated loop's motion), so og.png gets its own props file with
// showFloatBar:false -- a static frame of a scrubber mid-fill reads as a
// broken/frozen control, not a design element (same call as costclaw/
// phoneclaude).
//
// Bundled Remotion ffmpeg is a minimal build (no `fps`/`select` filter): trim
// via -ss/-t (container seek), decimate via the legacy `-r` OUTPUT option, and
// use the two-pass palettegen/paletteuse pattern from
// render-costclaw-statics.mjs / render-phoneclaude-statics.mjs.
import {mkdirSync, statSync, unlinkSync, writeFileSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'out', 'tenwords');
mkdirSync(outDir, {recursive: true});

const studioDir = join(root, 'studio');

const baseProps = {
  brandId: 'tenwords',
  tagline: 'Every paragraph in exactly ten words',
  // Matches the established convention (props/tenwords-demo.json,
  // tenwords-launch-demo.json): "Condense any long page at tenwords.io".
  cta: 'Condense any long page at tenwords.io',
  command: null,
  heroImage: null,
  loopSequence: null,
  loopFrames: 1,
};

// Static still: bar-free (a frozen scrubber mid-fill reads as a broken
// control, not a design element -- same call as costclaw/phoneclaude).
const staticPropsPath = join(outDir, 'og-props-static.json');
writeFileSync(staticPropsPath, JSON.stringify({...baseProps, showFloatBar: false}));

// Animated loop: default showFloatBar (true) -- motion is fine on the loop.
const propsPath = join(outDir, 'og-props.json');
writeFileSync(propsPath, JSON.stringify(baseProps));

console.log('still: og.png (1200x630)');
execSync(
  `npx remotion still AnimatedOG "${join(outDir, 'og.png')}" --props="${staticPropsPath}" --width=1200 --height=630`,
  {cwd: studioDir, stdio: 'inherit'},
);

console.log('render: og.mp4');
execSync(`npx remotion render AnimatedOG "${join(outDir, 'og.mp4')}" --props="${propsPath}"`, {
  cwd: studioDir,
  stdio: 'inherit',
});

console.log('render: og.gif');
execSync(
  `npx remotion render AnimatedOG "${join(outDir, 'og.gif')}" --props="${propsPath}" --codec=gif --every-nth-frame=2`,
  {cwd: studioDir, stdio: 'inherit'},
);

// README GIF: cut from the real product-demo footage (studio/public/tenwords/
// demo.mp4, the approved single-batch condense of Speed_reading -- NOT this
// composition). Segment 17.8s-26.8s of the 55.16s demo (props/tenwords-demo.json
// telemetry / run.json foldBeatsAt[0]=18.33): opens right on "Every paragraph
// folds to exactly ten words." (18.331s), into "A red pilcrow marks where each
// one was." (22.645s) and its focus-zoom hold (23.355s) -- the fold snap itself
// lands in the first half-second of the gif (payoff-first, matches
// render-costclaw-statics.mjs / render-phoneclaude-statics.mjs convention).
console.log('render: readme.gif');
const README_GIF_START = 17.8; // s -- just before the fold snap
const README_GIF_DURATION = 9.0; // s -- through the pilcrow focus hold
const README_GIF_WIDTH = 760; // README <img width> convention
const README_GIF_FPS = 10;
const README_GIF_BUDGET_BYTES = 5 * 1024 * 1024; // scripts/check-budgets.mjs hard gate

const demoSrc = join(studioDir, 'public', 'tenwords', 'demo.mp4');
const palettePath = join(outDir, 'readme-gif-palette.png');
const readmeGifPath = join(outDir, 'readme.gif');

execSync(
  `npx remotion ffmpeg -ss ${README_GIF_START} -t ${README_GIF_DURATION} -i "${demoSrc}" -vf "scale=${README_GIF_WIDTH}:-1:flags=lanczos,palettegen" -y "${palettePath}"`,
  {cwd: studioDir, stdio: 'inherit'},
);
execSync(
  `npx remotion ffmpeg -ss ${README_GIF_START} -t ${README_GIF_DURATION} -i "${demoSrc}" -i "${palettePath}" -filter_complex "[0:v]scale=${README_GIF_WIDTH}:-1:flags=lanczos[s];[s][1:v]paletteuse" -r ${README_GIF_FPS} -y "${readmeGifPath}"`,
  {cwd: studioDir, stdio: 'inherit'},
);
unlinkSync(palettePath);

const readmeGifBytes = statSync(readmeGifPath).size;
console.log(`readme.gif: ${(readmeGifBytes / 1024 / 1024).toFixed(2)}MB (budget ${README_GIF_BUDGET_BYTES / 1024 / 1024}MB)`);
if (readmeGifBytes > README_GIF_BUDGET_BYTES) {
  console.error('OVER BUDGET -- lower README_GIF_WIDTH/README_GIF_FPS or shorten README_GIF_DURATION');
  process.exit(1);
}

console.log('statics OK: og.png, og.mp4, og.gif, readme.gif in out/tenwords/');
