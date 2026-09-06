#!/usr/bin/env node
// Inventory/copy legacy generated product material into product-owned workspaces.
// Dry-run is the default. Copy and removal are separate invocations: --copy first
// persists a reviewable manifest, then --remove-sources loads that exact manifest
// and revalidates every source/destination hash before unlinking individual files.
import {createHash} from 'node:crypto';
import {constants, copyFileSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, realpathSync, renameSync, statSync, unlinkSync, writeFileSync} from 'node:fs';
import {dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {fileURLToPath} from 'node:url';
import {resolveWorkspace, resolveWorkspacePath} from './lib/workspace.mjs';

const engineRoot = join(dirname(fileURLToPath(import.meta.url)), '..');
const sha256 = (path) => createHash('sha256').update(readFileSync(path)).digest('hex');

function isInside(root, path) {
  const rel = relative(root, path);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function canonical(path) {
  let existing = resolve(path);
  while (!existsSync(existing) && dirname(existing) !== existing) existing = dirname(existing);
  return join(realpathSync.native(existing), relative(existing, resolve(path)));
}

function requireContained(root, path, label) {
  const canonicalRoot = canonical(root);
  const canonicalPath = canonical(path);
  if (!isInside(canonicalRoot, canonicalPath)) throw new Error(`${label} escapes its selected root through a symbolic link or junction: ${path}`);
  return canonicalPath;
}

function walkFiles(root, onSkipped, base = root) {
  if (!existsSync(root)) return [];
  if (lstatSync(root).isSymbolicLink()) {
    onSkipped({source: root, reason: 'symbolic-link-or-junction'});
    return [];
  }
  const files = [];
  for (const entry of readdirSync(root, {withFileTypes: true})) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) {
      onSkipped({source: path, reason: 'symbolic-link-or-junction'});
      continue;
    }
    if (entry.isDirectory()) files.push(...walkFiles(path, onSkipped, base));
    else if (entry.isFile()) files.push({path, rel: relative(base, path)});
    else onSkipped({source: path, reason: 'not-a-regular-file'});
  }
  return files;
}

export function parseMappings(argv) {
  const mappings = new Map();
  for (let i = 0; i < argv.length; i++) {
    const raw = argv[i] === '--map' ? argv[++i] : argv[i].startsWith('--map=') ? argv[i].slice(6) : null;
    if (!raw) continue;
    const split = raw.indexOf('=');
    if (split < 1 || !raw.slice(split + 1)) throw new Error(`invalid --map ${raw}; expected brand=product-directory`);
    mappings.set(raw.slice(0, split), raw.slice(split + 1));
  }
  return mappings;
}

export function inventoryMigration(root, mappings) {
  const items = [];
  const skipped = [];
  const workspaces = new Map();
  for (const [brand, project] of mappings) {
    workspaces.set(brand, resolveWorkspace(root, {brand, project, cwd: root}));
  }
  const addTree = (brand, source, destination) => {
    const workspace = workspaces.get(brand);
    if (!workspace) {
      if (existsSync(source)) skipped.push({source, reason: `no --map for ${brand}`});
      return;
    }
    for (const file of walkFiles(source, (row) => skipped.push(row))) {
      const dest = join(destination(workspace), file.rel);
      items.push({brand, projectRoot: workspace.projectRoot, source: file.path, destination: dest});
    }
  };

  const propsDir = join(root, 'props');
  if (existsSync(propsDir) && lstatSync(propsDir).isSymbolicLink()) {
    skipped.push({source: propsDir, reason: 'symbolic-link-or-junction'});
  } else if (existsSync(propsDir)) {
    for (const entry of readdirSync(propsDir, {withFileTypes: true})) {
      if (!entry.isFile() || entry.isSymbolicLink() || !entry.name.endsWith('.json')) continue;
      const brand = [...mappings.keys()].sort((a, b) => b.length - a.length).find((id) => entry.name.startsWith(`${id}-`));
      if (!brand) {
        skipped.push({source: join(propsDir, entry.name), reason: 'no mapped brand prefix'});
        continue;
      }
      items.push({brand, projectRoot: workspaces.get(brand).projectRoot, source: join(propsDir, entry.name), destination: join(workspaces.get(brand).propsDir, entry.name)});
    }
  }

  const brands = new Set([
    ...mappings.keys(),
    ...['out', 'assets', join('studio', 'public'), 'examples'].flatMap((rel) =>
      existsSync(join(root, rel)) && !lstatSync(join(root, rel)).isSymbolicLink()
        ? readdirSync(join(root, rel), {withFileTypes: true}).filter((e) => e.isDirectory() && !e.isSymbolicLink()).map((e) => e.name)
        : [],
    ),
  ]);
  for (const rel of ['out', 'assets', join('studio', 'public'), 'examples']) {
    const dir = join(root, rel);
    if (!existsSync(dir)) continue;
    if (lstatSync(dir).isSymbolicLink()) {
      skipped.push({source: dir, reason: 'symbolic-link-or-junction'});
      continue;
    }
    for (const entry of readdirSync(dir, {withFileTypes: true})) {
      if (entry.isFile()) skipped.push({source: join(dir, entry.name), reason: 'unmapped legacy root file'});
      else if (entry.isSymbolicLink()) skipped.push({source: join(dir, entry.name), reason: 'symbolic-link-or-junction'});
    }
  }
  for (const brand of brands) {
    addTree(brand, join(root, 'out', brand), (w) => w.brandRoot);
    addTree(brand, join(root, 'assets', brand), (w) => w.assetsDir);
    addTree(brand, join(root, 'studio', 'public', brand), (w) => join(w.publicDir, brand));
    addTree(brand, join(root, 'examples', brand), (w) => join(w.assetsDir, 'examples'));
  }
  for (const shared of ['sfx']) {
    for (const [brand, workspace] of workspaces) {
      addTree(brand, join(root, 'studio', 'public', shared), () => join(workspace.publicDir, shared));
      addTree(brand, join(root, 'assets', shared), () => join(workspace.assetsDir, shared));
    }
  }

  items.sort((a, b) => a.source.localeCompare(b.source) || a.destination.localeCompare(b.destination));
  for (const item of items) {
    const info = statSync(item.source);
    item.bytes = info.size;
    item.sha256 = sha256(item.source);
    if (!existsSync(item.destination)) item.status = 'copy-ready';
    else if (lstatSync(item.destination).isFile() && statSync(item.destination).size === item.bytes && sha256(item.destination) === item.sha256) item.status = 'already-identical';
    else {
      item.status = 'collision';
      item.archiveDestination = join(workspaces.get(item.brand).assetsDir, 'legacy-engine', relative(root, item.source));
      item.archiveStatus = !existsSync(item.archiveDestination)
        ? 'copy-ready'
        : lstatSync(item.archiveDestination).isFile() && statSync(item.archiveDestination).size === item.bytes && sha256(item.archiveDestination) === item.sha256
          ? 'already-identical'
          : 'collision';
    }
  }
  return {version: 1, engineRoot: root, generatedAt: new Date().toISOString(), items, skipped};
}

