// Storyboard approval board: renders out/<brand>/marketing/brief.json (the WHOLE
// derived story — hook, features, narration, social, CTA) as one self-contained
// HTML page so the operator reviews content BEFORE an hour of rendering commits
// to it. Read-only: never writes brief.json, never touches props/ or studio/.
//
//   node scripts/build-storyboard.mjs <brandId>
//
// Missing out/<brand>/marketing/brief.json is a loud error (exit 1) — the
// derive/synthesis phase (derive-brief.mjs + agent synthesis) hasn't run yet.
import {readFileSync, existsSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

function fail(msg) {
  console.error(`build-storyboard: ${msg}`);
  process.exit(1);
}

const brandId = process.argv[2];
if (!brandId) fail('missing <brandId> (usage: build-storyboard.mjs <brandId>)');

// --- load brief.json ------------------------------------------------------
const briefPath = join(root, 'out', brandId, 'marketing', 'brief.json');
if (!existsSync(briefPath)) {
  fail(
    `out/${brandId}/marketing/brief.json not found. Run the derive/synthesis phase first ` +
      `(node scripts/derive-brief.mjs ${brandId} <productRepoPath> then have the agent synthesize brief.json).`,
  );
}

let briefRaw;
try {
  briefRaw = JSON.parse(readFileSync(briefPath, 'utf8'));
} catch (err) {
  fail(`out/${brandId}/marketing/brief.json is not valid JSON: ${err.message}`);
}

// Structural check mirroring studio/src/lib/brief.ts (the canonical zod schema).
// Same convention as build-launch-props.mjs's validBrief: plain JS re-check of
// the shape, defaults applied by hand since this script has no zod dependency.
function validateBrief(b) {
  if (!b || typeof b !== 'object') return null;
  if (typeof b.brandId !== 'string' || b.brandId.length === 0) return null;

  const hookIn = b.hook ?? {};
  if (b.hook != null && typeof b.hook.headline !== 'string') return null;
  const hook = {
    headline: typeof hookIn.headline === 'string' ? hookIn.headline : '',
    altHeadlines: Array.isArray(hookIn.altHeadlines) ? hookIn.altHeadlines.filter((s) => typeof s === 'string') : [],
  };

  const featuresIn = Array.isArray(b.features) ? b.features : [];
  const features = [];
  for (const f of featuresIn) {
    if (!f || typeof f !== 'object') return null;
    if (typeof f.heading !== 'string') return null;
    if (!Array.isArray(f.benefitLines) || f.benefitLines.length > 3) return null;
    if (!f.benefitLines.every((l) => typeof l === 'string')) return null;
    features.push({
      key: typeof f.key === 'string' ? f.key : '',
      heading: f.heading,
      benefitLines: f.benefitLines,
      rationale: typeof f.rationale === 'string' ? f.rationale : '',
      sourceRoute: typeof f.sourceRoute === 'string' ? f.sourceRoute : null,
    });
  }

  const positioning =
    b.positioning && typeof b.positioning === 'object' && typeof b.positioning.differentiator === 'string'
      ? {differentiator: b.positioning.differentiator}
      : null;

  const cta = typeof b.cta === 'string' ? b.cta : '';

  const narrationIn = Array.isArray(b.narration) ? b.narration : [];
  const narration = [];
  for (const n of narrationIn) {
    if (!n || typeof n.act !== 'string' || typeof n.text !== 'string') return null;
    narration.push({act: n.act, text: n.text});
  }

  let social = null;
  if (b.social && typeof b.social === 'object') {
    const platform = (p) => {
      if (p == null) return null;
      if (typeof p.hook !== 'string' || typeof p.headline !== 'string') return null;
      return {hook: p.hook, headline: p.headline};
    };
    social = {x: platform(b.social.x), linkedin: platform(b.social.linkedin), vertical: platform(b.social.vertical)};
  }

  // Grounding sections (brief.ts additions, all optional) — lenient projection:
  // malformed entries are dropped, never fatal, since they are approval context
  // rather than render inputs.
  const audience =
    b.audience && typeof b.audience === 'object' && typeof b.audience.who === 'string'
      ? {
          who: b.audience.who,
          painPoints: Array.isArray(b.audience.painPoints) ? b.audience.painPoints.filter((s) => typeof s === 'string') : [],
        }
      : null;

  const langIn = b.customerLanguage && typeof b.customerLanguage === 'object' ? b.customerLanguage : {};
  const customerLanguage = {
    use: Array.isArray(langIn.use) ? langIn.use.filter((s) => typeof s === 'string') : [],
    avoid: Array.isArray(langIn.avoid) ? langIn.avoid.filter((s) => typeof s === 'string') : [],
  };

  const objections = (Array.isArray(b.objections) ? b.objections : [])
    .filter((o) => o && typeof o.objection === 'string' && typeof o.response === 'string')
    .map((o) => ({objection: o.objection, response: o.response}));

  const FORCE_KEYS = ['push', 'pull', 'habit', 'anxiety'];
  const switchingForces =
    b.switchingForces &&
    typeof b.switchingForces === 'object' &&
    FORCE_KEYS.every((k) => typeof b.switchingForces[k] === 'string')
      ? Object.fromEntries(FORCE_KEYS.map((k) => [k, b.switchingForces[k]]))
      : null;

  const proofPoints = (Array.isArray(b.proofPoints) ? b.proofPoints : [])
    .filter((p) => p && typeof p.claim === 'string' && typeof p.source === 'string' && p.source.length > 0)
    .map((p) => ({claim: p.claim, source: p.source}));

  return {
    brandId: b.brandId,
    hook,
    features,
    positioning,
    cta,
    narration,
    social,
    audience,
    customerLanguage,
    objections,
    switchingForces,
    proofPoints,
  };
}

const brief = validateBrief(briefRaw);
if (!brief) {
  fail(`out/${brandId}/marketing/brief.json does not match the brief.ts shape — cannot build a storyboard from it.`);
}

// --- load brief-inputs.json (optional, for grounding provenance) ---------
const briefInputsPath = join(root, 'out', brandId, 'marketing', 'brief-inputs.json');
let briefInputs = null;
if (existsSync(briefInputsPath)) {
  try {
    briefInputs = JSON.parse(readFileSync(briefInputsPath, 'utf8'));
  } catch (err) {
    console.warn(`build-storyboard: out/${brandId}/marketing/brief-inputs.json is not valid JSON, skipping provenance: ${err.message}`);
  }
}

// --- load brands/<brand>.json (optional, for theme colors) ---------------
const DEFAULT_COLORS = {
  bg: '#0b0a0f',
  surface: '#16151c',
  surface2: '#1d1c25',
  line: '#2a2932',
  ink: '#f4f4f6',
  ink2: '#bcbcc4',
  ink3: '#9a9aa3',
  brand: '#8847ff',
  profit: '#d6c23c',
  safe: '#3fd08c',
  loss: '#eb4b4b',
};

const brandPath = join(root, 'brands', `${brandId}.json`);
let brand = null;
if (existsSync(brandPath)) {
  try {
    brand = JSON.parse(readFileSync(brandPath, 'utf8'));
  } catch (err) {
    console.warn(`build-storyboard: brands/${brandId}.json is not valid JSON, using default theme: ${err.message}`);
  }
} else {
  console.warn(`build-storyboard: brands/${brandId}.json not found, using default theme`);
}

const colors = {...DEFAULT_COLORS, ...(brand?.colors ?? {})};
const brandName = brand?.name ?? brandId;
const tagline = brand?.tagline ?? '';
const voice = brand?.voice ?? '';

// --- helpers ----------------------------------------------------------------
function esc(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[c]));
}

