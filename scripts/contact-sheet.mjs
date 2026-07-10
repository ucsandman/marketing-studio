// Still-first contact sheet: renders act-boundary (or evenly-spaced fallback)
// stills for one composition and tiles them into a single self-contained review
// page. Operationalizes the PLAYBOOK rule "inspect stills at act boundaries
// BEFORE full renders" into one standard, repeatable artifact instead of ad hoc
// frame-picking per asset skill.
//
// Usage: node scripts/contact-sheet.mjs <brand> <Comp> [--props <path>]
//   <Comp> one of: LaunchVideo | SocialClip | LogoReveal | AnimatedOG
//
// Frame selection:
//   LaunchVideo   act boundaries from lib/launchTiming.ts (logo/hook/demo/
//                 feature-N/end), each sampled ~20 frames into the act. The
//                 act table is IMPORTED directly (Node's native TS type
//                 stripping), never re-derived — PLAYBOOK: "Duration math
//                 lives in ONE pure lib ... never duplicate the formula."
//   other comps   no act table; 5 evenly spaced frames across the comp's
//                 actual duration, resolved via `npx remotion compositions`
//                 (respects each comp's own calculateMetadata).
//
// Props resolution (default; override with --props <path relative to repo root>):
//   LaunchVideo   props/<brand>-launch.json
//   SocialClip    props/<brand>-social-launch.json, else first
//                 props/<brand>-social-*.json (same convention as
//                 render-matrix.mjs's resolveBase)
//   LogoReveal    props/<brand>-logo-reveal.json
//   AnimatedOG    props/<brand>-og.json
//
// Outputs:
//   out/<brand>/marketing/stills/<Comp>-<label>.png   one per selected frame
//   out/<brand>/marketing/stills/<Comp>-sheet.html     self-contained review page
// Importing launchTiming.ts directly (below) prints a one-line, non-fatal
// MODULE_TYPELESS_PACKAGE_JSON note to stderr on Node's native TS loader;
// studio/package.json is intentionally left untouched (out of scope here).

