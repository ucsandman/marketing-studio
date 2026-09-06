// Renders the Truckside AnimatedOG exports: og.png (link-preview still), og.mp4
// (8s seamless loop), og.gif, readme.gif. No ComfyUI hero or background loop is
// staged for this brand: the procedural backdrop (brand.effects wash 0, glow 0.08 -
// understated, no neon) is the spec-compliant fallback, not a placeholder. The mark
// and palette come from brands/truckside.json.
import {mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {remotion} from './lib/remotion.mjs';
import {projectArg, resolveWorkspace} from './lib/workspace.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = resolveWorkspace(root, {brand: 'truckside', project: projectArg(process.argv.slice(2))});

const props = {
  brandId: 'truckside',
  tagline: 'The back office for a business that runs out of a truck',
  cta: 'See the live demo',
  command: 'truckside.io',
  heroImage: null,
  loopSequence: null,
  loopFrames: 1,
};
const propsPath = join(workspace.brandRoot, 'og-props.json');
mkdirSync(dirname(propsPath), {recursive: true});
writeFileSync(propsPath, JSON.stringify(props));

const outDir = workspace.brandRoot;
const still = (frame, out) => {
  remotion([
    'still',
    'AnimatedOG',
    join(outDir, out),
    `--props=${propsPath}`,
    `--public-dir=${workspace.publicDir}`,
    `--frame=${frame}`,
  ]);
};
const render = (args, out) => {
  remotion(['render', 'AnimatedOG', join(outDir, out), `--props=${propsPath}`, `--public-dir=${workspace.publicDir}`, ...args]);
};

// og.png: the static link-preview image (1200x630). Frame 120 is mid-loop, lockup
// settled and CTA in. verify-og-wired compares this against the live og:image.
still(120, 'og.png');
render([], 'og.mp4');
render(['--codec=gif', '--every-nth-frame=2'], 'og.gif');
render(['--codec=gif', '--every-nth-frame=2', '--scale=0.5'], 'readme.gif');
console.log('statics OK: og.png, og.mp4, og.gif, readme.gif in out/truckside/');
