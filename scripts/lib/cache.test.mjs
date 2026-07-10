// node --test scripts/lib/cache.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, writeFileSync, rmSync, existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {cacheKey, checkCache, storeCache} from './cache.mjs';

const BRAND = '__cachetest__'; // writes under out/__cachetest__/ (gitignored); cleaned in each test

function tmp() {
  return mkdtempSync(join(tmpdir(), 'cache-test-'));
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
  const dir = tmp();
  const art = join(dir, 'a.webm');
  writeFileSync(art, 'data');
  const key = cacheKey({n: 1});
  try {
    storeCache(BRAND, 'capture', key, [art]);
    assert.equal(checkCache(BRAND, 'capture', key, [art]).hit, true);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('miss when the stored key differs', () => {
  const dir = tmp();
  const art = join(dir, 'a.webm');
  writeFileSync(art, 'data');
  try {
    storeCache(BRAND, 'capture', cacheKey({n: 1}), [art]);
    assert.equal(checkCache(BRAND, 'capture', cacheKey({n: 2}), [art]).hit, false);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('miss when an artifact is missing', () => {
  const dir = tmp();
  const art = join(dir, 'gone.webm');
  const key = cacheKey({n: 3});
  try {
    storeCache(BRAND, 'capture', key, [art]); // never created
    assert.equal(existsSync(art), false);
    assert.equal(checkCache(BRAND, 'capture', key, [art]).hit, false);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('miss when an artifact is empty (size 0)', () => {
  const dir = tmp();
  const art = join(dir, 'empty.webm');
  writeFileSync(art, ''); // 0 bytes
  const key = cacheKey({n: 4});
  try {
    storeCache(BRAND, 'capture', key, [art]);
    assert.equal(checkCache(BRAND, 'capture', key, [art]).hit, false);
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});

test('separate stages do not collide', () => {
  const dir = tmp();
  const art = join(dir, 'a.webm');
  writeFileSync(art, 'data');
  const kCap = cacheKey({s: 'cap'});
  const kBl = cacheKey({s: 'bl'});
  try {
    storeCache(BRAND, 'capture', kCap, [art]);
    storeCache(BRAND, 'blender-stage', kBl, [art]);
    assert.equal(checkCache(BRAND, 'capture', kCap, [art]).hit, true);
    assert.equal(checkCache(BRAND, 'blender-stage', kBl, [art]).hit, true);
    assert.equal(checkCache(BRAND, 'capture', kBl, [art]).hit, false); // wrong key for stage
  } finally {
    rmSync(dir, {recursive: true, force: true});
  }
});
