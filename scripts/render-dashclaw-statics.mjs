// Renders the DashClaw AnimatedOG static-plus exports: the sitewide OG/Twitter/
// GitHub social-preview PNGs (three different aspect crops of the same AnimatedOG
// lockup, per og-assets recipe step 3) plus the bonus 8s animated loop (og.mp4/
// og.gif). No hero image or background loop is staged for this brand — brand
// effects.wash is 0 (dashclaw.json voice: orange is a signal, never a wash), so
// the flat-black procedural backdrop is the spec-compliant look, not a fallback
// to fill in later. The README demo GIF (approvals -> Allow click -> resolve) is
// built separately by render-dashclaw-readme-gif.mjs from real product footage,
// not from this template.
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {remotion} from './lib/remotion.mjs';
import {projectArg, resolveWorkspace} from './lib/workspace.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = resolveWorkspace(root, {brand: 'dashclaw', project: projectArg(process.argv.slice(2))});
const outDir = workspace.brandRoot;
mkdirSync(outDir, {recursive: true});

const props = {
  brandId: 'dashclaw',
  tagline: 'The approval layer for unattended AI agents',
  cta: 'Govern your agents at dashclaw.io',
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

const render = (args, out) => {
  remotion(['render', 'AnimatedOG', join(outDir, out), `--props=${propsPath}`, `--public-dir=${workspace.publicDir}`, ...args]);
};

// Delivery targets matching the live DashClaw repo's public/social/* files
// (names/dims verified against public/social/*.png + app/lib/marketingSeo.ts).
still('og-image.png', 1200, 630); // native AnimatedOG size
still('twitter-card.png', 1200, 600);
still('github-social-preview.png', 1280, 640); // GitHub repo social card

// Bonus animated OG loop (recipe default), native 1200x630.
render([], 'og.mp4');
render(['--codec=gif', '--every-nth-frame=2'], 'og.gif');

console.log('statics OK: og-image.png, twitter-card.png, github-social-preview.png, og.mp4, og.gif in out/dashclaw/');
