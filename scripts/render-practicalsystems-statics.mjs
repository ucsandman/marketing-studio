// Practical Systems OG statics: og.png (native 1200x630 still), the 8s
// animated og.mp4/og.gif loop, and readme.gif (600x315, per SKILL.md dims --
// same loop scaled down, PLAYBOOK "scale down for READMEs"). No ComfyUI hero
// or background loop is staged for this brand (none exists under
// assets/practicalsystems or studio/public/practicalsystems) -- effects.wash
// is 0.07 (brand voice: teal is signal only, never a flooded wash), so the
// flat procedural backdrop is the spec-compliant look, not a fallback to
// fill in later.
//
// Copy is locked verbatim from out/practicalsystems/marketing/brief.json:
// hook.headline -> tagline prop; cta + url folded into the cta prop with
// "at" (same connector render-statics.mjs already uses for noban: "Simulate
// free at noban.gg"). No command chip -- there is nothing to run, the CTA
// points at a URL, not a shell command. No numbers anywhere (safe option per
// brief: headline + mark + url only).
//
// PLAYBOOK.md (2026-08-17, discovered earlier on this same run): `--width`/
// `--height` on `npx remotion still`/`render` are no-ops in Remotion
// 4.0.486. Not needed here anyway -- AnimatedOG's composition is already
// native 1200x630 (Root.tsx), so the plain `still` command below delivers
// the exact OG size with no flag.
import {mkdirSync, statSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {remotion} from './lib/remotion.mjs';
import {projectArg, resolveWorkspace} from './lib/workspace.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const workspace = resolveWorkspace(root, {brand: 'practicalsystems', project: projectArg(process.argv.slice(2))});
const outDir = workspace.brandRoot;
mkdirSync(outDir, {recursive: true});

const baseProps = {
  brandId: 'practicalsystems',
  tagline: 'The AI company that runs in public.',
  cta: 'Watch it run live at practicalsystems.io',
  command: null,
  heroImage: null,
  loopSequence: null,
  loopFrames: 1,
};

// Static still: bar-free (a frozen scrubber mid-fill reads as a broken
// control, not a design element -- same call as costclaw/sidetap's
// og-props-static.json).
const staticPropsPath = join(outDir, 'og-props-static.json');
writeFileSync(staticPropsPath, JSON.stringify({...baseProps, showFloatBar: false}));

// Animated loop: default showFloatBar (true) -- motion is fine on the loop.
const propsPath = join(outDir, 'og-props.json');
writeFileSync(propsPath, JSON.stringify(baseProps));

console.log('still: og.png (native 1200x630 -- no --width/--height, no-op flags per PLAYBOOK.md)');
remotion(['still', 'AnimatedOG', join(outDir, 'og.png'), `--props=${staticPropsPath}`, `--public-dir=${workspace.publicDir}`]);

remotion(['render', 'AnimatedOG', join(outDir, 'og.mp4'), `--props=${propsPath}`, `--public-dir=${workspace.publicDir}`]);

remotion([
  'render',
  'AnimatedOG',
  join(outDir, 'og.gif'),
  `--props=${propsPath}`,
  `--public-dir=${workspace.publicDir}`,
  '--codec=gif',
  '--every-nth-frame=2',
]);

remotion([
  'render',
  'AnimatedOG',
  join(outDir, 'readme.gif'),
  `--props=${propsPath}`,
  `--public-dir=${workspace.publicDir}`,
  '--codec=gif',
  '--every-nth-frame=2',
  '--scale=0.5',
]);

const README_GIF_BUDGET_BYTES = 5 * 1024 * 1024; // scripts/check-budgets.mjs hard gate
const readmeGifBytes = statSync(join(outDir, 'readme.gif')).size;
console.log(`readme.gif: ${(readmeGifBytes / 1024 / 1024).toFixed(2)}MB (budget ${README_GIF_BUDGET_BYTES / 1024 / 1024}MB)`);
if (readmeGifBytes > README_GIF_BUDGET_BYTES) {
  console.error('OVER BUDGET -- bump --every-nth-frame (must divide 240 evenly) or lower --scale further');
  process.exit(1);
}

console.log('statics OK: og.png, og.mp4, og.gif, readme.gif in out/practicalsystems/');
