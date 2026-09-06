#!/usr/bin/env node
/**
 * Diagram feeder. Compiles a .d2 spec into a brand-colored SVG + PNG.
 *
 * Usage: node feeders/diagram/render.mjs <brand> <spec.d2> [--project REPO] [--out DIR] [--width N]
 */
import {copyFileSync, mkdirSync, readFileSync, writeFileSync} from 'node:fs';
import {basename, dirname, extname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {projectArg, resolveWorkspace, resolveWorkspacePath} from '../../scripts/lib/workspace.mjs';

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

const optionValue = (args, name) => {
  const index = args.indexOf(name);
  if (index >= 0) {
    const value = args[index + 1];
    if (!value || value.startsWith('--')) throw new Error(`${name} requires a value`);
    return value;
  }
  const prefix = `${name}=`;
  const arg = args.find((item) => item.startsWith(prefix));
  if (arg && arg.length === prefix.length) throw new Error(`${name} requires a value`);
  return arg?.slice(prefix.length) ?? null;
};

export const resolveDiagramPaths = (brandId, specPath, args = [], cwd = process.cwd()) => {
  const workspace = resolveWorkspace(ROOT, {
    brand: brandId,
    project: projectArg(args),
    cwd,
  });
  return {
    workspace,
    specPath: resolveWorkspacePath(workspace, specPath),
    outDir: resolveWorkspacePath(
      workspace,
      optionValue(args, '--out') ?? join(workspace.marketingDir, 'diagrams'),
    ),
  };
};

export const renderDiagram = async (brand, spec, width = DEFAULT_WIDTH) => {
  const [{D2}, {Resvg}] = await Promise.all([import('@d2lang/d2'), import('@resvg/resvg-js')]);
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
    console.error('usage: node feeders/diagram/render.mjs <brand> <spec.d2> [--project REPO] [--out DIR] [--width N]');
    process.exit(1);
  }
  const widthRaw = optionValue(args, '--width');
  const width = widthRaw === null ? DEFAULT_WIDTH : Number(widthRaw);
  if (!Number.isFinite(width) || width <= 0) throw new Error('--width must be a positive number');
  const paths = resolveDiagramPaths(brandId, specPath, args);
  await run(brandId, paths.specPath, paths.outDir, width);
}
