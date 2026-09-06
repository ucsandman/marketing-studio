// Still-first contact sheet: renders act-boundary (or evenly-spaced fallback)
// stills for one composition and tiles them into a single self-contained review
// page. Operationalizes the PLAYBOOK rule "inspect stills at act boundaries
// BEFORE full renders" into one standard, repeatable artifact instead of ad hoc
// frame-picking per asset skill.
//
// Usage: node scripts/contact-sheet.mjs <brand> <Comp> --project <product-repo> [--props <path>]
//        node scripts/contact-sheet.mjs <brand> --project <product-repo> --plan <production-plan.json> --render <final.mp4>
//   <Comp> one of: LaunchVideo | SocialClip | ProductDemo | LogoReveal | AnimatedOG
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
//   ProductDemo   props/<brand>-demo.json
//   LogoReveal    props/<brand>-logo-reveal.json
//   AnimatedOG    props/<brand>-og.json
//
// Outputs under <product-repo>/marketing/assets/<brand>/marketing/stills/:
//   <Comp>-<label>.png   one per selected frame
//   <Comp>-sheet.html    self-contained review page
// Importing launchTiming.ts directly (below) prints a one-line, non-fatal
// MODULE_TYPELESS_PACKAGE_JSON note to stderr on Node's native TS loader;
// studio/package.json is intentionally left untouched (out of scope here).

import {execFileSync, execSync} from 'node:child_process';
import {existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, relative} from 'node:path';
import {loadProductionBundle, measurePng, sha256File} from './lib/production-quality.mjs';
import {projectArg, resolveWorkspace, resolveWorkspacePath} from './lib/workspace.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const engineRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const studio = join(engineRoot, 'studio');

const COMPS = new Set(['LaunchVideo', 'SocialClip', 'ProductDemo', 'LogoReveal', 'AnimatedOG']);

// ---- args --------------------------------------------------------------------
const argv = process.argv.slice(2);
const propsIdx = argv.indexOf('--props');
const propsOverride = propsIdx >= 0 ? argv[propsIdx + 1] : null;
const optionValue = (name) => {
  const i = argv.indexOf(name);
  const inline = argv.find((arg) => arg.startsWith(`${name}=`));
  return i >= 0 ? argv[i + 1] : inline?.slice(name.length + 1) ?? null;
};
const optionNames = new Set(['--props', '--plan', '--render', '--project', '--evidence', '--sheet', '--stills-dir']);
const positional = argv.filter((a, i) => !a.startsWith('--') && !optionNames.has(argv[i - 1]));
const [brand, comp] = positional;
let workspace;
try {
  workspace = resolveWorkspace(engineRoot, {brand, project: projectArg(argv)});
} catch (err) {
  console.error(`contact-sheet: ${err.message}`);
  process.exit(1);
}

const productionRender = optionValue('--render');
if (brand && productionRender) {
  await buildProductionSheet(brand, optionValue('--plan') ?? join(workspace.marketingDir, 'production-plan.json'), productionRender);
  process.exit(0);
}

if (!brand || !comp) {
  console.error('usage: node scripts/contact-sheet.mjs <brand> <Comp> --project <product-repo> [--props <path>]');
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
    const p = resolveWorkspacePath(workspace, propsOverride);
    if (!existsSync(p)) {
      console.error(`contact-sheet: --props path does not exist: ${p}`);
      process.exit(1);
    }
    return p;
  }
  if (comp === 'LaunchVideo') return requireProps(join(workspace.propsDir, `${brand}-launch.json`));
  if (comp === 'ProductDemo') return requireProps(join(workspace.propsDir, `${brand}-demo.json`));
  if (comp === 'LogoReveal') return requireProps(join(workspace.propsDir, `${brand}-logo-reveal.json`));
  if (comp === 'AnimatedOG') return requireProps(join(workspace.propsDir, `${brand}-og.json`));
  // SocialClip — same resolution as render-matrix.mjs's resolveBase
  const direct = join(workspace.propsDir, `${brand}-social-launch.json`);
  if (existsSync(direct)) return direct;
  const match = readdirSync(workspace.propsDir).find(
    (f) => f.startsWith(`${brand}-social-`) && f.endsWith('.json'),
  );
  if (!match) {
    console.error(
      `contact-sheet: missing props for SocialClip (props/${brand}-social-*.json); pass --props to override`,
    );
    process.exit(1);
  }
  return join(workspace.propsDir, match);
}

const propsPath = resolveProps();
const props = JSON.parse(readFileSync(propsPath, 'utf8'));

