// node --test scripts/lib/cache.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {cacheKey, checkCache, storeCache} from './cache.mjs';
import {resolveWorkspace} from './workspace.mjs';

const BRAND = 'cachetest';
const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

function tmp() {
  const dir = mkdtempSync(join(tmpdir(), 'cache-test-'));
  mkdirSync(join(dir, '.git'));
  return {dir, workspace: resolveWorkspace(root, {brand: BRAND, project: dir})};
}

test('cacheKey is stable for identical parts', () => {
  const parts = {a: 1, b: [1, 2, 3], c: {x: 'y'}};
  assert.equal(cacheKey(parts), cacheKey({...parts}));
});

test('cacheKey ignores object key ORDER (canonical)', () => {
  assert.equal(
    cacheKey({a: 1, b: 2, nested: {p: 1, q: 2}}),
    cacheKey({b: 2, a: 1, nested: {q: 2, p: 1}}),
  );
});

test('cacheKey preserves array order (sequences are meaningful)', () => {
  assert.notEqual(cacheKey({v: [1, 2, 3]}), cacheKey({v: [3, 2, 1]}));
});

test('cacheKey changes when ANY part changes', () => {
  const base = {head: 'abc', porcelain: '', script: 'x', config: {w: 100}};
  const k = cacheKey(base);
  assert.notEqual(k, cacheKey({...base, head: 'abd'}), 'HEAD change');
  assert.notEqual(k, cacheKey({...base, porcelain: ' M file'}), 'dirty tree change');
  assert.notEqual(k, cacheKey({...base, script: 'y'}), 'script change');
  assert.notEqual(k, cacheKey({...base, config: {w: 101}}), 'config change');
});

test('store -> check round trip is a hit', () => {
  const {dir, workspace} = tmp();
  const art = join(dir, 'a.webm');
  writeFileSync(art, 'data');
  const key = cacheKey({n: 1});
  try {
    storeCache(workspace, 'capture', key, [art]);
    assert.equal(checkCache(workspace, 'capture', key, [art]).hit, true);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('miss when the stored key differs', () => {
  const {dir, workspace} = tmp();
  const art = join(dir, 'a.webm');
  writeFileSync(art, 'data');
  try {
    storeCache(workspace, 'capture', cacheKey({n: 1}), [art]);
    assert.equal(checkCache(workspace, 'capture', cacheKey({n: 2}), [art]).hit, false);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('miss when an artifact is missing', () => {
  const {dir, workspace} = tmp();
  const art = join(dir, 'gone.webm');
  const key = cacheKey({n: 3});
  try {
    storeCache(workspace, 'capture', key, [art]); // never created
    assert.equal(existsSync(art), false);
    assert.equal(checkCache(workspace, 'capture', key, [art]).hit, false);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('miss when an artifact is empty (size 0)', () => {
  const {dir, workspace} = tmp();
  const art = join(dir, 'empty.webm');
  writeFileSync(art, ''); // 0 bytes
  const key = cacheKey({n: 4});
  try {
    storeCache(workspace, 'capture', key, [art]);
    assert.equal(checkCache(workspace, 'capture', key, [art]).hit, false);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('storeCache persists meta and omits it when not given', () => {
  const {dir, workspace} = tmp();
  const art = join(dir, 'a.webm');
  writeFileSync(art, 'data');
  const key = cacheKey({n: 5});
  try {
    const withMeta = storeCache(workspace, 'capture', key, [art], {productRepo: 'C:/x', productHead: 'abc123'});
    assert.deepEqual(withMeta.meta, {productRepo: 'C:/x', productHead: 'abc123'});
    assert.equal(checkCache(workspace, 'capture', key, [art]).entry.meta.productHead, 'abc123');
    const without = storeCache(workspace, 'capture', key, [art]);
    assert.equal('meta' in without, false);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('separate stages do not collide', () => {
  const {dir, workspace} = tmp();
  const art = join(dir, 'a.webm');
  writeFileSync(art, 'data');
  const kCap = cacheKey({s: 'cap'});
  const kBl = cacheKey({s: 'bl'});
  try {
    storeCache(workspace, 'capture', kCap, [art]);
    storeCache(workspace, 'blender-stage', kBl, [art]);
    assert.equal(checkCache(workspace, 'capture', kCap, [art]).hit, true);
    assert.equal(checkCache(workspace, 'blender-stage', kBl, [art]).hit, true);
    assert.equal(checkCache(workspace, 'capture', kBl, [art]).hit, false); // wrong key for stage
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
