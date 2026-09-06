// Magnetic OG statics: AnimatedOG crops + 8s loop, LogoReveal render, and the
// README GIF. effects.wash is 0 (single-accent voice rule) so the flat
// near-black backdrop is the spec-compliant look.
//
// brief.json (studio/src/lib/brief.ts schema) has no top-level `tagline` field —
// the approved short-form OG copy lives at `social.x.headline` ("The magnetic
// timeline, on Windows"), with `hook.headline` as a longer/data-heavy fallback
// for video hooks, not banner text. `cta` is a real top-level field.
//
// LogoReveal's own defaultProps (studio/src/Root.tsx) are noban's, including
// `cta: "Simulate free at noban.gg"` — logoRevealSchema's `cta` is a required
// string with no schema default, so a bare `{"brandId":"magnetic"}` render
// silently bakes noban's copy into the output (see .superpowers/sdd/
// task-9-report.md, Step 1). This script always passes `cta` explicitly,
// sourced from brief.json, so the render is reproducible on-brand.
//
// Bundled Remotion ffmpeg is a minimal build with no `fps`/`select` filter, so
// the README GIF trims via -ss/-t and decimates via the output `-r` option,
// using the two-pass palettegen/paletteuse pattern from
// render-dashclaw-readme-gif.mjs.
import {mkdirSync, readFileSync, statSync, unlinkSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {ffmpeg, remotion} from './lib/remotion.mjs';
import {projectArg, resolveWorkspace} from './lib/workspace.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = resolveWorkspace(root, {brand: 'magnetic', project: projectArg(process.argv.slice(2))});
const outDir = workspace.brandRoot;
mkdirSync(outDir, {recursive: true});

const brief = JSON.parse(readFileSync(join(outDir, 'marketing', 'brief.json'), 'utf8'));
const props = {
  brandId: 'magnetic',
  tagline: brief.social?.x?.headline || brief.hook?.headline || 'A magnetic-timeline video editor for Windows',
  cta: brief.cta || 'github.com/ucsandman/magnetic',
  heroImage: null,
  loopSequence: null,
  loopFrames: 1,
};
const propsPath = join(outDir, 'og-props.json');
writeFileSync(propsPath, JSON.stringify(props));

const still = (out, width, height) => {
  remotion([
    'still',
    'AnimatedOG',
    join(outDir, out),
    `--props=${propsPath}`,
    `--public-dir=${workspace.publicDir}`,
    `--width=${width}`,
    `--height=${height}`,
  ]);
};

still('og-image.png', 1200, 630); // native AnimatedOG size
still('github-social-preview.png', 1280, 640); // GitHub repo social card

remotion(['render', 'AnimatedOG', join(outDir, 'og.mp4'), `--props=${propsPath}`, `--public-dir=${workspace.publicDir}`]);

// LogoReveal: brandId + cta only (sequence/frameCount/motionOverride left at
// the composition's own defaults — no PngSequence for magnetic, just the mark).
const logoRevealProps = {
  brandId: 'magnetic',
  sequence: null,
  frameCount: 90,
  cta: brief.cta || 'github.com/ucsandman/magnetic',
  motionOverride: null,
};
const logoRevealPropsPath = join(outDir, 'logo-reveal-props.json');
writeFileSync(logoRevealPropsPath, JSON.stringify(logoRevealProps));
remotion(['render', 'LogoReveal', join(outDir, 'logo-reveal.mp4'), `--props=${logoRevealPropsPath}`, `--public-dir=${workspace.publicDir}`]);

// README GIF: cut from product-demo.mp4's blade/ripple beat — the lead-in
// bullet, the "Clips never overlap; edits ripple automatically" bullet with
// its visible gap-close, and the bullet-3 transition (window chosen and
// verified in .superpowers/sdd/task-9-report.md, Step 3).
console.log('render: readme.gif');
const README_GIF_START = 11; // s -- lead-in bullet, into the ripple beat
const README_GIF_DURATION = 8; // s -- through the ripple bullet + bullet-3 transition
const README_GIF_WIDTH = 640; // README <img width> convention, scaled down from 760 to fit budget
const README_GIF_FPS = 8;
const README_GIF_BUDGET_BYTES = 5 * 1024 * 1024; // readme-gif budget (scripts/check-budgets.mjs)

const demoSrc = join(outDir, 'product-demo.mp4');
const palettePath = join(outDir, 'readme-gif-palette.png');
const readmeGifPath = join(outDir, 'readme.gif');

ffmpeg([
  '-ss', `${README_GIF_START}`,
  '-t', `${README_GIF_DURATION}`,
  '-i', demoSrc,
  '-vf', `scale=${README_GIF_WIDTH}:-1:flags=lanczos,palettegen`,
  '-y', palettePath,
]);
ffmpeg([
  '-ss', `${README_GIF_START}`,
  '-t', `${README_GIF_DURATION}`,
  '-i', demoSrc,
  '-i', palettePath,
  '-filter_complex', `[0:v]scale=${README_GIF_WIDTH}:-1:flags=lanczos[s];[s][1:v]paletteuse`,
  '-r', `${README_GIF_FPS}`,
  '-y', readmeGifPath,
]);
unlinkSync(palettePath);

const readmeGifBytes = statSync(readmeGifPath).size;
console.log(`readme.gif: ${(readmeGifBytes / 1024 / 1024).toFixed(2)}MB (budget ${README_GIF_BUDGET_BYTES / 1024 / 1024}MB)`);
if (readmeGifBytes > README_GIF_BUDGET_BYTES) {
  console.error('OVER BUDGET -- lower README_GIF_WIDTH/README_GIF_FPS or shorten README_GIF_DURATION');
  process.exit(1);
}

console.log('statics OK: og-image.png, github-social-preview.png, og.mp4, logo-reveal.mp4, readme.gif in out/magnetic/');
