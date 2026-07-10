// Content-hash footage cache for the expensive capture and Blender-staging stages.
//
// A stage is a cache hit only when its inputs are byte-identical to the last run
// AND every artifact it produced is still on disk and non-empty. The key must
// cover EVERY real input — see the capture/staging integrations for the parts.
//
// Store: out/<brand>/marketing/cache.json, one entry per stage, atomic (temp+rename).
import {createHash} from 'node:crypto';
import {existsSync, mkdirSync, readFileSync, renameSync, statSync, writeFileSync} from 'node:fs';
import {dirname, join, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';

// Repo root, resolved from this file's location so the cache lands in the same
// place regardless of the caller's cwd.
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');

// Canonical form: sort object keys recursively so key ORDER never changes the
// hash. Arrays keep order (order is meaningful for sequences/views).
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    const out = {};
    for (const k of Object.keys(value).sort()) out[k] = canonical(value[k]);
    return out;
  }
  return value;
}

/** sha256 over canonical JSON of a named-parts object. Stable across key order. */
export function cacheKey(parts) {
  return createHash('sha256').update(JSON.stringify(canonical(parts))).digest('hex');
}

function cacheFile(brand) {
  return join(REPO_ROOT, 'out', brand, 'marketing', 'cache.json');
}

function readStore(brand) {
  const f = cacheFile(brand);
  if (!existsSync(f)) return {};
  try {
    return JSON.parse(readFileSync(f, 'utf8'));
  } catch {
    return {}; // corrupt cache => treat as empty (safe: forces a miss)
  }
}

/**
 * Hit only if the stored key matches AND every artifact path exists on disk as a
 * regular file with size > 0. Returns {hit, entry}.
 */
export function checkCache(brand, stage, key, artifacts = []) {
  const entry = readStore(brand)[stage];
  if (!entry || entry.key !== key) return {hit: false};
  for (const p of artifacts) {
    let st;
    try {
      st = statSync(p);
    } catch {
      return {hit: false}; // artifact gone
    }
    if (!st.isFile() || st.size <= 0) return {hit: false}; // missing/empty/dir
  }
  return {hit: true, entry};
}

/** Records/overwrites the entry for one stage. Atomic (temp file + rename). */
export function storeCache(brand, stage, key, artifacts = []) {
  const f = cacheFile(brand);
  mkdirSync(dirname(f), {recursive: true});
  const store = readStore(brand);
  store[stage] = {key, artifacts, storedAt: new Date().toISOString()};
  const tmp = `${f}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2) + '\n');
  renameSync(tmp, f); // atomic replace on the same volume
  return store[stage];
}
