// CostClaw OG statics: AnimatedOG crops (bar-free, per showFloatBar), the 8s
// animated og.mp4/og.gif loop (motion kept), and the README GIF cut from the
// REAL demo footage (out/costclaw/demo.mp4 — the already-approved audit run,
// not a Remotion composition render). No ComfyUI hero or background loop is
// staged for this brand — effects.wash is 0.07 (small terracotta wash only),
// matching the "clean white paper, no glow" voice rule, so the procedural
// backdrop is the spec-compliant look, not a fallback to fill in later.
//
// showFloatBar defaults true on AnimatedOG (a real progress-style scrubber
// suits the animated loop's motion), so the three static crops get their own
// props file with showFloatBar:false — a static frame of a scrubber mid-fill
// reads as a broken/frozen control, not a design element.
//
// Bundled Remotion ffmpeg is a minimal build (no `fps`/`select` filter): trim
// via -ss/-t (container seek), decimate via the legacy `-r` OUTPUT option, and
// use the two-pass palettegen/paletteuse pattern from
// render-dashclaw-readme-gif.mjs / render-magnetic-statics.mjs.
import {mkdirSync, statSync, unlinkSync, writeFileSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {projectArg, resolveWorkspace} from './lib/workspace.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = resolveWorkspace(root, {brand: 'costclaw', project: projectArg(process.argv.slice(2))});
const outDir = workspace.brandRoot;
mkdirSync(outDir, {recursive: true});

const studioDir = join(root, 'studio');

const baseProps = {
  brandId: 'costclaw',
  tagline: 'Find the leak in your Claude Code spend',
  cta: 'Run the free audit:',
  // Runnable text — must stay verbatim lowercase, never run through the
  // uppercased cta line. Rendered on its own non-transformed mono chip.
  command: 'npx costclaw audit',
  heroImage: null,
  loopSequence: null,
  loopFrames: 1,
};

// Static crops: bar-free (no scrubber on a frozen frame).
const staticPropsPath = join(outDir, 'og-props-static.json');
writeFileSync(staticPropsPath, JSON.stringify({...baseProps, showFloatBar: false}));

// Animated loop: default showFloatBar (true) — motion is fine on the loop.
const animatedPropsPath = join(outDir, 'og-props.json');
writeFileSync(animatedPropsPath, JSON.stringify(baseProps));

const still = (out, width, height) => {
  console.log(`still: ${out} (${width}x${height})`);
  execSync(
    `npx remotion still AnimatedOG "${join(outDir, out)}" --props="${staticPropsPath}" --public-dir="${workspace.publicDir}" --width=${width} --height=${height}`,
    {cwd: studioDir, stdio: 'inherit'},
  );
};

// Delivery targets: OG image (native size), Twitter card crop, GitHub social
// preview crop.
still('og.png', 1200, 630); // native AnimatedOG size
still('twitter-card.png', 1200, 600);
still('github-social-preview.png', 1280, 640); // GitHub repo social card

console.log('render: og.mp4');
execSync(`npx remotion render AnimatedOG "${join(outDir, 'og.mp4')}" --props="${animatedPropsPath}" --public-dir="${workspace.publicDir}"`, {
  cwd: studioDir,
  stdio: 'inherit',
});

console.log('render: og.gif');
execSync(
  `npx remotion render AnimatedOG "${join(outDir, 'og.gif')}" --props="${animatedPropsPath}" --public-dir="${workspace.publicDir}" --codec=gif --every-nth-frame=2`,
  {cwd: studioDir, stdio: 'inherit'},
);

// README GIF: cut from the real audit-run footage (out/costclaw/demo.mp4,
// Playwright capture rendered via ProductDemo — NOT this composition). Segment
// 0.2s-9.2s of the 29.855s demo body (props/costclaw-demo.json telemetry):
// the "one free command reads your logs" open, straight into the
// "recoverable usage, priced from real token counts" headline reveal and its
// focus-zoom hold, ending before the 9.416s cut to the six-pillar-score beat.
// Payoff-first: the dollar figure lands well inside the first half of the gif,
// not buried after a long lead-in.
console.log('render: readme.gif');
const README_GIF_START = 0.2; // s -- into the command-line open
const README_GIF_DURATION = 9.0; // s -- through the recoverable-usage focus hold
const README_GIF_WIDTH = 760; // README <img width> convention
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

console.log('statics OK: og.png, twitter-card.png, github-social-preview.png, og.mp4, og.gif, readme.gif in out/costclaw/');
