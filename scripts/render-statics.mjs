// Renders the AnimatedOG static-plus exports. If the ComfyUI hero exists it is
// staged and used; otherwise the procedural loop is the backdrop (documented
// fallback, logged below).
import {copyFileSync, existsSync, mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {remotion} from './lib/remotion.mjs';
import {projectArg, resolveWorkspace} from './lib/workspace.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = resolveWorkspace(root, {brand: 'noban', project: projectArg(process.argv.slice(2))});
const hero = join(workspace.assetsDir, 'comfy', 'hero.png');
const staged = join(workspace.publicDir, 'noban', 'hero.png');

let heroImage = null;
if (existsSync(hero)) {
  mkdirSync(dirname(staged), {recursive: true});
  copyFileSync(hero, staged);
  heroImage = 'noban/hero.png';
  console.log('using ComfyUI hero backdrop');
} else {
  console.log('comfy hero missing; procedural background fallback (documented). Run: node feeders/comfy/client.mjs hero');
}

const props = {
  brandId: 'noban',
  tagline: 'CS2 skin arbitrage with guardrails',
  cta: 'Simulate free at noban.gg',
  heroImage,
  loopSequence: 'noban/background-loop',
  loopFrames: 240,
};
const propsPath = join(workspace.brandRoot, 'og-props.json');
mkdirSync(dirname(propsPath), {recursive: true});
writeFileSync(propsPath, JSON.stringify(props));

const render = (args, out) => {
  remotion(['render', 'AnimatedOG', join(workspace.brandRoot, out), `--props=${propsPath}`, `--public-dir=${workspace.publicDir}`, ...args]);
};

render([], 'og.mp4');
render(['--codec=gif', '--every-nth-frame=2'], 'og.gif');
render(['--codec=gif', '--every-nth-frame=2', '--scale=0.5'], 'readme.gif');
console.log('statics OK: og.mp4, og.gif, readme.gif in out/noban/');
