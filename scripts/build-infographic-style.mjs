#!/usr/bin/env node
// Bridge: brand tokens -> an /epic-infographics design-language file.
//
// The installed epic-infographics skill picks exactly ONE file out of its
// references/design-languages/ directory and treats its palette, fonts and
// do/don'ts as law (SKILL.md steps 6-9). Handed only a brand name it would
// invent a palette. This emits that file from brands/<id>.json instead, so an
// infographic for a product renders on the product's own tokens.
//
// Usage: node scripts/build-infographic-style.mjs <brand> --project <repo> [--out path]
// Output: the product-owned marketing/infographic-style.md (default)
//
// VALIDATION: studio/src/lib/brand.ts cannot be imported from a plain script —
// it statically imports the seven registered brands/*.json without the
// `with {type:'json'}` attribute Node 24 requires, so `import()` of it throws
// (measured). Nor would getBrand() see an unregistered brand. So this reads the
// JSON directly and validates the handful of fields it uses (ids, the 13
// colors, the 3 fonts, voice) against the same rules brand.ts states; the
// optional blocks fall back to the DEFAULTS mirrored from brandSchema below.
import {readFileSync, mkdirSync, writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join, resolve} from 'node:path';
import {parseForbiddenColors} from './judge-palette.mjs';
import {projectArg, resolveWorkspace, resolveWorkspacePath} from './lib/workspace.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

const HEX = /^#[0-9a-f]{6}$/i;

// The template's own headings, in template order
// (~/.claude/skills/epic-infographics/references/design-languages/_template.md;
// the shipped examples title the last one "## CSS tokens"). Exported so the test
// can assert the emitted file carries all of them, in order.
export const TEMPLATE_HEADINGS = [
  '## Mood & when to use',
  '## Palette',
  '## Typography',
  '## Geometry & spacing',
  '## Chart styling',
  '## Signature devices',
  "## Do / Don't",
  '## CSS tokens',
];

// Structural / text / accent roles the template names -> brands/<id>.json colors.
const BASE_ROLES = [
  ['--bg', 'bg', 'canvas ground'],
  ['--surface', 'surface', 'cards, panels'],
  ['--surface-2', 'surface2', 'quiet fills: unfilled waffle cells, meter tracks'],
  ['--line', 'line', 'hairlines, gridlines, panel borders'],
  ['--ink', 'ink', 'primary text'],
  ['--ink-muted', 'ink2', 'secondary text, axis labels'],
  ['--de-emphasis', 'ink3', 'context marks, the "everything else" series'],
  ['--accent', 'brand', 'decoration accent: the mark, headers, one rule line'],
];

// Chart-safe slots in FIXED order (the skill fills series from slot 1 up and
// folds the tail past 5 into "Other"). The five semantic data colors, ordered
// positive -> neutral -> negative so an unread slot never lies: loss is last
// because red already means loss/danger in every brand here.
export const CHART_SLOTS = [
  ['--chart-1', 'profit', 'the story series'],
  ['--chart-2', 'info', 'neutral second series'],
  ['--chart-3', 'safe', 'third series'],
  ['--chart-4', 'rare', 'fourth series'],
  ['--chart-5', 'loss', 'fifth series — and the only slot that may carry a negative'],
];

// Mirrored from brandSchema's .default() blocks in studio/src/lib/brand.ts. A
// brand JSON that omits a block must read here exactly as it renders there.
const DEFAULTS = {
  effects: {wash: 0.165, glow: 0.4},
  grade: {grain: 0.12, grainSize: 0.8, halation: 0, vignette: 0.18, bloom: 0.1, aberration: 0, letterbox: 0},
  motion: {tempo: 1, exuberance: 0.35, stagger: 0.5, overshoot: 0.25, parallax: 0, settle: 0, textReveal: 'spring'},
  textAccent: 'brand',
};

// 0..1 alpha -> the two-digit hex suffix of an #rrggbbaa color (alphaHex in
// studio/src/lib/brand.ts, which this script cannot import — see header).
const alphaHex = (a) => Math.round(a * 255).toString(16).padStart(2, '0');

/** Validate the fields this builder reads and merge the schema defaults. Throws
 * naming the offending field. */