// logo -> hook -> demo -> feature-N (ascending) -> end -> anything else.
function actRank(act) {
  if (act === 'logo') return 0;
  if (act === 'hook') return 1;
  if (act === 'demo') return 2;
  const m = /^feature-(\d+)$/.exec(act);
  if (m) return 3 + Number(m[1]);
  if (act === 'end') return 1000;
  return 500;
}

const narrationSorted = [...brief.narration].sort((a, b) => actRank(a.act) - actRank(b.act));

const platformLabels = {x: 'X', linkedin: 'LinkedIn', vertical: 'Vertical (TikTok/Reels/Shorts)'};
const socialRows = brief.social
  ? Object.entries(platformLabels)
      .map(([key, label]) => ({key, label, copy: brief.social[key]}))
      .filter((row) => row.copy)
  : [];

// --- provenance footer line -------------------------------------------------
function provenanceLine() {
  if (!briefInputs) return `No grounding file found (out/${brandId}/marketing/brief-inputs.json missing).`;
  const readmeYes = briefInputs.readme != null ? 'yes' : 'no';
  const routesCount = briefInputs.nextRoutes ? briefInputs.nextRoutes.routes.length : 0;
  const routesLabel = briefInputs.nextRoutes ? `${routesCount}` : 'n/a (not a Next.js app)';
  let landingLabel = 'no';
  if (briefInputs.landing) {
    landingLabel = briefInputs.landing.text ? 'yes' : `error (${esc(briefInputs.landing.error ?? 'unknown')})`;
  }
  return `Grounding sources — README: ${readmeYes} &middot; routes: ${routesLabel} &middot; landing DOM captured: ${landingLabel}`;
}

