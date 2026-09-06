#!/usr/bin/env node
// Builds the Magnetic app icon set: the approved MagneticMark geometry
// (studio/src/brands/MagneticMark.tsx, copied verbatim below — single source
// of truth is the component; this script mirrors it, it does not import it,
// since it must run standalone in a temp HTML page) rendered on a rounded-
// square tile, screenshotted transparent via Playwright, then packed into
// .ico/.icns via png2icons.
//
// Playwright is not a root dependency; this script resolves the install
// under feeders/capture/node_modules instead of adding a new dependency.
//
// Usage: node scripts/build-magnetic-icon.mjs [--project REPO] [--out DIR]
// Output defaults to the resolved product workspace's marketing/handoff dir.
import {createRequire} from 'node:module';
import {execFileSync} from 'node:child_process';
import {existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';
import {decodePng} from './lib/png.mjs';
import {projectArg, resolveWorkspace, resolveWorkspacePath} from './lib/workspace.mjs';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const CAPTURE_PKG = join(ROOT, 'feeders', 'capture', 'package.json');

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

export const resolveIconOutput = (args = [], cwd = process.cwd()) => {
  const workspace = resolveWorkspace(ROOT, {
    brand: 'magnetic',
    project: projectArg(args),
    cwd,
  });
  return resolveWorkspacePath(
    workspace,
    optionValue(args, '--out') ?? join(workspace.marketingDir, 'handoff'),
  );
};

// Approved geometry, copied verbatim from studio/src/brands/MagneticMark.tsx
// (viewBox 0 0 24 24, strokeWidth 1.6, round caps/joins, no fills).
const MARK_PATHS = [
  'M5 18.8 C4.6 12, 5 7.6, 6.4 6.9 L11.7 12.2',
  'M19 18.8 C19.4 12, 19 7.6, 17.6 6.9 L12.3 12.2',
  'M10.2 7.1 L12 8.9 L13.8 7.1',
];

// Tile is an elevated surface floating on transparency (brands/magnetic.json
// `colors.surface`), not the page background (`colors.bg` = #161617, used by
// task-3's contact sheet). Accent is `colors.brand`.
const TILE_BG = '#1d1d1f';
const ACCENT = '#0a84ff';
const CORNER_PCT = 0.225; // macOS-style rounded-square
const MARK_SCALE = 0.62; // mark width as a fraction of tile width
const NUDGE_DOWN_PCT = 0.02; // optical centering: legs splay, visual center sits high

function buildHtml(size) {
  const radius = size * CORNER_PCT;
  const markSize = size * MARK_SCALE;
  const nudge = size * NUDGE_DOWN_PCT;
  const paths = MARK_PATHS.map(
    (d) => `<path d="${d}" stroke="${ACCENT}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
  ).join('');
  return `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;width:${size}px;height:${size}px;background:transparent;}
#tile{width:${size}px;height:${size}px;border-radius:${radius}px;background:${TILE_BG};display:flex;align-items:center;justify-content:center;}
svg{width:${markSize}px;height:${markSize}px;transform:translateY(${nudge}px);}
</style></head><body>
<div id="tile"><svg viewBox="0 0 24 24" fill="none">${paths}</svg></div>
</body></html>`;
}

function assertCornersTransparent(pngPath) {
  const img = decodePng(readFileSync(pngPath));
  const corners = [
    [0, 0],
    [img.width - 1, 0],
    [0, img.height - 1],
    [img.width - 1, img.height - 1],
  ];
  for (const [x, y] of corners) {
    const alpha = img.data[(y * img.width + x) * 4 + 3];
    if (alpha !== 0) {
      throw new Error(`${pngPath}: corner pixel (${x},${y}) alpha=${alpha}, expected 0 (transparent outside the tile radius)`);
    }
  }
  return corners.length;
}

const require = createRequire(CAPTURE_PKG);

async function main(args = process.argv.slice(2)) {
  const outDir = resolveIconOutput(args);
  mkdirSync(outDir, {recursive: true});

  const {chromium} = require('playwright');
  const browser = await chromium.launch();
  const tmpDir = mkdtempSync(join(tmpdir(), 'magnetic-icon-'));
  try {
    const targets = [
      {size: 512, file: join(outDir, 'icon.png')},
      {size: 1024, file: join(outDir, 'icon@2x.png')},
    ];
    for (const {size, file} of targets) {
      const htmlPath = join(tmpDir, `icon-${size}.html`);
      writeFileSync(htmlPath, buildHtml(size), 'utf8');
      const page = await browser.newPage({viewport: {width: size, height: size}});
      await page.goto(pathToFileURL(htmlPath).href);
      await page.screenshot({path: file, omitBackground: true});
      await page.close();
      console.log(`wrote ${file} (${size}x${size})`);
    }
  } finally {
    await browser.close();
    rmSync(tmpDir, {recursive: true, force: true});
  }

  // Corner-alpha proof on both sizes.
  for (const file of [join(outDir, 'icon.png'), join(outDir, 'icon@2x.png')]) {
    const n = assertCornersTransparent(file);
    console.log(`verified ${n} transparent corners: ${file}`);
  }

  // Pack .ico/.icns from the 1024 source via one-shot npx (not a dependency).
  const src = join(outDir, 'icon@2x.png');
  const outBase = join(outDir, 'icon');
  execFileSync('npx', ['png2icons', src, outBase, '-allwe'], {
    cwd: ROOT,
    stdio: 'inherit',
    shell: process.platform === 'win32',
  });

  for (const ext of ['.ico', '.icns']) {
    const f = outBase + ext;
    if (!existsSync(f)) throw new Error(`png2icons did not produce ${f}`);
  }
  console.log(`done: ${outDir} ({icon.png,icon@2x.png,icon.ico,icon.icns})`);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