export function copyMigration(manifest) {
  let copied = 0;
  for (const item of manifest.items) {
    if (item.status === 'already-identical') continue;
    const destination = item.status === 'collision' ? item.archiveDestination : item.destination;
    const statusKey = item.status === 'collision' ? 'archiveStatus' : 'status';
    if (item[statusKey] === 'already-identical') continue;
    if (item[statusKey] === 'collision') continue;
    resolveWorkspacePath({projectRoot: item.projectRoot}, destination);
    mkdirSync(dirname(destination), {recursive: true});
    copyFileSync(item.source, destination, constants.COPYFILE_EXCL);
    if (statSync(destination).size !== item.bytes || sha256(destination) !== item.sha256) {
      throw new Error(`copy verification failed: ${destination}`);
    }
    item[statusKey] = 'copied-verified';
    copied++;
  }
  return copied;
}

export function buildReviewArchive(manifest, archiveRoot, copy = false) {
  const rows = [];
  for (const skipped of manifest.skipped) {
    const sourceRows = existsSync(skipped.source) && lstatSync(skipped.source).isDirectory()
      ? walkFiles(skipped.source, (row) => rows.push({...row, status: 'skipped-link'}))
      : existsSync(skipped.source) && lstatSync(skipped.source).isFile()
        ? [{path: skipped.source, rel: ''}]
        : [];
    for (const file of sourceRows) {
      const destination = join(archiveRoot, relative(manifest.engineRoot, file.path));
      requireContained(archiveRoot, destination, 'review archive destination');
      const bytes = statSync(file.path).size;
      const hash = sha256(file.path);
      let status = !existsSync(destination) ? 'copy-ready' : statSync(destination).isFile() && statSync(destination).size === bytes && sha256(destination) === hash ? 'already-identical' : 'collision';
      if (copy && status === 'copy-ready') {
        mkdirSync(dirname(destination), {recursive: true});
        copyFileSync(file.path, destination, constants.COPYFILE_EXCL);
        if (statSync(destination).size !== bytes || sha256(destination) !== hash) throw new Error(`review archive verification failed: ${destination}`);
        status = 'copied-verified';
      }
      rows.push({source: file.path, destination, archiveRoot: canonical(archiveRoot), bytes, sha256: hash, status, reason: skipped.reason});
    }
  }
  return rows;
}