const generatedAt = new Date().toISOString();

// --- sections ----------------------------------------------------------------
const altHeadlinesHtml = brief.hook.altHeadlines.length
  ? `<ul class="alt-headlines">${brief.hook.altHeadlines.map((h) => `<li>${esc(h)}</li>`).join('')}</ul>`
  : '<p class="muted">No alt headlines.</p>';

const hookSection = `
<section class="block">
  <h2 class="block-title">Hook</h2>
  <p class="headline">${esc(brief.hook.headline) || '<span class="muted">(no headline)</span>'}</p>
  <div class="alt-headlines-wrap">
    <p class="label">Alt headlines</p>
    ${altHeadlinesHtml}
  </div>
</section>`;

const featureCards = brief.features.length
  ? brief.features
      .map(
        (f, i) => `
  <article class="card">
    <p class="card-rank">#${i + 1}</p>
    <h3 class="card-heading">${esc(f.heading) || '<span class="muted">(no heading)</span>'}</h3>
    <ul class="benefit-lines">
      ${f.benefitLines.map((l) => `<li>${esc(l)}</li>`).join('') || '<li class="muted">(no benefit lines)</li>'}
    </ul>
    <p class="rationale">${esc(f.rationale) || '<span class="muted">(no rationale given)</span>'}</p>
    ${f.sourceRoute ? `<code class="chip">${esc(f.sourceRoute)}</code>` : ''}
  </article>`,
      )
      .join('')
  : '<p class="muted">No features.</p>';

const featuresSection = `
<section class="block">
  <h2 class="block-title">Features (ranked)</h2>
  <div class="card-grid">${featureCards}</div>
</section>`;

const narrationRows = narrationSorted.length
  ? narrationSorted.map((n) => `<tr><td class="act-cell"><code>${esc(n.act)}</code></td><td>${esc(n.text)}</td></tr>`).join('')
  : '<tr><td colspan="2" class="muted">No narration lines.</td></tr>';

const narrationSection = `
<section class="block">
  <h2 class="block-title">Narration</h2>
  <table class="narration-table">
    <thead><tr><th>Act</th><th>VO line</th></tr></thead>
    <tbody>${narrationRows}</tbody>
  </table>
</section>`;

const socialSection = `
<section class="block">
  <h2 class="block-title">Social</h2>
  ${
    socialRows.length
      ? `<table class="social-table">
    <thead><tr><th>Platform</th><th>Hook</th><th>Headline</th></tr></thead>
    <tbody>${socialRows
      .map((row) => `<tr><td>${esc(row.label)}</td><td>${esc(row.copy.hook)}</td><td>${esc(row.copy.headline)}</td></tr>`)
      .join('')}</tbody>
  </table>`
      : '<p class="muted">No social copy.</p>'
  }
</section>`;

