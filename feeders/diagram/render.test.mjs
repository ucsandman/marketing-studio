import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {loadBrand, pngWidth, renderDiagram, stylePrelude} from './render.mjs';

const COLORS = {
  bg: '#101418',
  surface: '#1a2129',
  line: '#313b46',
  ink: '#e8edf2',
  brand: '#4493f8',
};

const SPEC = `
capture -> studio: frames
studio -> judges: mp4
judges -> postkit: verdicts
postkit -> ship: assets
`;

const fixtureBrandsDir = (colors) => {
  const dir = mkdtempSync(join(tmpdir(), 'diagram-feeder-'));
  writeFileSync(join(dir, 'fixture.json'), JSON.stringify({id: 'fixture', colors}));
  return dir;
};

test('loadBrand reads brands/<id>.json and fails loud on a missing color', () => {
  const dir = fixtureBrandsDir(COLORS);
  assert.deepEqual(loadBrand('fixture', dir).colors, COLORS);

  const partial = fixtureBrandsDir({...COLORS, brand: undefined});
  assert.throws(() => loadBrand('fixture', partial), /colors\.brand is missing/);
});

test('stylePrelude styles nodes and connections, not just nodes', () => {
  const prelude = stylePrelude(COLORS);
  assert.match(prelude, /^style\.fill: "#101418"$/m);
  assert.match(prelude, /^\*\*\.style\.fill: "#1a2129"$/m);
  assert.match(prelude, /^\(\*\* -> \*\*\)\[\*\]\.style\.stroke: "#4493f8"$/m);
});

test('renders five nodes with brand fill, stroke and edge color at the requested width', async () => {
  const brand = loadBrand('fixture', fixtureBrandsDir(COLORS));
  const {svg, png, nodes, edges} = await renderDiagram(brand, SPEC, 900);

  assert.equal(nodes, 5);
  assert.equal(edges, 4);
  assert.ok(svg.includes(`fill="${COLORS.bg}"`), 'diagram background is colors.bg');
  assert.ok(svg.includes(COLORS.surface), 'node fill is colors.surface');
  assert.ok(svg.includes(COLORS.line), 'node stroke is colors.line');
  assert.ok(svg.includes(COLORS.brand), 'edge stroke is colors.brand');
  assert.equal(pngWidth(png), 900);
});