// ---- frame plan -----------------------------------------------------------
async function framePlan() {
  if (comp === 'LaunchVideo') {
    const mod = await import(new URL('../studio/src/lib/launchTiming.ts', import.meta.url));
    const telemetryMs = props.demo?.telemetry?.durationMs ?? null;
    const featureCount = Array.isArray(props.features) ? props.features.length : 0;
    const timing = mod.launchTiming(telemetryMs, featureCount, props.actLengths ?? null);
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
  return p.slice(workspace.projectRoot.length + 1).replaceAll('\\', '/');
}

async function buildProductionSheet(brandId, productionPlanPath, renderRaw) {
  const planPath = resolveWorkspacePath(workspace, productionPlanPath);
  const bundle = loadProductionBundle(workspace.projectRoot, brandId, planPath, {
    directionPath: join(workspace.marketingDir, 'direction.json'),
    shotPlanPath: join(workspace.marketingDir, 'shot-plan.json'),
  });
  if (bundle.findings.length || !bundle.shotPlan?.value) {
    const messages = bundle.findings.map((item) => item.message).join('; ');
    console.error(`contact-sheet: production sources are incomplete: ${messages || 'shot plan missing'}`);
    process.exit(1);
  }
  const shotPlan = bundle.shotPlan.value;
  const shots = Array.isArray(shotPlan.shots) ? shotPlan.shots : [];
  if (!shots.length) {
    console.error('contact-sheet: production shot plan contains 0 shots');
    process.exit(1);
  }
  const renderPath = resolveWorkspacePath(workspace, renderRaw);
  if (!renderPath || !existsSync(renderPath)) {
    console.error('contact-sheet: --render must name an existing file inside the repository');
    process.exit(1);
  }
  const fps = Number(shotPlan.fps ?? shotPlan.timing?.fps ?? 30);
  if (!Number.isFinite(fps) || fps <= 0) {
    console.error('contact-sheet: shot plan fps must be positive');
    process.exit(1);
  }
  const stillsDir = resolveWorkspacePath(workspace, optionValue('--stills-dir') ?? join(workspace.marketingDir, 'stills'));
  mkdirSync(stillsDir, {recursive: true});
  const samples = [];
  const safe = (value) => String(value).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-|-$/g, '') || 'shot';
  for (const shot of shots) {
    const from = Number(shot.from);
    const len = Number(shot.len ?? shot.durationFrames);
    if (!Number.isFinite(from) || !Number.isFinite(len) || len <= 0) {
      console.error(`contact-sheet: ${shot.id ?? 'shot'} has invalid from/len`);
      process.exit(1);
    }
    const frames = {
      start: Math.round(from + Math.min(2, Math.max(0, len - 1))),
      middle: Math.round(from + Math.max(0, len - 1) / 2),
      end: Math.round(from + Math.max(0, len - 1 - Math.min(2, Math.max(0, len - 1)))),
    };
    for (const [phase, frame] of Object.entries(frames)) {
      const file = `Production-${safe(shot.id)}-${phase}.png`;
      const imagePath = join(stillsDir, file);
      execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-ss', (frame / fps).toFixed(6), '-i', renderPath, '-frames:v', '1', imagePath], {stdio: 'inherit'});
      if (!existsSync(imagePath)) {
        console.error(`contact-sheet: ffmpeg did not produce ${relToRoot(imagePath)}`);
        process.exit(1);
      }
      samples.push({
        shotId: shot.id,
        phase,
        frame,
        timeSec: Number((frame / fps).toFixed(3)),
        imagePath: relToRoot(imagePath),
        imageSha256: sha256File(imagePath),
        annotations: {
          purpose: shot.purpose,
          scale: shot.scale,
          camera: shot.camera?.cadence,
          transition: shot.transition?.kind,
          transitionFrames: shot.transition?.frames,
          maxChars: shot.onScreenText?.maxChars,
          minHoldFrames: shot.onScreenText?.minHoldFrames,
          safeArea: shot.readability?.safeArea,
          minContrast: shot.readability?.minContrast,
          hero: shot.hero === true,
          endingHoldFrames: shot.endingHoldFrames ?? 0,
          references: shot.references ?? [],
        },
        metrics: measurePng(imagePath),
      });
      console.log(`contact-sheet: ${shot.id} ${phase} frame=${frame} -> ${relToRoot(imagePath)}`);
    }
  }
  const sheetPath = resolveWorkspacePath(workspace, optionValue('--sheet') ?? join(stillsDir, 'Production-sheet.html'));
  mkdirSync(dirname(sheetPath), {recursive: true});
  const grouped = shots.map((shot) => ({shot, samples: samples.filter((sample) => sample.shotId === shot.id)}));
  const cells = grouped.map(({shot, samples: shotSamples}) => `
    <section class="shot">
      <header><h2>${escapeHtml(shot.id)}</h2><p>${escapeHtml(shot.purpose)} · ${escapeHtml(shot.scale)} · camera ${escapeHtml(shot.camera?.cadence)} · ${escapeHtml(shot.transition?.kind)} ${escapeHtml(shot.transition?.frames)}f</p></header>
      <div class="strip">${shotSamples.map((sample) => `<figure><img src="${escapeHtml(relative(dirname(sheetPath), resolveWorkspacePath(workspace, sample.imagePath)).replaceAll('\\', '/'))}" alt="${escapeHtml(shot.id)} ${sample.phase}"><figcaption>${sample.phase} · f${sample.frame} · ${sample.timeSec}s<br>luma ${sample.metrics.meanLuma} · contrast ${sample.metrics.contrastSpan} · edges ${(sample.metrics.edgeOccupancy * 100).toFixed(2)}%</figcaption></figure>`).join('')}</div>
      <p class="notes">Text: max ${escapeHtml(shot.onScreenText?.maxChars)} chars / ${escapeHtml(shot.onScreenText?.minHoldFrames)}f hold · safe area ${escapeHtml(shot.readability?.safeArea)} · min contrast ${escapeHtml(shot.readability?.minContrast)} · hero ${escapeHtml(shot.hero)} · ending hold ${escapeHtml(shot.endingHoldFrames)}f · refs ${escapeHtml((shot.references ?? []).join(', ') || 'none')}</p>
    </section>`).join('');
  const html = `<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(brandId)} production evidence</title>
<style>:root{color-scheme:dark}*{box-sizing:border-box}body{margin:0;background:#0d0f12;color:#e6e8eb;font:14px/1.45 system-ui,sans-serif}main{max-width:1600px;margin:auto;padding:24px}h1{font-size:20px}.sub,.notes{color:#9aa3ad}.shot{background:#14171b;border:1px solid #2b3138;border-radius:10px;margin:18px 0;overflow:hidden}.shot>header,.notes{padding:10px 14px}.shot h2,.shot p{margin:0}.strip{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:#2b3138}.strip figure{margin:0;background:#0a0c0e}.strip img{display:block;width:100%;height:auto}.strip figcaption{padding:8px 10px;color:#c9d1d9;font-size:12px}@media(max-width:700px){.strip{grid-template-columns:1fr}}</style>
<main><h1>${escapeHtml(brandId)} · production evidence</h1><p class="sub">${shots.length} shots · ${samples.length} rendered samples · start/middle/end from ${escapeHtml(relToRoot(renderPath))}</p>${cells}</main>`;
  writeFileSync(sheetPath, html);
  const evidence = {
    version: 1,
    generatedAt: new Date().toISOString(),
    productionPlanPath: relToRoot(bundle.manifestPath),
    planSha256: bundle.productionPlanSha256,
    sourceBundleSha256: bundle.sourceBundleSha256,
    shotPlanPath: relToRoot(bundle.shotPlan.path),
    shotPlanSha256: bundle.shotPlan.sha256,
    renderPath: relToRoot(renderPath),
    renderSha256: sha256File(renderPath),
    renderBytes: statSync(renderPath).size,
    fps,
    shots: shots.length,
    sampleCount: samples.length,
    sheetPath: relToRoot(sheetPath),
    samples,
  };
  const evidencePath = resolveWorkspacePath(workspace, optionValue('--evidence') ?? join(workspace.marketingDir, 'production-evidence.json'));
  mkdirSync(dirname(evidencePath), {recursive: true});
  writeFileSync(evidencePath, JSON.stringify(evidence, null, 2) + '\n');
  console.log(`contact-sheet OK: shots=${shots.length} samples=${samples.length} evidence=${relToRoot(evidencePath)} sheet=${relToRoot(sheetPath)}`);
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

const stillsDir = join(workspace.marketingDir, 'stills');
mkdirSync(stillsDir, {recursive: true});

const items = [];
for (const {label, frame} of plan) {
  const file = `${comp}-${label}.png`;
  const outFile = join(stillsDir, file);
  console.log(`contact-sheet: ${comp} frame ${frame} (${label}) -> ${relToRoot(outFile)}`);
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
