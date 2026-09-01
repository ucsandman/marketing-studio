#!/usr/bin/env node
/**
 * Diagram feeder. Compiles a .d2 spec into a brand-colored SVG + PNG.
 *
 * Usage: node feeders/diagram/render.mjs <brand> <spec.d2> [--out DIR] [--width N]
 */
import {copyFileSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {basename, dirname, extname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {D2} from '@d2lang/d2';
import {Resvg} from '@resvg/resvg-js';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');
const DEFAULT_WIDTH = 1600;

export const loadBrand = (brandId, brandsDir = join(ROOT, 'brands')) => {
  const file = join(brandsDir, `${brandId}.json`);
  const brand = JSON.parse(readFileSync(file, 'utf8'));
  for (const key of ['bg', 'surface', 'line', 'ink', 'brand']) {
    if (!brand.colors?.[key]) throw new Error(`${file}: colors.${key} is missing`);
  }
  return brand;
};

/**
 * D2 globs, not a theme: box fills take brand tokens on their own, but edge
 * strokes stay on the default theme unless every connection is styled too.
 */
export const stylePrelude = ({bg, surface, line, ink, brand}) =>
  [
    `style.fill: "${bg}"`,
    `**.style.fill: "${surface}"`,
    `**.style.stroke: "${line}"`,
    `**.style.font-color: "${ink}"`,
    `(** -> **)[*].style.stroke: "${brand}"`,
    `(** -> **)[*].style.font-color: "${ink}"`,
    '',
  ].join('\n');

/** PNG IHDR width: 4 big-endian bytes at offset 16. */
export const pngWidth = (buf) => buf.readUInt32BE(16);

export const renderDiagram = async (brand, spec, width = DEFAULT_WIDTH) => {
  const d2 = new D2();
  const compiled = await d2.compile(stylePrelude(brand.colors) + spec, {layout: 'dagre'});
  const svg = await d2.render(compiled.diagram, {...compiled.renderOptions, pad: 40});
  await d2.ready;
  d2.worker.unref(); // the WASM worker keeps the event loop alive otherwise
  const png = new Resvg(svg, {fitTo: {mode: 'width', value: width}}).render().asPng();
  return {
    svg,
    png,
    nodes: compiled.diagram.shapes.length,
    edges: compiled.diagram.connections.length,
  };
};

const run = async (brandId, specPath, outDir, width) => {
  const brand = loadBrand(brandId);
  const spec = readFileSync(specPath, 'utf8');
  const name = basename(specPath, extname(specPath));
  const {svg, png, nodes, edges} = await renderDiagram(brand, spec, width);

  mkdirSync(outDir, {recursive: true});
  writeFileSync(join(outDir, `${name}.svg`), svg);
  writeFileSync(join(outDir, `${name}.png`), png);
  copyFileSync(specPath, join(outDir, `${name}.d2`)); // keep the source regenerable
  console.log(`diagram OK: ${join(outDir, `${name}.png`)} (${nodes} nodes, ${edges} edges, ${width}px)`);
};

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  const args = process.argv.slice(2);
  const [brandId, specPath] = args;
  if (!brandId || !specPath) {
    console.error('usage: node feeders/diagram/render.mjs <brand> <spec.d2> [--out DIR] [--width N]');
    process.exit(1);
  }
  const outIdx = args.indexOf('--out');
  const widthIdx = args.indexOf('--width');
  const outDir =
    outIdx >= 0 ? resolve(args[outIdx + 1]) : join(ROOT, 'out', brandId, 'marketing', 'diagrams');
  const width = widthIdx >= 0 ? Number(args[widthIdx + 1]) : DEFAULT_WIDTH;
  await run(brandId, resolve(specPath), outDir, width);
}
