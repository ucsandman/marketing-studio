// Product-owned workspace paths for generated marketing artifacts. Engine source
// (studio/, brands/, templates) remains in this repository; every run artifact is
// rooted in the product repository supplied explicitly by --project.
import {existsSync, lstatSync, readFileSync, readdirSync, realpathSync} from 'node:fs';
import {dirname, resolve, join, relative, isAbsolute, parse} from 'node:path';

export function projectArg(argv) {
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--project') {
      const value = argv[i + 1];
      if (!value || value.startsWith('--')) throw new Error('--project requires a product repository path');
      return value;
    }
    if (argv[i].startsWith('--project=')) {
      const value = argv[i].slice('--project='.length);
      if (!value) throw new Error('--project requires a product repository path');
      return value;
    }
  }
  return null;
}

function isInside(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function nearestExisting(path) {
  let cursor = resolve(path);
  while (!existsSync(cursor)) {
    const parent = dirname(cursor);
    if (parent === cursor) return null;
    cursor = parent;
  }
  return cursor;
}

function canonical(path) {
  const existing = nearestExisting(path);
  if (!existing) return resolve(path);
  return join(realpathSync.native(existing), relative(existing, resolve(path)));
}

function findGitRoot(start) {
  let cursor = canonical(start);
  if (existsSync(cursor) && !lstatSync(cursor).isDirectory()) cursor = dirname(cursor);
  while (true) {
    if (existsSync(join(cursor, '.git'))) return cursor;
    const parent = dirname(cursor);
    if (parent === cursor || parent === parse(cursor).root) return null;
    cursor = parent;
  }
}

const PRODUCT_KEYS = new Set(['productRepo', 'projectRoot', 'productDir', 'repoRoot']);
function metadataProduct(value) {
  if (!value || typeof value !== 'object') return null;
  for (const [key, item] of Object.entries(value)) {
    if (PRODUCT_KEYS.has(key) && typeof item === 'string' && isAbsolute(item)) return item;
    const nested = metadataProduct(item);
    if (nested) return nested;
  }
  return null;
}

function inferFromMetadata(engineRoot, brand, candidates = []) {
  const defaults = engineRoot
    ? ['run.json', 'brief-inputs.json', 'brief.json'].map((name) =>
        join(engineRoot, 'out', brand, 'marketing', name),
      )
    : [];
  for (const file of [...candidates, ...defaults]) {
    if (!existsSync(file)) continue;
    try {
      const candidate = metadataProduct(JSON.parse(readFileSync(file, 'utf8')));
      if (candidate && findGitRoot(candidate)) return candidate;
    } catch {
      // Malformed or stale legacy metadata is not authority to choose a workspace.
    }
  }
  return null;
}

function rejectWorkspaceLinks(root) {
  if (!existsSync(root)) return;
  for (const entry of readdirSync(root, {withFileTypes: true})) {
    const path = join(root, entry.name);
    if (entry.isSymbolicLink()) throw new Error(`workspace contains a symbolic link or junction: ${path}`);
    if (entry.isDirectory()) rejectWorkspaceLinks(path);
  }
}

export function resolveProjectRoot(engineRoot, {brand, project, cwd = process.cwd(), metadataCandidates = []}) {
  const engine = engineRoot ? canonical(engineRoot) : null;
  let candidate = project;
  let source = 'explicit --project';
  if (!candidate) {
    const cwdRepo = findGitRoot(cwd);
    if (cwdRepo && (!engine || !isInside(engine, canonical(cwdRepo)))) {
      candidate = cwdRepo;
      source = 'calling git worktree';
    }
  }
  if (!candidate) {
    candidate = inferFromMetadata(engine, brand, metadataCandidates);
    source = 'legacy product metadata';
  }
  if (!candidate) {
    throw new Error('workspace requires --project <product-repo> (or invocation from that product git worktree)');
  }
  const gitRoot = findGitRoot(candidate);
  if (!gitRoot) throw new Error(`product repository does not exist or has no .git marker: ${candidate}`);
  const selectedRoot = source === 'calling git worktree' ? gitRoot : canonical(candidate);
  if (!existsSync(selectedRoot) || !lstatSync(selectedRoot).isDirectory()) {
    throw new Error(`product repository path is not an existing directory: ${candidate}`);
  }
  const canonicalRoot = canonical(selectedRoot);
  if (engine && (isInside(engine, canonicalRoot) || isInside(canonicalRoot, engine))) {
    throw new Error(`product repository must be outside the animation engine (${source})`);
  }
  return {projectRoot: canonicalRoot, projectSource: source};
}

export function resolveWorkspace(engineRoot, {brand, project, cwd, metadataCandidates} = {}) {
  if (typeof brand !== 'string' || !/^[a-z0-9][a-z0-9-]*$/i.test(brand)) {
    throw new Error('workspace brand must be a safe slug (letters, digits, and hyphens)');
  }
  const engine = engineRoot ? canonical(engineRoot) : null;
  const {projectRoot, projectSource} = resolveProjectRoot(engine, {brand, project, cwd, metadataCandidates});
  const outRoot = join(projectRoot, 'marketing', 'assets');
  const brandRoot = join(outRoot, brand);
  const workspace = {
    engineRoot: engine,
    projectRoot,
    projectSource,
    outRoot,
    brandRoot,
    brandOut: brandRoot,
    marketingDir: join(brandRoot, 'marketing'),
    matrixDir: join(brandRoot, 'matrix'),
    thumbsDir: join(brandRoot, 'thumbs'),
    captionsDir: join(brandRoot, 'captions'),
    postkitDir: join(brandRoot, 'postkit'),
    propsDir: join(brandRoot, 'props'),
    assetsDir: join(brandRoot, 'assets'),
    publicDir: join(brandRoot, 'public'),
  };
  for (const [name, path] of Object.entries(workspace)) {
    if (!name.endsWith('Dir') && !['outRoot', 'brandRoot', 'brandOut'].includes(name)) continue;
    if (!isInside(projectRoot, canonical(path))) {
      throw new Error(`workspace ${name} escapes product repository through an existing link: ${path}`);
    }
  }
  rejectWorkspaceLinks(brandRoot);
  return workspace;
}

// Production inputs and evidence may be named relative to the product repo, but
// never escape it through an absolute path or traversal segment.
export function resolveWorkspacePath(workspace, raw) {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('workspace path is required');
  const path = isAbsolute(raw) ? resolve(raw) : resolve(workspace.projectRoot, raw);
  const canonicalPath = canonical(path);
  if (!isInside(workspace.projectRoot, canonicalPath)) {
    throw new Error(`workspace path escapes product repository: ${raw}`);
  }
  return canonicalPath;
}
