// Tournament #28 — hero-take variants: N renders of one asset, each varying ONE
// brand-safe MOTION knob (never colors — voice rules are absolute). Take 1 is
// always the brand's own motion values (no override) so it doubles as the control.
// Motion overrides ride the `motionOverride` prop added to LogoReveal/LaunchVideo
// (studio/src/lib/brand.ts's motionOverrideSchema); see PLAYBOOK "nullable prop
// overrides" precedent (formatWidth/formatHeight).
//
// Usage: node scripts/render-variants.mjs <brand> <logo-reveal|launch-hook> [--takes N]
//   logo-reveal   full LogoReveal comp, N<=3 takes (cheapest comp).
//   launch-hook   LaunchVideo's hook act only (same --frames trick as
//                 render-hook-variants.mjs), N<=3 takes, headline unchanged.
// Outputs: out/<brand>/marketing/variants/<asset>-v<n>.mp4 + posters, registered
// via registerVariants(brand, asset, ...).
import {existsSync, readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, relative} from 'node:path';
import {posterFor, registerVariants, renderTake} from './lib/takes.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const argv = process.argv.slice(2);
const positional = argv.filter((a) => !a.startsWith('--'));
const [brand, asset] = positional;
const takesIdx = argv.indexOf('--takes');
const takes = takesIdx >= 0 ? parseInt(argv[takesIdx + 1], 10) : 3;

if (!brand || !asset) {
  console.error('usage: node scripts/render-variants.mjs <brand> <logo-reveal|launch-hook> [--takes N]');
  process.exit(1);
}
if (asset !== 'logo-reveal' && asset !== 'launch-hook') {
  console.error(`render-variants: unknown asset "${asset}" (expected logo-reveal|launch-hook)`);
  process.exit(1);
}
if (!Number.isFinite(takes) || takes < 1 || takes > 3) {
  console.error('render-variants: --takes must be between 1 and 3');
  process.exit(1);
}

const launchPath = join(root, 'props', `${brand}-launch.json`);
if (!existsSync(launchPath)) {
  console.error(`render-variants: missing ${launchPath}`);
  process.exit(1);
}
const launch = JSON.parse(readFileSync(launchPath, 'utf8'));

// Read brands/<brand>.json directly rather than importing studio/src/lib/brand.ts:
// that module imports brand JSON with a bundler-style `import x from './x.json'`
// (no `with {type: 'json'}` attribute), which plain Node ESM rejects
// (ERR_IMPORT_ATTRIBUTE_MISSING) — unlike launchTiming.ts (judge-av-sync.mjs's
// type-stripping precedent), which has no JSON imports. brands/<id>.json's motion
// block is always fully populated (zod .default() only fills genuinely absent
// fields), so this is the same values getBrand() would return.
const brandPath = join(root, 'brands', `${brand}.json`);
if (!existsSync(brandPath)) {
  console.error(`render-variants: missing ${brandPath}`);
  process.exit(1);
}
const brandJson = JSON.parse(readFileSync(brandPath, 'utf8'));

const clamp01 = (v) => Math.min(1, Math.max(0, v));

// Brand-safe motion knobs per take (index 0 = control, no override). Each `override`
// is a function of the brand's own motion so the delta is relative, not absolute.
const LOGO_TAKES = [
  {label: 'brand default', override: null},
  // Floor at 0.65: below ~0.55 the spring stays overdamped and a +0.25 delta on a
  // low-exuberance brand renders byte-identical to the control (verified at exuberance 0.15).
  {label: 'exuberant', override: (m) => ({exuberance: clamp01(Math.max(0.65, m.exuberance + 0.25))})},
  {label: 'slow-luxe (tempo 0.85)', override: () => ({tempo: 0.85})},
];
const HOOK_TAKES = [
  {label: 'brand default', override: null},
  {label: 'settle +0.25', override: (m) => ({settle: clamp01(m.settle + 0.25)})},
  {label: 'parallax +0.25', override: (m) => ({parallax: clamp01(m.parallax + 0.25)})},
];

async function main() {
  const takeDefs = (asset === 'logo-reveal' ? LOGO_TAKES : HOOK_TAKES).slice(0, takes);

  let comp;
  let baseProps;
  let frames;
  if (asset === 'logo-reveal') {
    comp = 'LogoReveal';
    baseProps = {
      brandId: brand,
      sequence: launch.assets?.logoSequence ?? null,
      frameCount: launch.assets?.logoFrames ?? 90,
      cta: launch.cta ?? '',
    };
  } else {
    comp = 'LaunchVideo';
    const timingMod = await import(new URL('../studio/src/lib/launchTiming.ts', import.meta.url));
    const timing = timingMod.launchTiming(launch.demo?.telemetry?.durationMs ?? null, (launch.features ?? []).length);
    frames = `${timing.hook.from}-${timing.hook.from + timing.hook.len - 1}`;
    baseProps = {...launch, formatWidth: 1920, formatHeight: 1080};
  }

  const outDir = join(root, 'out', brand, 'marketing', 'variants');
  const variants = [];
  takeDefs.forEach((def, i) => {
    const n = i + 1;
    const motionOverride = def.override ? def.override(brandJson.motion) : null;
    const props = {...baseProps, motionOverride};
    const outPath = join(outDir, `${asset}-v${n}.mp4`);
    const {path, bytes} = renderTake({comp, outPath, props, frames});
    const posterPath = posterFor(outPath);
    const relPath = relative(root, path).replace(/\\/g, '/');
    const relPoster = relative(root, posterPath).replace(/\\/g, '/');
    variants.push({id: `${asset}-v${n}`, path: relPath, label: def.label});
    console.log(`render-variants: ${asset}-v${n} (${def.label}) -> ${relPath} (${bytes} bytes); poster ${relPoster}`);
  });

  const registered = registerVariants(brand, asset, variants);
  console.log(
    registered
      ? `render-variants: registered ${variants.length} variant(s) on asset "${asset}" in run.json`
      : `render-variants: no matching "${asset}" asset in run.json — skipped manifest registration`,
  );
}

main();
