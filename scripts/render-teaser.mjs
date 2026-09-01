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
import {execSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {dirname, extname, join} from 'node:path';
import {fileURLToPath} from 'node:url';

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

const norm = (h) => {
  h = h.trim().toLowerCase();
  if (!h.startsWith('#')) h = '#' + h;
  if (h.length === 4) h = '#' + [...h.slice(1)].map((c) => c + c).join('');
  if (!/^#[0-9a-f]{6}$/.test(h)) throw new Error('bad hex ' + h);
  return h;
};
const mix = (a, b, t) => {
  const pa = [1, 3, 5].map((i) => parseInt(a.slice(i, i + 2), 16));
  const pb = [1, 3, 5].map((i) => parseInt(b.slice(i, i + 2), 16));
  return '#' + pa.map((v, i) => Math.round(v + (pb[i] - v) * t).toString(16).padStart(2, '0')).join('');
};
const luminance = (h) => {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(h.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};

const id = need('id').toLowerCase().replace(/[^a-z0-9-]/g, '-');
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
const pubDir = join(root, 'studio', 'public', 'teasers', id);
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
  const svg = readFileSync(logoFile, 'utf8');
  const fills = [...svg.matchAll(/(?:fill|stroke|stop-color)\s*[:=]\s*["']?(#[0-9a-fA-F]{3,6})/g)]
    .map((m) => norm(m[1]))
    .filter((h) => h !== '#000000' && h !== '#ffffff');
  const lum = fills.length ? fills.reduce((s, h) => s + luminance(h), 0) / fills.length : null;
  theme = lum !== null && lum < 0.2 ? 'light' : 'dark';
  console.log(`logo colors: ${fills.length} sampled, mean luminance ${lum === null ? 'n/a' : lum.toFixed(3)}, ground=${theme}`);
}
const dark = theme !== 'light';

// --bg overrides the derived ground with the site's own (paid.ai is dark green,
// not near-black); the neutral ramp still derives from it.
const bg = args.bg ? norm(args.bg) : dark ? mix('#0e1014', accent, 0.06) : mix('#f7f8fa', accent, 0.03);
const ink = dark ? '#fafafa' : '#14181d';
const colors = {
  bg,
  surface: mix(bg, ink, 0.04),
  surface2: mix(bg, ink, 0.08),
  line: mix(bg, ink, 0.14),
  ink,
  ink2: mix(ink, bg, 0.25),
  ink3: mix(ink, bg, 0.45),
  brand: accent,
  profit: dark ? mix(accent, '#ffffff', 0.25) : mix(accent, '#000000', 0.2),
  safe: '#22c55e',
  loss: '#ef4444',
  info: '#3b82f6',
  rare: '#eab308',
};
// The CTA line is set in `profit`; keep it legible against the ground.
if (dark && luminance(colors.profit) < 0.25) colors.profit = mix(accent, '#ffffff', 0.5);
if (!dark && luminance(colors.profit) > 0.35) colors.profit = mix(accent, '#000000', 0.45);

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

const outDir = join(root, 'out', 'teasers', id);
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

const run = (cmd) => execSync(cmd, {cwd: join(root, 'studio'), stdio: 'inherit'});
const t0 = Date.now();
if (args.still === 'true') {
  const still = join(outDir, 'still.png');
  run(`npx remotion still AnimatedOG "${still}" --props="${propsPath}" --frame=60`);
  console.log(`still OK: ${still} (${Math.round((Date.now() - t0) / 1000)}s)`);
  process.exit(0);
}
run(`npx remotion render AnimatedOG "${join(outDir, 'og.mp4')}" --props="${propsPath}"`);
if (args.gif === 'true') {
  run(`npx remotion render AnimatedOG "${join(outDir, 'og.gif')}" --props="${propsPath}" --codec=gif --every-nth-frame=2 --scale=0.5`);
}
console.log(`teaser OK: ${outDir} (${Math.round((Date.now() - t0) / 1000)}s)`);