export function removeVerifiedSources(manifest) {
  const canonicalEngine = realpathSync.native(manifest.engineRoot);
  const allowed = ['out', 'assets', 'props', 'examples', join('studio', 'public')]
    .map((rel) => join(manifest.engineRoot, rel))
    .filter((path) => existsSync(path) && !lstatSync(path).isSymbolicLink())
    .map((path) => realpathSync.native(path))
    .filter((path) => isInside(canonicalEngine, path));
  const grouped = new Map();
  for (const item of manifest.items) {
    const destination = item.archiveDestination ?? item.destination;
    const row = {source: item.source, destination, projectRoot: item.projectRoot, bytes: item.bytes, sha256: item.sha256};
    if (!grouped.has(row.source)) grouped.set(row.source, []);
    grouped.get(row.source).push(row);
  }
  for (const item of manifest.reviewArchive ?? []) {
    const row = {source: item.source, destination: item.destination, archiveRoot: item.archiveRoot, bytes: item.bytes, sha256: item.sha256};
    if (!grouped.has(row.source)) grouped.set(row.source, []);
    grouped.get(row.source).push(row);
  }
  let removed = 0;
  const skipped = [];
  for (const [source, rows] of grouped) {
    if (!existsSync(source) || !lstatSync(source).isFile()) continue;
    const realSource = realpathSync.native(source);
    const inScope = allowed.some((root) => isInside(root, realSource) && realSource !== root);
    const sourceHash = sha256(source);
    const verified = inScope && rows.every((row) => {
      try {
        if (row.projectRoot) resolveWorkspacePath({projectRoot: row.projectRoot}, row.destination);
        else if (row.archiveRoot) requireContained(row.archiveRoot, row.destination, 'review archive destination');
        else return false;
      } catch {
        return false;
      }
      return row.sha256 === sourceHash &&
        existsSync(row.destination) &&
        lstatSync(row.destination).isFile() &&
        statSync(row.destination).size === row.bytes &&
        sha256(row.destination) === row.sha256;
    });
    if (!verified) {
      skipped.push({source, reason: inScope ? 'source-or-destination-changed' : 'outside-allowed-engine-roots'});
      continue;
    }
    unlinkSync(source);
    removed++;
  }
  return {removed, skipped};
}

function manifestPath(raw) {
  if (!raw) throw new Error('--manifest <outside-engine-path.json> is required');
  const path = resolve(raw);
  let parent = dirname(path);
  while (!existsSync(parent) && dirname(parent) !== parent) parent = dirname(parent);
  const realParent = realpathSync.native(parent);
  const realEngine = realpathSync.native(engineRoot);
  if (realParent === realEngine || realParent.startsWith(`${realEngine}${sep}`)) {
    throw new Error('migration manifest must be written outside the animation engine');
  }
  return path;
}

export function loadReviewedManifest(path, expectedEngineRoot = engineRoot) {
  if (!existsSync(path) || !lstatSync(path).isFile()) throw new Error('--remove-sources requires an existing reviewed manifest');
  const manifest = JSON.parse(readFileSync(path, 'utf8'));
  if (manifest?.version !== 1 || !Array.isArray(manifest.items) || typeof manifest.engineRoot !== 'string') {
    throw new Error('reviewed migration manifest is invalid');
  }
  if (realpathSync.native(manifest.engineRoot) !== realpathSync.native(expectedEngineRoot)) {
    throw new Error('reviewed migration manifest belongs to a different animation engine');
  }
  return manifest;
}

function persistManifest(path, manifest) {
  mkdirSync(dirname(path), {recursive: true});
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(manifest, null, 2) + '\n');
  renameSync(tmp, path);
}

function main() {
  const argv = process.argv.slice(2);
  const manifestArg = argv.indexOf('--manifest');
  const out = manifestPath(manifestArg >= 0 ? argv[manifestArg + 1] : null);
  if (argv.includes('--remove-sources')) {
    if (argv.includes('--copy')) throw new Error('--copy and --remove-sources are separate phases; review the persisted copy manifest first');
    if ([...parseMappings(argv)].length) throw new Error('--remove-sources loads the reviewed --manifest and does not accept --map');
    const manifest = loadReviewedManifest(out);
    manifest.removal = removeVerifiedSources(manifest);
    manifest.removal.completedAt = new Date().toISOString();
    persistManifest(out, manifest);
    console.log(`workspace migration removal: removed=${manifest.removal.removed} skipped=${manifest.removal.skipped.length}`);
    console.log(`manifest: ${out}`);
    return;
  }
  const maps = parseMappings(argv);
  if (!maps.size) throw new Error('at least one --map brand=product-directory is required');
  const manifest = inventoryMigration(engineRoot, maps);
  const collisions = manifest.items.filter((item) => item.status === 'collision').length;
  const bytes = manifest.items.reduce((sum, item) => sum + item.bytes, 0);
  const archiveIdx = argv.indexOf('--archive-skipped');
  if (archiveIdx >= 0) {
    const archiveRoot = manifestPath(argv[archiveIdx + 1]);
    manifest.reviewArchive = buildReviewArchive(manifest, archiveRoot, argv.includes('--copy'));
  }
  manifest.summary = {files: manifest.items.length, bytes, collisions, skipped: manifest.skipped.length, reviewArchiveFiles: manifest.reviewArchive?.length ?? 0, copied: 0};
  if (argv.includes('--copy')) manifest.summary.copied = copyMigration(manifest);
  persistManifest(out, manifest);
  console.log(`workspace migration ${argv.includes('--copy') ? 'copy' : 'dry-run'}: files=${manifest.summary.files} bytes=${manifest.summary.bytes} collisions=${collisions} skipped=${manifest.summary.skipped} copied=${manifest.summary.copied}`);
  console.log(`manifest: ${out}`);
  if (collisions) process.exitCode = 2;
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try { main(); } catch (error) { console.error(`migrate-workspace: ${error.message}`); process.exit(1); }
}