export function validateBrand(raw, label = 'brand') {
  const bad = (msg) => {
    throw new Error(`build-infographic-style: ${label}: ${msg}`);
  };
  if (!raw || typeof raw !== 'object') bad('not a JSON object');
  for (const k of ['id', 'name', 'tagline', 'url', 'voice']) {
    if (typeof raw[k] !== 'string' || raw[k].length === 0) bad(`"${k}" must be a non-empty string`);
  }
  if (!raw.colors || typeof raw.colors !== 'object') bad('"colors" missing');
  const colorKeys = [...BASE_ROLES.map(([, k]) => k), ...CHART_SLOTS.map(([, k]) => k)];
  for (const k of colorKeys) {
    if (!HEX.test(raw.colors[k] ?? '')) bad(`colors.${k} must be an #rrggbb hex, got ${JSON.stringify(raw.colors[k])}`);
  }
  if (!raw.fonts || typeof raw.fonts !== 'object') bad('"fonts" missing');
  for (const k of ['display', 'body', 'mono']) {
    if (typeof raw.fonts[k] !== 'string' || raw.fonts[k].length === 0) bad(`fonts.${k} must be a non-empty family name`);
  }
  // Same enum brand.ts uses; an unknown key would otherwise bake the literal
  // string "undefined" into the palette table instead of failing here.
  const TEXT_ACCENTS = ['brand', 'profit', 'safe', 'loss', 'info', 'rare'];
  if (raw.textAccent !== undefined && !TEXT_ACCENTS.includes(raw.textAccent)) {
    bad(`textAccent must be one of ${TEXT_ACCENTS.join(', ')}, got ${JSON.stringify(raw.textAccent)}`);
  }
  return {
    ...raw,
    effects: {...DEFAULTS.effects, ...(raw.effects ?? {})},
    grade: {...DEFAULTS.grade, ...(raw.grade ?? {})},
    motion: {...DEFAULTS.motion, ...(raw.motion ?? {})},
    textAccent: raw.textAccent ?? DEFAULTS.textAccent,
  };
}

/** Read + validate brands/<id>.json (or any path to one). */
export function readBrand(path) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`build-infographic-style: failed to read brand JSON at ${path}: ${err.message}`);
  }
  return validateBrand(raw, path);
}

/** The single Google Fonts <link> line, families in display/body/mono order. */
export function fontLink(fonts) {
  const fam = (name, weights) => `family=${name.replace(/ /g, '+')}:wght@${weights.join(';')}`;
  const q = [
    fam(fonts.display, ['400', '600', '800']),
    fam(fonts.body, ['400', '500', '700']),
    fam(fonts.mono, ['400', '500']),
  ].join('&');
  return `<link href="https://fonts.googleapis.com/css2?${q}&display=swap" rel="stylesheet">`;
}

/** Voice clauses that state a restriction — the raw material of the Don't list. */
export function voiceRules(voice) {
  return voice
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && /\b(never|not|no|only)\b/i.test(s));
}