import {execSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const studio = join(root, 'studio');

const COMPS = new Set(['LaunchVideo', 'SocialClip', 'LogoReveal', 'AnimatedOG']);

// ---- args --------------------------------------------------------------------
const argv = process.argv.slice(2);
const propsIdx = argv.indexOf('--props');
const propsOverride = propsIdx >= 0 ? argv[propsIdx + 1] : null;
const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--props');
const [brand, comp] = positional;

if (!brand || !comp) {
  console.error('usage: node scripts/contact-sheet.mjs <brand> <Comp> [--props <path>]');
  process.exit(1);
}
if (!COMPS.has(comp)) {
  console.error(`contact-sheet: unknown composition '${comp}' (expected one of ${[...COMPS].join(', ')})`);
  process.exit(1);
}

// ---- props resolution ---------------------------------------------------------
function requireProps(p) {
  if (!existsSync(p)) {
    console.error(`contact-sheet: missing props for ${comp}: ${p} (pass --props to override)`);
    process.exit(1);
  }
  return p;
}

function resolveProps() {
  if (propsOverride) {
    const p = join(root, propsOverride);
    if (!existsSync(p)) {
      console.error(`contact-sheet: --props path does not exist: ${p}`);
      process.exit(1);
    }
    return p;
  }
  if (comp === 'LaunchVideo') return requireProps(join(root, 'props', `${brand}-launch.json`));
  if (comp === 'LogoReveal') return requireProps(join(root, 'props', `${brand}-logo-reveal.json`));
  if (comp === 'AnimatedOG') return requireProps(join(root, 'props', `${brand}-og.json`));
  // SocialClip — same resolution as render-matrix.mjs's resolveBase
  const direct = join(root, 'props', `${brand}-social-launch.json`);
  if (existsSync(direct)) return direct;
  const match = readdirSync(join(root, 'props')).find(
    (f) => f.startsWith(`${brand}-social-`) && f.endsWith('.json'),
  );
  if (!match) {
    console.error(
      `contact-sheet: missing props for SocialClip (props/${brand}-social-*.json); pass --props to override`,
    );
    process.exit(1);
  }
  return join(root, 'props', match);
}

const propsPath = resolveProps();
const props = JSON.parse(readFileSync(propsPath, 'utf8'));

// ---- frame plan -----------------------------------------------------------
async function framePlan() {
  if (comp === 'LaunchVideo') {
    const mod = await import(new URL('../studio/src/lib/launchTiming.ts', import.meta.url));
    const telemetryMs = props.demo?.telemetry?.durationMs ?? null;
    const featureCount = Array.isArray(props.features) ? props.features.length : 0;
    const timing = mod.launchTiming(telemetryMs, featureCount);
    const IN = 20; // boundary + ~20 frames in, per PLAYBOOK's act-boundary-stills rule
    const sample = (label, act) => ({label, frame: Math.min(act.from + IN, act.from + act.len - 1)});
    return [
      sample('logo', timing.logo),
      sample('hook', timing.hook),
      sample('demo', timing.demo),
      ...timing.features.map((act, i) => sample(`feature-${i + 1}`, act)),
      sample('end', timing.end),
    ];
  }
  // Fallback for comps with no act table: 5 evenly spaced frames.
  const duration = compositionDuration();
  const N = 5;
  return Array.from({length: N}, (_, i) => {
    const frame = Math.round((i * (duration - 1)) / (N - 1));
    return {label: `f${frame}`, frame};
  });
}

function compositionDuration() {
  let out;
  try {
    out = execSync(`npx remotion compositions src/index.ts --props="${propsPath}"`, {
      cwd: studio,
      encoding: 'utf8',
    });
  } catch (err) {
    console.error(`contact-sheet: 'remotion compositions' failed: ${err.message}`);
    process.exit(1);
  }
  const line = out.split('\n').find((l) => l.trim().startsWith(comp + ' '));
  if (!line) {
    console.error(`contact-sheet: could not find ${comp} in 'remotion compositions' output`);
    process.exit(1);
  }
  const m = line.match(/\s(\d+)\s*\(/);
  if (!m) {
    console.error(`contact-sheet: could not parse duration from: ${line}`);
    process.exit(1);
  }
  return parseInt(m[1], 10);
}

// ---- render + sheet ---------------------------------------------------------
function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}

function relToRoot(p) {
  return p.slice(root.length + 1).replaceAll('\\', '/');
}

function writeSheet(stillsDir, items) {
  const sheetPath = join(stillsDir, `${comp}-sheet.html`);
  const cells = items
    .map(
      (it) => `    <figure>
      <img src="${escapeHtml(it.file)}" alt="${escapeHtml(it.label)} (frame ${it.frame})" loading="lazy">
      <figcaption><span class="label">${escapeHtml(it.label)}</span><span class="frame">frame ${it.frame}</span></figcaption>
    </figure>`,
    )
    .join('\n');
  const html = `<!doctype html>
<meta charset="utf-8">
<title>Contact sheet — ${escapeHtml(brand)} / ${escapeHtml(comp)}</title>
<style>
  :root{color-scheme:dark;}
  *{box-sizing:border-box;}
  body{margin:0;background:#0d0f12;color:#e6e8eb;font-family:system-ui,-apple-system,Segoe UI,Roboto,Helvetica,Arial,sans-serif;}
  header{padding:20px 24px;border-bottom:1px solid #262b31;}
  header h1{margin:0;font-size:16px;font-weight:650;}
  header .sub{color:#8a929b;font-size:13px;margin-top:4px;}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:16px;padding:24px;max-width:1600px;margin:0 auto;}
  figure{margin:0;background:#14171b;border:1px solid #262b31;border-radius:10px;overflow:hidden;}
  figure img{display:block;width:100%;height:auto;background:#0a0c0e;}
  figcaption{display:flex;justify-content:space-between;padding:8px 12px;font-size:12px;color:#c9d1d9;border-top:1px solid #21262c;}
  figcaption .label{font-weight:600;}
  figcaption .frame{color:#7fb2ff;font-variant-numeric:tabular-nums;}
</style>
<header>
  <h1>Contact sheet · ${escapeHtml(brand)} / ${escapeHtml(comp)}</h1>
  <div class="sub">${items.length} stills · props: ${escapeHtml(relToRoot(propsPath))}</div>
</header>
<main class="grid">
${cells}
</main>
`;
  writeFileSync(sheetPath, html);
  return sheetPath;
}

const plan = await framePlan();
if (plan.length === 0) {
  console.error('contact-sheet: frame plan is empty');
  process.exit(1);
}

const stillsDir = join(root, 'out', brand, 'marketing', 'stills');
mkdirSync(stillsDir, {recursive: true});

const items = [];
for (const {label, frame} of plan) {
  const file = `${comp}-${label}.png`;
  const outFile = join(stillsDir, file);
  console.log(`contact-sheet: ${comp} frame ${frame} (${label}) -> out/${brand}/marketing/stills/${file}`);
  execSync(`npx remotion still ${comp} "${outFile}" --props="${propsPath}" --frame=${frame}`, {
    cwd: studio,
    stdio: 'inherit',
  });
  if (!existsSync(outFile)) {
    console.error(`FAILED: ${outFile} was not produced`);
    process.exit(1);
  }
  items.push({label, frame, file, bytes: statSync(outFile).size});
}

const sheetPath = writeSheet(stillsDir, items);
console.log(`contact-sheet OK: ${items.length} stills + sheet at ${relToRoot(sheetPath)}`);
