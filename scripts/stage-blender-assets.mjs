// Stages rendered Blender PNG sequences into the studio's public dir.
// Usage: node scripts/stage-blender-assets.mjs [brandId] [--force]   (default brand: noban)
//
// Content-hash cache: when the source assets and this script are byte-identical to
// the last run AND the staged files are all still present, staging is a no-op.
// --force bypasses the check and re-copies.
import {cpSync, existsSync, readFileSync, readdirSync, statSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {dirname, join} from 'node:path';
import {cacheKey, checkCache, storeCache} from './lib/cache.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
const force = args.includes('--force');
const brandId = args.find((a) => !a.startsWith('--')) ?? 'noban';
const src = join(root, 'assets', brandId);
const dest = join(root, 'studio', 'public', brandId);

if (!existsSync(src)) {
  console.error(`nothing to stage: ${src} does not exist (run the blender feeder first)`);
  process.exit(1);
}
// stage every rendered sequence dir except raw comfy output (hero staging is
// handled by render-statics.mjs)
const dirs = readdirSync(src, {withFileTypes: true})
  .filter((d) => d.isDirectory() && d.name !== 'comfy')
  .map((d) => d.name);
if (dirs.length === 0) {
  console.error(`no sequence dirs under ${src}`);
  process.exit(1);
}

// Fingerprint every file that would be copied: relative path + size + mtime.
function walk(absDir, relBase, acc) {
  for (const e of readdirSync(absDir, {withFileTypes: true})) {
    const abs = join(absDir, e.name);
    const rel = relBase ? `${relBase}/${e.name}` : e.name;
    if (e.isDirectory()) walk(abs, rel, acc);
    else {
      const st = statSync(abs);
      acc.push({rel, size: st.size, mtimeMs: Math.round(st.mtimeMs)});
    }
  }
  return acc;
}
const sources = [];
for (const dir of dirs) walk(join(src, dir), dir, sources);
sources.sort((a, b) => a.rel.localeCompare(b.rel)); // stable order regardless of FS listing

const KEY = cacheKey({sources, script: readFileSync(fileURLToPath(import.meta.url), 'utf8')});
const artifacts = sources.map((s) => join(dest, ...s.rel.split('/')));

if (!force) {
  const {hit} = checkCache(brandId, 'blender-stage', KEY, artifacts);
  if (hit) {
    console.log(`blender staging cache hit — reusing ${dest} (${artifacts.length} files, copied nothing)`);
    process.exit(0);
  }
}

for (const dir of dirs) {
  cpSync(join(src, dir), join(dest, dir), {recursive: true});
  console.log(`staged ${brandId}/${dir}`);
}
storeCache(brandId, 'blender-stage', KEY, artifacts);