/** The whole design-language markdown file. Pure: takes a validated brand. */
export function buildStyleDoc(brand) {
  const c = brand.colors;
  const {effects, grade, motion} = brand;
  const accentTextHex = c[brand.textAccent];
  const forbidden = parseForbiddenColors(brand.voice);
  const rules = voiceRules(brand.voice);
  const radius = Math.round(4 + motion.exuberance * 16);
  const grainy = grade.grain > 0.1;

  const paletteRows = [
    ...BASE_ROLES.map(([role, key, note]) => `| \`${role}\` | \`${c[key]}\` | ${note} (\`colors.${key}\`) |`),
    ...CHART_SLOTS.map(([role, key, note]) => `| \`${role}\` | \`${c[key]}\` | ${note} (\`colors.${key}\`) |`),
  ];

  const devices = [];
  if (effects.wash > 0) {
    devices.push(
      `**Mark wash** — a radial \`--accent\` glow at ${effects.wash} alpha behind the hero mark or hero number, and nowhere else (\`effects.wash\`).`,
    );
  } else {
    devices.push(
      '**Flat ground** — `effects.wash` is 0: the ground is one flat `--bg`. No radial wash, no gradient behind the mark. Depth comes from `--surface` panels and `--line` hairlines only.',
    );
  }
  if (grainy) {
    devices.push(
      `**Grain** — a full-canvas \`feTurbulence\` overlay, \`baseFrequency="${grade.grainSize}"\` at a 1080px canvas height, painted at ${grade.grain} opacity in \`mix-blend-mode: overlay\`. Felt, not seen (\`grade.grain\`).`,
    );
  }
  if (grade.vignette > 0) {
    devices.push(
      `**Vignette** — a corner-darkening radial at ${grade.vignette} alpha over the whole canvas (\`grade.vignette\`). It never touches text contrast; keep copy off the corners.`,
    );
  }
  if (grade.halation > 0 || grade.bloom > 0) {
    devices.push(
      `**Highlight bloom** — the brightest ${grade.halation > 0 ? 'content' : 'accent area'} blooms at ${Math.max(grade.halation, grade.bloom)} alpha (\`grade.${grade.halation > 0 ? 'halation' : 'bloom'}\`). One bloom per canvas, on the hero.`,
    );
  }
  devices.push(
    `**Instrument figures** — every data value set in ${brand.fonts.mono}, tabular, direct-labelled beside its mark. A still image has no tooltips.`,
  );
  devices.push(
    `**One accent rule** — a single ${Math.max(4, radius)}px \`--accent\` bar under the title block is the only decoration allowed to be loud.`,
  );

  const dos = [
    `**Do** take every color from the token block below. \`brands/${brand.id}.json\` is the whole palette; nothing else is on-brand.`,
    `**Do** reserve \`--accent\` (\`${c.brand}\`) for decoration and the hero mark. Data marks wear \`--chart-1\`…\`--chart-5\` in that fixed order.`,
    `**Do** direct-label every mark that matters, in ${brand.fonts.mono}.`,
    `**Do** set titles in ${brand.fonts.display} and body copy in ${brand.fonts.body}.`,
    `**Do** fold a sixth-and-beyond series into "Other" in \`--de-emphasis\` (\`${c.ink3}\`).`,
    `**Do** keep the ${brand.name} voice in the copy — headline, kicker, callouts, source line.`,
  ];

  const donts = [];
  for (const name of forbidden) {
    donts.push(
      `**Don't** introduce ${name} anywhere the brand does not already define it. The voice forbids it, and no fill, wash, icon or chart slot may reintroduce it.`,
    );
  }
  if (brand.textAccent !== 'brand') {
    donts.push(
      `**Don't** set text in \`--accent\` (\`${c.brand}\`) — it is a graphic color here. Colored text uses \`--text-accent\` (\`${accentTextHex}\`, \`colors.${brand.textAccent}\`).`,
    );
  }
  if (effects.wash === 0) donts.push("**Don't** add a wash, gradient or glow behind the mark — `effects.wash` is 0 on purpose.");
  if (grade.halation === 0 && grade.bloom === 0) donts.push("**Don't** bloom the accent: this brand zeroes both `grade.halation` and `grade.bloom`.");
  if (!grainy) donts.push("**Don't** add paper grain — `grade.grain` is below the texture floor for this brand.");
  donts.push("**Don't** use emoji as icons, framework-default hexes, or a color the token block does not name.");
  donts.push("**Don't** put a data mark in `--accent`, `--ink` or any `--surface` role — those are chrome.");

  const out = [];
  out.push(`# ${brand.name} — ${brand.tagline}`);
  out.push('');
  out.push(`> Generated by \`scripts/build-infographic-style.mjs ${brand.id}\` from \`brands/${brand.id}.json\`.`);
  out.push('> Do not hand-edit: change the brand tokens and re-run. Drop this file into');
  out.push('> the epic-infographics skill\'s `references/design-languages/` and pick it at step 6.');
  out.push('');
  out.push(TEMPLATE_HEADINGS[0]);
  out.push('');
  out.push(`The ${brand.name} house style, straight off the brand tokens. ${brand.tagline}, drawn`);
  out.push(`on \`${c.bg}\` with ${brand.fonts.display} titles and ${brand.fonts.mono} figures. Use it for any`);
  out.push(`infographic that carries the ${brand.name} name — launch stats, feature one-pagers, link`);
  out.push(`previews, in-product explainers. Don't use it for anything published under another`);
  out.push(`brand: the palette is ${brand.name}'s identity, not a general-purpose scheme.`);
  out.push('');
  out.push(TEMPLATE_HEADINGS[1]);
  out.push('');
  out.push('| Role | Hex | Notes |');
  out.push('|---|---|---|');
  out.push(...paletteRows);
  out.push(`| \`--text-accent\` | \`${accentTextHex}\` | the only accent that may carry text (\`textAccent: "${brand.textAccent}"\`) |`);
  out.push('');
  out.push('The chart-safe slots are the brand\'s five semantic data colors, in the fixed');
  out.push('order above. They are NOT machine-validated for CVD separation or lightness');
  out.push('band — the brand tokens are the constraint here, so compensate the same way the');
  out.push('studio does: direct-label every mark, cap a chart at 3 hues where the values sit');
  out.push('close, and reach for `--de-emphasis` for context rather than a sixth hue.');
  out.push('');
  out.push('The slots are also SEMANTIC, because the brand colors they come from are:');
  out.push('`--chart-1` is profit, `--chart-3` is safe/simulation, `--chart-5` is loss/danger.');
  out.push('Never spend one on an unrelated series just because it is next in order — reorder');
  out.push('the series so the meaning holds, or fold the odd one into `--de-emphasis`.');
  out.push('');
  out.push(TEMPLATE_HEADINGS[2]);
  out.push('');
  out.push('```html');
  out.push(fontLink(brand.fonts));
  out.push('```');
  out.push('');
  out.push(`- Display: **${brand.fonts.display}** 600–800 — titles, hero numbers, tight (\`-0.02em\`).`);
  out.push(`- Body: **${brand.fonts.body}** 400/500/700.`);
  out.push(`- Data: **${brand.fonts.mono}** 400/500 — every figure, axis value and label.`);
  out.push('- Scale (1080px canvas): title 64–96px · section 22px · body 16px · caption 13px.');
  out.push('  Hero number 120–200px display 800. Kickers 13px mono UPPERCASE +0.16em in `--ink-muted`.');
  out.push('- Flush left, ragged right. Numbers formatted for humans (12.4M, units always shown).');
  out.push('');
  out.push(TEMPLATE_HEADINGS[3]);
  out.push('');
  out.push(`- Radii: **${radius}px** on panels, ${Math.max(2, Math.round(radius / 2))}px on small fills — derived from \`motion.exuberance\` ${motion.exuberance} (a restrained brand gets tighter corners).`);
  out.push('- Spacing scale: 8 / 16 / 24 / 40 / 64. No ad-hoc margins.');
  out.push('- Borders: 1px `--line`. Panels are `--surface` on `--bg`, never a drop-shadowed card.');
  out.push(
    effects.glow > 0
      ? `- Shadow: the ONE hero element may carry \`0 0 24px ${c.brand}${alphaHex(effects.glow)}\` (\`effects.glow\` ${effects.glow}). Nothing else glows.`
      : `- Shadow: **none**. \`effects.glow\` is 0 — depth comes from \`--surface\` and \`--line\`, never from a glow.`,
  );
  out.push(
    grainy
      ? `- Texture: grain at ${grade.grain} (\`baseFrequency ${grade.grainSize}\` at 1080p), vignette ${grade.vignette}. Both sit above everything and below nothing.`
      : `- Texture: no grain (\`grade.grain\` ${grade.grain} is below the 0.1 floor). Vignette ${grade.vignette}.`,
  );
  if (effects.wash === 0) out.push('- Ground: flat. `effects.wash` is 0, so `--bg` is one solid field edge to edge.');
  if (grade.letterbox > 0) out.push(`- Letterbox bars at ${grade.letterbox} of the canvas height, top and bottom.`);
  out.push('');
  out.push(TEMPLATE_HEADINGS[4]);
  out.push('');
  out.push(`- Bars ≤ 24px, ${Math.max(2, Math.round(radius / 2))}px ends, gaps in \`--bg\`. Fills from the chart slots in order.`);
  out.push('- Gridlines: 1px `--line` hairlines, or none. One axis rule in `--line`, never a box.');
  out.push(`- Lines 2.5px; end dots 8px ringed in \`--bg\`. Values direct-labelled in ${brand.fonts.mono} 500.`);
  out.push('- Axis and tick text 13px `--ink-muted`. Text never wears a data color.');
  out.push('- Donuts only for part-to-whole, ≤5 segments, gaps in `--bg`. Prefer waffles and');
  out.push('  meters, whose tracks are `--surface-2`.');
  out.push('');
  out.push(TEMPLATE_HEADINGS[5]);
  out.push('');
  devices.forEach((d, i) => out.push(`${i + 1}. ${d}`));
  out.push('');
  out.push('## Voice');
  out.push('');
  out.push(`Verbatim from \`brands/${brand.id}.json\`:`);
  out.push('');
  out.push(`> ${brand.voice}`);
  out.push('');
  out.push('Copy on the canvas obeys it. Headline, kicker, callouts and the source line all');
  out.push('read in this register — no hype, no em dashes, no invented numbers.');
  out.push('');
  out.push(TEMPLATE_HEADINGS[6]);
  out.push('');
  out.push(...dos.map((d) => `- ${d}`));
  out.push(...donts.map((d) => `- ${d}`));
  if (rules.length > 0) {
    out.push('- **Don\'t** soften a voice rule. These are the restrictions the voice states, verbatim:');
    out.push(...rules.map((r) => `  - "${r}"`));
  }
  out.push('');
  out.push(TEMPLATE_HEADINGS[7]);
  out.push('');
  out.push('```css');
  out.push(':root {');
  out.push(`  --bg:${c.bg}; --surface:${c.surface}; --surface-2:${c.surface2}; --line:${c.line};`);
  out.push(`  --ink:${c.ink}; --ink-muted:${c.ink2}; --de-emphasis:${c.ink3};`);
  out.push(`  --accent:${c.brand}; --text-accent:${accentTextHex};`);
  out.push(`  --chart-1:${c.profit}; --chart-2:${c.info}; --chart-3:${c.safe}; --chart-4:${c.rare}; --chart-5:${c.loss};`);
  out.push(`  --font-display:'${brand.fonts.display}',sans-serif; --font-body:'${brand.fonts.body}',sans-serif;`);
  out.push(`  --font-data:'${brand.fonts.mono}',monospace;`);
  out.push('  --space-1:8px; --space-2:16px; --space-3:24px; --space-4:40px; --space-5:64px;');
  out.push(`  --radius:${radius}px; --radius-sm:${Math.max(2, Math.round(radius / 2))}px;`);
  out.push('}');
  out.push('body { font-family:var(--font-body); color:var(--ink); background:var(--bg); }');
  out.push("h1,.display { font-family:var(--font-display); font-weight:800; letter-spacing:-0.02em; line-height:1.02; }");
  out.push('.kicker { font:500 13px/1 var(--font-data); text-transform:uppercase;');
  out.push('          letter-spacing:.16em; color:var(--ink-muted); }');
  out.push('.panel { background:var(--surface); border:1px solid var(--line); border-radius:var(--radius); padding:28px; }');
  out.push('.value { font-family:var(--font-data); font-weight:500; }');
  out.push('```');
  out.push('');
  return out.join('\n');
}

