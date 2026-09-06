// Renders the PaperRoute AnimatedOG static-plus exports. No ComfyUI hero or
// background loop is staged for this brand (see out/paperroute/marketing/run.json
// and build-paperroute-launch-props.mjs, which also runs loopSequence: null) —
// the procedural backdrop (brand.effects wash, wash: 0 for paperroute) is the
// spec-compliant fallback, not a placeholder to fill in later.
import {mkdirSync, writeFileSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {projectArg, resolveWorkspace} from './lib/workspace.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = resolveWorkspace(root, {brand: 'paperroute', project: projectArg(process.argv.slice(2))});

const props = {
  brandId: 'paperroute',
  tagline: 'Visibility-paid wallpaper ads with an auditable 50/50 ledger',
  cta: 'Measure it at paperroute.gg',
  heroImage: null,
  loopSequence: null,
  loopFrames: 1,
};
const propsPath = join(workspace.brandRoot, 'og-props.json');
mkdirSync(dirname(propsPath), {recursive: true});
writeFileSync(propsPath, JSON.stringify(props));

const render = (args, out) => {
  console.log(`render: ${out}`);
  execSync(`npx remotion render AnimatedOG "${join(workspace.brandRoot, out)}" --props="${propsPath}" --public-dir="${workspace.publicDir}" ${args}`, {
    cwd: join(root, 'studio'),
    stdio: 'inherit',
  });
};

render('', 'og.mp4');
render('--codec=gif --every-nth-frame=2', 'og.gif');
render('--codec=gif --every-nth-frame=2 --scale=0.5', 'readme.gif');
console.log('statics OK: og.mp4, og.gif, readme.gif in out/paperroute/');
