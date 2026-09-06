// Teaser lane: render an AnimatedOG loop for a company with no brand registry
// entry, from a logo file plus one accent color sampled from its public site.
// Neutrals are derived from the accent and a dark or light ground; the result is
// a full brandSchema object passed inline as `brandOverride`, so nothing is
// registered and the studio's brand registry is untouched.
//
//   node scripts/render-teaser.mjs --id=revefi --name=Revefi --site=revefi.com \
//     --logo=https://revefi.com/logo.svg --accent=#3b82f6 --theme=dark \
//     --tagline="AI DBA for your data platform" [--cta=revefi.com] \
//     [--showName=false] [--still] [--gif] [--date=2026-09-01]
//
// --still renders one frame (frame 60) to still.png for inspection and exits.
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, extname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
// Color math lives in lib/ so it is covered by `node --test scripts/lib/*.test.mjs`
// instead of hiding behind this script's fetch + execSync side effects.
import {remotion} from './lib/remotion.mjs';
import {groundFromLogoFills, norm, teaserColors} from './lib/teaser-colors.mjs';
import {projectArg, resolveWorkspace} from './lib/workspace.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = Object.fromEntries(
  process.argv.slice(2).map((a) => {
    const m = a.match(/^--([^=]+)=(.*)$/);
    return m ? [m[1], m[2]] : [a.replace(/^--/, ''), 'true'];
  }),
);
const need = (k) => {
  if (!args[k]) {
    console.error(`missing --${k}`);
    process.exit(2);
  }
  return args[k];
};

const id = need('id').toLowerCase().replace(/[^a-z0-9-]/g, '-');
const workspace = resolveWorkspace(root, {brand: id, project: projectArg(process.argv.slice(2))});
const name = need('name');
const site = need('site');
const logo = need('logo');
const accent = norm(need('accent'));
const tagline = args.tagline || site;
const cta = args.cta || site;
const showName = args.showName !== 'false';

// Fetch the logo first: an SVG's own fill colors decide the ground when --theme
// is not given (a navy wordmark on a navy ground is invisible; measured on the
// first render of this lane). Raster logos default to dark unless told otherwise.
const pubDir = join(workspace.publicDir, 'teasers', id);
mkdirSync(pubDir, {recursive: true});
let ext = extname(logo.split('?')[0]).toLowerCase();
if (!['.svg', '.png', '.webp', '.jpg', '.jpeg'].includes(ext)) ext = '.png';
const logoFile = join(pubDir, 'logo' + ext);
if (/^https?:/i.test(logo)) {
  const res = await fetch(logo, {headers: {'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)'}});
  if (!res.ok) throw new Error(`logo fetch ${res.status} ${logo}`);
  writeFileSync(logoFile, Buffer.from(await res.arrayBuffer()));
} else {
  if (!existsSync(logo)) throw new Error('logo not found ' + logo);
  writeFileSync(logoFile, readFileSync(logo));
}
let theme = args.theme;
if (!theme && ext === '.svg') {
  const ground = groundFromLogoFills(readFileSync(logoFile, 'utf8'));
  theme = ground.theme;
  const lum = ground.meanLuminance === null ? 'n/a' : ground.meanLuminance.toFixed(3);
  console.log(`logo colors: ${ground.sampled} sampled, mean luminance ${lum}, ground=${theme}`);
}
const dark = theme !== 'light';

// --bg overrides the derived ground with the site's own (paid.ai is dark green,
// not near-black); the neutral ramp still derives from it, and the CTA line is
// lifted or darkened until it is legible against that ground.
const colors = teaserColors({accent, dark, bg: args.bg ?? null});

const brand = {
  id,
  name,
  tagline,
  url: site,
  colors,
  fonts: {display: 'Inter', body: 'Inter', mono: 'JetBrains Mono'},
  effects: {wash: 0.14, glow: 0.3},
  voice: `Teaser lane. Accent sampled from ${site} on ${args.date || 'an unrecorded date'}; neutrals derived. Not a registered brand, never reused for another asset without onboarding.`,
};

const outDir = workspace.brandRoot;
mkdirSync(outDir, {recursive: true});
const props = {
  brandId: id,
  tagline,
  cta,
  command: null,
  heroImage: null,
  loopSequence: null,
  loopFrames: 240,
  showFloatBar: true,
  brandOverride: brand,
  logoImage: `teasers/${id}/logo${ext}`,
  showName,
};
const propsPath = join(outDir, 'og-props.json');
writeFileSync(propsPath, JSON.stringify(props, null, 1));
writeFileSync(join(outDir, 'brand.json'), JSON.stringify(brand, null, 1));

const run = (args) => remotion([...args, `--public-dir=${workspace.publicDir}`]);
const t0 = Date.now();
if (args.still === 'true') {
  const still = join(outDir, 'still.png');
  run(['still', 'AnimatedOG', still, `--props=${propsPath}`, '--frame=60']);
  console.log(`still OK: ${still} (${Math.round((Date.now() - t0) / 1000)}s)`);
  process.exit(0);
}
run(['render', 'AnimatedOG', join(outDir, 'og.mp4'), `--props=${propsPath}`]);
if (args.gif === 'true') {
  run(['render', 'AnimatedOG', join(outDir, 'og.gif'), `--props=${propsPath}`, '--codec=gif', '--every-nth-frame=2', '--scale=0.5']);
}
console.log(`teaser OK: ${outDir} (${Math.round((Date.now() - t0) / 1000)}s)`);
