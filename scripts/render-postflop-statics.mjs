// Postflop OG statics: og.png (native 1200x630 still), the 8s animated
// og.mp4/og.gif loop, and readme.gif (600x315, per SKILL.md dims -- same
// loop scaled down, PLAYBOOK "scale down for READMEs"). No ComfyUI hero
// (ComfyUI unreachable on :8000/:8188, procedural fallback is spec-compliant
// per the og-assets skill) and no Blender background_loop staged for this
// brand (only assets/postflop/logo-reveal / studio/public/postflop/
// logo-reveal exist) -- effects.wash and effects.glow are both 0 (BONE &
// RULE: zero glow/wash/gradient), so the flat procedural backdrop is the
// spec-compliant look, not a fallback to fill in later.
//
// Copy is locked verbatim from out/postflop/marketing/brief.json: hook.headline
// -> tagline prop (fits one line at fontSize 30, same length class as
// practicalsystems' tagline in the same template slot); cta prop is the brief's
// top-level `cta` field verbatim, unmodified -- it already reads as a complete
// CTA sentence with no domain to fold in (unlike noban/tenwords/practicalsystems,
// whose cta strings are "<verb phrase> at <domain>"). This is also exactly the
// CTA text baked into the already-approved end-card lockup
// (out/postflop/stills/social-x-post-c.png), which this OG static is told to
// echo -- that frame has no separate URL/domain line, so none is added here.
// No command chip -- the CTA points at the workbench, not a shell command.
//
// `ctaStyle: 'block'` (postflop.json) makes AnimatedOG render the mark in ink
// and the CTA as a filled yellow block with black text, per the guarded fix in
// studio/src/templates/AnimatedOG.tsx (mirrors EndCard.tsx's existing contract;
// every other brand defaults to 'text' and renders byte-identically).
//
// PLAYBOOK.md: `--width`/`--height` on `npx remotion still`/`render` are
// no-ops in Remotion 4.0.486. Not needed here anyway -- AnimatedOG's
// composition is already native 1200x630 (Root.tsx), so the plain `still`
// command below delivers the exact OG size with no flag.
import {mkdirSync, statSync, writeFileSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'out', 'postflop');
mkdirSync(outDir, {recursive: true});

const studioDir = join(root, 'studio');

const baseProps = {
  brandId: 'postflop',
  tagline: 'Your solver is grading its own homework.',
  cta: 'Solve your first spot in the browser. Nothing to install.',
  command: null,
  heroImage: null,
  loopSequence: null,
  loopFrames: 1,
};

// Static still: bar-free (a frozen scrubber mid-fill reads as a broken
// control, not a design element -- same call as costclaw/sidetap/
// practicalsystems/tenwords).
const staticPropsPath = join(outDir, 'og-props-static.json');
writeFileSync(staticPropsPath, JSON.stringify({...baseProps, showFloatBar: false}));

// Animated loop: default showFloatBar (true) -- progressFill is line->ink for
// this brand (postflop.json), so the bar renders in ink tones, never yellow.
const propsPath = join(outDir, 'og-props.json');
writeFileSync(propsPath, JSON.stringify(baseProps));

console.log('still: og.png (native 1200x630 -- no --width/--height, no-op flags per PLAYBOOK.md)');
execSync(`npx remotion still AnimatedOG "${join(outDir, 'og.png')}" --props="${staticPropsPath}"`, {
  cwd: studioDir,
  stdio: 'inherit',
});

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

console.log('render: readme.gif');
execSync(
  `npx remotion render AnimatedOG "${join(outDir, 'readme.gif')}" --props="${propsPath}" --codec=gif --every-nth-frame=2 --scale=0.5`,
  {cwd: studioDir, stdio: 'inherit'},
);

const README_GIF_BUDGET_BYTES = 5 * 1024 * 1024; // scripts/check-budgets.mjs hard gate
const readmeGifBytes = statSync(join(outDir, 'readme.gif')).size;
console.log(`readme.gif: ${(readmeGifBytes / 1024 / 1024).toFixed(2)}MB (budget ${README_GIF_BUDGET_BYTES / 1024 / 1024}MB)`);
if (readmeGifBytes > README_GIF_BUDGET_BYTES) {
  console.error('OVER BUDGET -- bump --every-nth-frame (must divide 240 evenly) or lower --scale further');
  process.exit(1);
}

console.log('statics OK: og.png, og.mp4, og.gif, readme.gif in out/postflop/');
