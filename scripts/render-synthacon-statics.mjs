// Renders the Synthacon AnimatedOG static-plus exports: og.png (native 1200x630
// OG/Twitter/GitHub social-preview size), the bonus 8s animated loop (og.mp4/
// og.gif), and a README-sized gif. No hero image or background loop is staged
// for this brand (no Blender/ComfyUI assets in this dry run) — brand.effects.wash
// (0.1, brands/synthacon.json) drives the flat procedural backdrop, the
// spec-compliant look, not a placeholder to fill in later.
//
// Tagline/CTA are read from out/synthacon/marketing/brief.json (hook.headline,
// cta) — same Content Brief overlay convention as build-launch-props.mjs and
// build-synthacon-demo-props.mjs. A missing/invalid brief falls back to the
// hardcoded copy below so this script stays runnable on a clean clone.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'out', 'synthacon');
mkdirSync(outDir, {recursive: true});

const props = {
  brandId: 'synthacon',
  tagline: 'Buy, sell, and rent studio and music gear',
  cta: 'Join the beta at synthacon.com',
  heroImage: null,
  loopSequence: null,
  loopFrames: 1,
};

const briefPath = join(root, 'out', 'synthacon', 'marketing', 'brief.json');
if (existsSync(briefPath)) {
  const brief = validBrief(readFileSync(briefPath, 'utf8'));
  if (!brief) {
    console.warn('render-synthacon-statics: out/synthacon/marketing/brief.json is invalid; using hardcoded copy');
  } else {
    if (brief.headline) props.tagline = brief.headline;
    if (brief.cta) props.cta = brief.cta;
  }
}

const propsPath = join(outDir, 'og-props.json');
writeFileSync(propsPath, JSON.stringify(props));

const studioDir = join(root, 'studio');

// The AnimatedOG mark slot plays the LOOPING Connect reveal (revealLoopTiming):
// at frame 0 the S is fully UN-drawn (dashoffset 100, terminals hidden), so a
// frame-0 still would carry NO mark at all. Render the og.png still at the
// lockup hold inside cycle 1 instead: the top terminal settles at t=0.58 and
// the group fade-out starts at t=0.84 (studio/src/lib/revealTiming.ts), so
// t=0.7 sits mid-hold — fully drawn, group opacity 1. The frame is derived from
// the reveal cycle math, loopCycleFrames(fps, tempo) = round(fps * DURATION_S /
// tempo): DURATION_S (2.8s) and AnimatedOG's fps (30, Root.tsx) are restated
// here because this script runs outside the studio TS bundle; tempo is read
// from the brand JSON so a tempo retune keeps the still inside the hold window.
const REVEAL_DURATION_S = 2.8; // mirrors revealTiming.ts DURATION_S
const OG_FPS = 30; // mirrors Root.tsx's AnimatedOG fps
const brandJson = JSON.parse(readFileSync(join(root, 'brands', 'synthacon.json'), 'utf8'));
const cycleFrames = Math.round((OG_FPS * REVEAL_DURATION_S) / (brandJson.motion?.tempo ?? 1));
const stillFrame = Math.round(0.7 * cycleFrames);

const still = (out, width, height) => {
  console.log(`still: ${out} (${width}x${height}, frame ${stillFrame})`);
  execSync(
    `npx remotion still AnimatedOG "${join(outDir, out)}" --props="${propsPath}" --width=${width} --height=${height} --frame=${stillFrame}`,
    {cwd: studioDir, stdio: 'inherit'},
  );
};

const render = (args, out) => {
  console.log(`render: ${out}`);
  execSync(`npx remotion render AnimatedOG "${join(outDir, out)}" --props="${propsPath}" ${args}`, {
    cwd: studioDir,
    stdio: 'inherit',
  });
};

// Native AnimatedOG size (og:image / Twitter card standard).
still('og.png', 1200, 630);

// Bonus animated OG loop (recipe default) + README-sized gif.
render('', 'og.mp4');
render('--codec=gif --every-nth-frame=2', 'og.gif');
render('--codec=gif --every-nth-frame=2 --scale=0.5', 'readme.gif');

console.log('statics OK: og.png, og.mp4, og.gif, readme.gif in out/synthacon/');

// Returns {headline, cta} if the parsed brief structurally matches brief.ts's
// copy fields, else null — mirrors build-launch-props.mjs's validBrief (only the
// fields this script consumes are validated).
function validBrief(text) {
  let b;
  try {
    b = JSON.parse(text);
  } catch {
    return null;
  }
  if (!b || typeof b !== 'object') return null;
  if (typeof b.brandId !== 'string' || b.brandId.length === 0) return null;
  const hook = b.hook ?? {headline: ''};
  if (typeof hook.headline !== 'string') return null;
  if (b.cta != null && typeof b.cta !== 'string') return null;
  return {headline: hook.headline, cta: typeof b.cta === 'string' ? b.cta : ''};
}
