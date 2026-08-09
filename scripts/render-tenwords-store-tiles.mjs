// Chrome Web Store promo tiles for tenwords: tile-small.png (440x280) and
// tile-marquee.png (1400x560). Renders the StoreTile composition (paper
// ground, pilcrow mark, serif wordmark -- Galley Proof direction, zero
// glow/wash) at exact store-spec pixel sizes via {formatWidth, formatHeight}
// props read by StoreTile's calculateMetadata (Root.tsx) -- the render-matrix
// pattern, since this Remotion version has no --width/--height CLI flags.
import {mkdirSync, writeFileSync} from 'node:fs';
import {execSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';

process.on('unhandledRejection', (reason) => {
  console.error('Unhandled Rejection:', reason);
  process.exit(1);
});

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(root, 'out', 'tenwords', 'store');
mkdirSync(outDir, {recursive: true});

const studioDir = join(root, 'studio');
const propsDir = outDir;

const tiles = [
  {
    id: 'tile-small',
    formatWidth: 440,
    formatHeight: 280,
    tagline: null, // mark + wordmark only -- 440x280 is too tiny for more
    density: 1.9, // no tagline competing for room -- fill more of the frame
  },
  {
    id: 'tile-marquee',
    formatWidth: 1400,
    formatHeight: 560,
    tagline: 'Every paragraph in exactly ten words',
    density: 1,
  },
];

for (const tile of tiles) {
  const propsPath = join(propsDir, `${tile.id}-props.json`);
  writeFileSync(
    propsPath,
    JSON.stringify({
      brandId: 'tenwords',
      tagline: tile.tagline,
      density: tile.density,
      formatWidth: tile.formatWidth,
      formatHeight: tile.formatHeight,
    }),
  );
  const outFile = join(outDir, `${tile.id}.png`);
  console.log(`still: ${tile.id}.png (${tile.formatWidth}x${tile.formatHeight})`);
  execSync(`npx remotion still StoreTile "${outFile}" --props="${propsPath}"`, {
    cwd: studioDir,
    stdio: 'inherit',
  });
}

console.log('store tiles OK: tile-small.png, tile-marquee.png in out/tenwords/store/');
