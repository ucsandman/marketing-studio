// Unit tests for the pure helpers in build-infographic-style.mjs (the module is
// import-safe: main() only runs when executed directly).
// Run: node --test scripts/build-infographic-style.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {
  TEMPLATE_HEADINGS,
  CHART_SLOTS,
  buildStyleDoc,
  fontLink,
  readBrand,
  validateBrand,
  voiceRules,
} from './build-infographic-style.mjs';

// Fixture brand: hexes are deliberately unique so "every brand hex appears" is a
// real assertion, and the voice carries a forbidden color plus a text rule.
const FIXTURE = {
  id: 'fixture',
  name: 'Fixture',
  tagline: 'A brand that exists only in a temp dir',
  url: 'fixture.test',
  colors: {
    bg: '#010203',
    surface: '#040506',
    surface2: '#070809',
    line: '#0a0b0c',
    ink: '#f1f2f3',
    ink2: '#c1c2c3',
    ink3: '#919293',
    brand: '#8811ee',
    profit: '#d6c23c',
    safe: '#3fd08c',
    loss: '#eb4b4b',
    info: '#5a86e6',
    rare: '#df3ce0',
  },
  fonts: {display: 'Saira', body: 'Hanken Grotesk', mono: 'Geist Mono'},
  effects: {wash: 0, glow: 0},
  grade: {grain: 0.3, grainSize: 0.9, halation: 0, vignette: 0.2, bloom: 0, aberration: 0, letterbox: 0},
  motion: {tempo: 1, exuberance: 0.5, stagger: 0.5, overshoot: 0.1, parallax: 0, settle: 0, textReveal: 'spring'},
  textAccent: 'rare',
  voice: 'Terse and factual. Profit is gold, never green. The brand purple is a graphic color only and never carries text.',
};

// Writes `brand` (default: the fixture merged with `overrides`) to a temp dir.
function writeBrand(brand) {
  const dir = mkdtempSync(join(tmpdir(), 'infographic-style-'));
  const path = join(dir, 'fixture.json');
  writeFileSync(path, JSON.stringify(brand, null, 2), 'utf8');
  return path;
}

function fixtureFile(overrides = {}) {
  return writeBrand({...FIXTURE, ...overrides});
}

test('readBrand loads a fixture brand JSON from a temp dir and merges schema defaults', () => {
  const path = fixtureFile();
  const brand = readBrand(path);
  assert.equal(brand.id, 'fixture');
  assert.equal(brand.textAccent, 'rare');
  // grainSize came from the fixture; aberration fell back to the brandSchema default
  assert.equal(brand.grade.grainSize, 0.9);
  assert.equal(brand.grade.aberration, 0);
});

test('readBrand fills every optional block from the brandSchema defaults when omitted', () => {
  const bare = {...FIXTURE};
  delete bare.effects;
  delete bare.grade;
  delete bare.motion;
  delete bare.textAccent;
  const brand = readBrand(writeBrand(bare));
  assert.deepEqual(brand.effects, {wash: 0.165, glow: 0.4});
  assert.equal(brand.grade.grain, 0.12);
  assert.equal(brand.motion.exuberance, 0.35);
  assert.equal(brand.textAccent, 'brand');
});

test('validateBrand throws naming the field for a bad hex and a missing font', () => {
  assert.throws(
    () => validateBrand({...FIXTURE, colors: {...FIXTURE.colors, profit: 'gold'}}),
    /colors\.profit/,
  );
  assert.throws(() => validateBrand({...FIXTURE, fonts: {display: 'Saira', body: 'X'}}), /fonts\.mono/);
});

test('every template heading appears in the output, in template order', () => {
  const doc = buildStyleDoc(readBrand(fixtureFile()));
  let cursor = -1;
  for (const heading of TEMPLATE_HEADINGS) {
    const at = doc.indexOf(`\n${heading}\n`);
    assert.notEqual(at, -1, `missing heading ${heading}`);
    assert.ok(at > cursor, `heading out of order: ${heading}`);
    cursor = at;
  }
});