// Grounding panel: the audience facts the copy above must trace to. Only
// sub-blocks with content render; an entirely empty panel says so out loud
// (an ungrounded brief is reviewable information, not a crash).
const groundingBits = [];
if (brief.audience) {
  groundingBits.push(`
  <div class="grounding-item">
    <p class="label">Audience</p>
    <p>${esc(brief.audience.who)}</p>
    ${
      brief.audience.painPoints.length
        ? `<ul class="benefit-lines">${brief.audience.painPoints.map((p) => `<li>${esc(p)}</li>`).join('')}</ul>`
        : ''
    }
  </div>`);
}
if (brief.customerLanguage.use.length || brief.customerLanguage.avoid.length) {
  const chips = (words) => words.map((w) => `<code class="chip">${esc(w)}</code>`).join(' ');
  groundingBits.push(`
  <div class="grounding-item">
    <p class="label">Customer language</p>
    ${brief.customerLanguage.use.length ? `<p class="lang-row">use: ${chips(brief.customerLanguage.use)}</p>` : ''}
    ${brief.customerLanguage.avoid.length ? `<p class="lang-row">avoid: ${chips(brief.customerLanguage.avoid)}</p>` : ''}
  </div>`);
}
if (brief.switchingForces) {
  const forceRows = [
    ['Push', brief.switchingForces.push],
    ['Pull', brief.switchingForces.pull],
    ['Habit', brief.switchingForces.habit],
    ['Anxiety', brief.switchingForces.anxiety],
  ]
    .map(([label, text]) => `<tr><td class="act-cell"><code>${esc(label)}</code></td><td>${esc(text)}</td></tr>`)
    .join('');
  groundingBits.push(`
  <div class="grounding-item">
    <p class="label">Switching forces (JTBD)</p>
    <table><tbody>${forceRows}</tbody></table>
  </div>`);
}
if (brief.objections.length) {
  groundingBits.push(`
  <div class="grounding-item">
    <p class="label">Objections</p>
    <table>
      <thead><tr><th>Objection</th><th>Response the copy carries</th></tr></thead>
      <tbody>${brief.objections.map((o) => `<tr><td>${esc(o.objection)}</td><td>${esc(o.response)}</td></tr>`).join('')}</tbody>
    </table>
  </div>`);
}
if (brief.proofPoints.length) {
  groundingBits.push(`
  <div class="grounding-item">
    <p class="label">Proof points (every claim needs its source)</p>
    <table>
      <thead><tr><th>Claim</th><th>Source</th></tr></thead>
      <tbody>${brief.proofPoints.map((p) => `<tr><td>${esc(p.claim)}</td><td><code class="chip">${esc(p.source)}</code></td></tr>`).join('')}</tbody>
    </table>
  </div>`);
}

const groundingSection = `
<section class="block">
  <h2 class="block-title">Grounding</h2>
  ${groundingBits.length ? groundingBits.join('') : '<p class="muted">No grounding sections recorded — the copy above traces only to the provenance line below.</p>'}
</section>`;