// --- CLI ---

function main() {
  const argv = process.argv.slice(2);
  const outFlag = argv.indexOf('--out');
  const outPath = outFlag === -1 ? null : argv[outFlag + 1];
  if (outFlag !== -1 && !outPath) throw new Error('build-infographic-style: --out needs a path');
  const projectFlag = argv.indexOf('--project');
  const brandId = argv.find((a, i) => !a.startsWith('--') && !(outFlag !== -1 && i === outFlag + 1) && !(projectFlag !== -1 && i === projectFlag + 1));
  if (!brandId) {
    console.error('usage: node scripts/build-infographic-style.mjs <brand> --project <repo> [--out path]');
    process.exit(2);
  }

  const brand = readBrand(join(root, 'brands', `${brandId}.json`));
  const doc = buildStyleDoc(brand);
  const workspace = resolveWorkspace(root, {brand: brandId, project: projectArg(argv)});
  const dest = outPath ? resolveWorkspacePath(workspace, outPath) : join(workspace.marketingDir, 'infographic-style.md');
  mkdirSync(dirname(dest), {recursive: true});
  writeFileSync(dest, doc, 'utf8');

  const sections = (doc.match(/^## /gm) || []).length;
  const slots = BASE_ROLES.length + CHART_SLOTS.length + 1; // + --text-accent
  console.log(`build-infographic-style OK: ${dest} — ${sections} sections, ${slots}/${slots} palette slots filled`);
}

// Import-safe (the test imports the pure helpers above): only run when executed
// directly, matching build-wrap-props.mjs's isMain convention.
const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    main();
  } catch (err) {
    console.error(err.message || err);
    process.exit(1);
  }
}
