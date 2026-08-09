// phone-claude OG statics: og.png (native 1200x630 still), the 8s animated
// og.mp4/og.gif loop, and the README GIF cut from the REAL demo footage
// (out/phoneclaude/demo.mp4 -- the approved live-iPhone capture, not a
// Remotion composition render). No ComfyUI hero or background loop is staged
// for this brand -- effects.wash is 0 (brand voice: terminal aesthetic, no
// consumer-gadget gloss), so the flat procedural backdrop is the
// spec-compliant look, not a fallback to fill in later.
//
// Bundled Remotion ffmpeg is a minimal build (no `fps`/`select` filter): trim
// via -ss/-t (container seek), decimate via the legacy `-r` OUTPUT option, and
// use the two-pass palettegen/paletteuse pattern from
// render-dashclaw-readme-gif.mjs / render-costclaw-statics.mjs.
import {mkdirSync, statSync, unlinkSync, writeFileSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'out', 'phoneclaude');
mkdirSync(outDir, {recursive: true});

const studioDir = join(root, 'studio');

const baseProps = {
  brandId: 'phoneclaude',
  tagline: 'Your iPhone, driven from Windows',
  cta: 'Clone it free:',
  // Runnable text -- must stay verbatim lowercase, never run through the
  // uppercased cta line (git is case sensitive). Rendered on its own
  // non-transformed mono chip. Mirrors render-costclaw-statics.mjs.
  command: 'git clone github.com/ucsandman/sidetap',
  heroImage: null,
  loopSequence: null,
  loopFrames: 1,
};

// Static still: bar-free (a frozen scrubber mid-fill reads as a broken
// control, not a design element -- same call as costclaw's og-props-static.json).
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

// README GIF: cut from the real product-demo footage (out/phoneclaude/demo.mp4,
// live iPhone captured through the viewer -- NOT this composition). Segment
// 28.3s-37.0s of the 41.73s demo (props/phoneclaude-demo.json telemetry: "The
// agent takes it back with one call." at t=28.394s through "Resume hands
// control back." at t=35.374s): the agent regains control, the STOP button
// fires (red bezel, STOPPED badge, refused agent tap, red human-tap ripple),
// then resume -- the strongest self-contained beat in the demo, verified
// against extracted proof frames at t=29/33.5/36.5s before this ran.
console.log('render: readme.gif');
const README_GIF_START = 28.3; // s -- "the agent takes it back with one call"
const README_GIF_DURATION = 8.7; // s -- through the STOP beat and resume
const README_GIF_WIDTH = 800; // brief: "prefer ~800px wide"
const README_GIF_FPS = 10;
const README_GIF_BUDGET_BYTES = 5 * 1024 * 1024; // scripts/check-budgets.mjs hard gate

const demoSrc = join(outDir, 'demo.mp4');
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

console.log('statics OK: og.png, og.mp4, og.gif, readme.gif in out/phoneclaude/');