const ctaSection = `
<section class="block">
  <h2 class="block-title">CTA &amp; positioning</h2>
  <p class="cta">${esc(brief.cta) || '<span class="muted">(no CTA)</span>'}</p>
  <p class="differentiator">${
    brief.positioning ? esc(brief.positioning.differentiator) : '<span class="muted">(no differentiator recorded)</span>'
  }</p>
</section>`;

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>${esc(brandName)} — storyboard</title>
<meta name="viewport" content="width=device-width, initial-scale=1">
<style>
  :root {
    --bg: ${colors.bg};
    --surface: ${colors.surface};
    --surface2: ${colors.surface2};
    --line: ${colors.line};
    --ink: ${colors.ink};
    --ink2: ${colors.ink2};
    --ink3: ${colors.ink3};
    --brand: ${colors.brand};
  }
  * { box-sizing: border-box; }
  body {
    margin: 0;
    padding: 40px 24px 80px;
    background: var(--bg);
    color: var(--ink);
    font-family: -apple-system, "Segoe UI", system-ui, sans-serif;
    line-height: 1.5;
  }
  .page { max-width: 880px; margin: 0 auto; }
  header.masthead {
    border-bottom: 1px solid var(--line);
    padding-bottom: 24px;
    margin-bottom: 32px;
  }
  .brand-name { font-size: 28px; font-weight: 700; margin: 0 0 4px; color: var(--ink); }
  .tagline { color: var(--ink2); margin: 0 0 12px; font-size: 15px; }
  .meta { color: var(--ink3); font-size: 12px; font-family: "Consolas", "Courier New", monospace; margin: 0 0 20px; }
  .voice-callout {
    background: var(--surface);
    border: 1px solid var(--line);
    border-left: 3px solid var(--brand);
    border-radius: 6px;
    padding: 14px 16px;
    font-size: 14px;
    color: var(--ink2);
  }
  .voice-callout .label { margin: 0 0 6px; font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink3); }
  .voice-callout p.voice-text { margin: 0; font-style: italic; }
  section.block { margin-bottom: 40px; }
  .block-title {
    font-size: 12px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--ink3);
    border-bottom: 1px solid var(--line);
    padding-bottom: 8px;
    margin: 0 0 16px;
  }
  .headline { font-size: 32px; font-weight: 700; margin: 0 0 20px; color: var(--ink); }
  .label { font-size: 11px; letter-spacing: 0.06em; text-transform: uppercase; color: var(--ink3); margin: 0 0 6px; }
  .alt-headlines { margin: 0; padding-left: 20px; color: var(--ink2); font-size: 15px; }
  .alt-headlines li { margin-bottom: 4px; }
  .card-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  .card {
    background: var(--surface);
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 16px;
  }
  .card-rank { margin: 0 0 6px; font-size: 11px; color: var(--brand); font-weight: 700; }
  .card-heading { margin: 0 0 10px; font-size: 17px; color: var(--ink); }
  .benefit-lines { margin: 0 0 12px; padding-left: 18px; font-size: 14px; color: var(--ink2); }
  .benefit-lines li { margin-bottom: 3px; }
  .rationale { margin: 0 0 10px; font-size: 12px; color: var(--ink3); }
  .chip {
    display: inline-block;
    font-family: "Consolas", "Courier New", monospace;
    font-size: 11px;
    background: var(--surface2);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 2px 8px;
    color: var(--ink2);
  }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--line); vertical-align: top; }
  th { color: var(--ink3); font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; font-weight: 600; }
  .act-cell code { color: var(--brand); font-family: "Consolas", "Courier New", monospace; font-size: 12px; }
  .cta { font-size: 20px; font-weight: 700; margin: 0 0 8px; }
  .differentiator { color: var(--ink2); margin: 0; }
  footer.provenance {
    border-top: 1px solid var(--line);
    padding-top: 16px;
    margin-top: 40px;
    font-size: 12px;
    color: var(--ink3);
  }
  .muted { color: var(--ink3); font-style: italic; }
  .grounding-item { margin-bottom: 20px; font-size: 14px; color: var(--ink2); }
  .grounding-item p { margin: 0 0 8px; }
  .lang-row { line-height: 2; }
  @media (max-width: 640px) {
    .card-grid { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<div class="page">
  <header class="masthead">
    <p class="brand-name">${esc(brandName)}</p>
    <p class="tagline">${esc(tagline)}</p>
    <p class="meta">Storyboard generated ${esc(generatedAt)}</p>
    <div class="voice-callout">
      <p class="label">Voice rules</p>
      <p class="voice-text">${esc(voice) || '(no voice rules recorded for this brand)'}</p>
    </div>
  </header>

  ${hookSection}
  ${featuresSection}
  ${narrationSection}
  ${socialSection}
  ${ctaSection}
  ${groundingSection}

  <footer class="provenance">${provenanceLine()}</footer>
</div>
</body>
</html>
`;

const outPath = join(root, 'out', brandId, 'marketing', 'storyboard.html');
writeFileSync(outPath, html);
console.log(`wrote out/${brandId}/marketing/storyboard.html`);