test('every brand hex appears in the output', () => {
  const doc = buildStyleDoc(readBrand(fixtureFile()));
  for (const [key, hex] of Object.entries(FIXTURE.colors)) {
    assert.ok(doc.includes(hex), `colors.${key} (${hex}) missing from the design language`);
  }
});

test('the chart slots are emitted in their fixed order with the brand hexes', () => {
  const doc = buildStyleDoc(readBrand(fixtureFile()));
  const css = doc.slice(doc.indexOf(':root {'));
  assert.ok(
    css.includes(
      `--chart-1:${FIXTURE.colors.profit}; --chart-2:${FIXTURE.colors.info}; --chart-3:${FIXTURE.colors.safe}; --chart-4:${FIXTURE.colors.rare}; --chart-5:${FIXTURE.colors.loss};`,
    ),
    'chart slots are not in the fixed order',
  );
  let cursor = -1;
  for (const [role] of CHART_SLOTS) {
    const at = doc.indexOf(`| \`${role}\``);
    assert.ok(at > cursor, `palette table row out of order: ${role}`);
    cursor = at;
  }
});

test("the do-not list carries the voice rules verbatim and the forbidden color", () => {
  const doc = buildStyleDoc(readBrand(fixtureFile()));
  const donts = doc.slice(doc.indexOf("## Do / Don't"), doc.indexOf('## CSS tokens'));
  assert.match(donts, /\*\*Don't\*\* introduce green anywhere/);
  for (const rule of voiceRules(FIXTURE.voice)) {
    assert.ok(donts.includes(`"${rule}"`), `voice rule not carried into the Don't list: ${rule}`);
  }
  // textAccent is 'rare', so brand purple is banned from text and rare is named
  assert.ok(donts.includes(`\`--accent\` (\`${FIXTURE.colors.brand}\`) — it is a graphic color here`));
  assert.ok(donts.includes(`\`--text-accent\` (\`${FIXTURE.colors.rare}\``));
});

test('voiceRules keeps only the restricting clauses', () => {
  assert.deepEqual(voiceRules('Terse and factual. Profit is gold, never green. Ships fast.'), [
    'Profit is gold, never green.',
  ]);
});

test('geometry and texture notes are derived from effects and grade', () => {
  const doc = buildStyleDoc(readBrand(fixtureFile()));
  // grain 0.3 > 0.1 -> a grain texture note naming the baseFrequency
  assert.match(doc, /grain at 0\.3 \(`baseFrequency 0\.9` at 1080p\)/);
  // wash 0 -> flat ground, glow 0 -> no shadow
  assert.match(doc, /Ground: flat\. `effects\.wash` is 0/);
  assert.match(doc, /Shadow: \*\*none\*\*/);

  const flat = buildStyleDoc(readBrand(fixtureFile({grade: {...FIXTURE.grade, grain: 0.05}})));
  assert.match(flat, /no grain \(`grade\.grain` 0\.05 is below the 0\.1 floor\)/);
  assert.match(flat, /\*\*Don't\*\* add paper grain/);

  const washed = buildStyleDoc(readBrand(fixtureFile({effects: {wash: 0.165, glow: 0.4}})));
  assert.match(washed, /\*\*Mark wash\*\* — a radial `--accent` glow at 0\.165 alpha/);
  assert.ok(washed.includes(`0 0 24px ${FIXTURE.colors.brand}66`), 'glow 0.4 should render as the 66 alpha suffix');
});

test('fontLink names all three families with + for spaces', () => {
  assert.equal(
    fontLink(FIXTURE.fonts),
    '<link href="https://fonts.googleapis.com/css2?family=Saira:wght@400;600;800&family=Hanken+Grotesk:wght@400;500;700&family=Geist+Mono:wght@400;500&display=swap" rel="stylesheet">',
  );
});

test('the voice section quotes the brand voice string verbatim', () => {
  const doc = buildStyleDoc(readBrand(fixtureFile()));
  assert.ok(doc.includes(`> ${FIXTURE.voice}`), 'voice section does not quote the voice string');
});
