import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {copyFileSync, existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {dirname, join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {buildReviewArchive, copyMigration, inventoryMigration, loadReviewedManifest, parseMappings, removeVerifiedSources} from './migrate-workspace.mjs';

function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'migrate-workspace-test-'));
  const engine = join(root, 'engine');
  const product = join(root, 'product');
  mkdirSync(join(engine, '.git'), {recursive: true});
  mkdirSync(join(product, '.git'), {recursive: true});
  mkdirSync(join(engine, 'props'), {recursive: true});
  mkdirSync(join(engine, 'examples', 'demo'), {recursive: true});
  writeFileSync(join(engine, 'props', 'demo-launch.json'), '{"brandId":"demo"}\n');
  writeFileSync(join(engine, 'examples', 'demo', 'launch.mp4'), 'media');
  return {root, engine, product};
}

test('parseMappings accepts separated and equals forms', () => {
  assert.deepEqual([...parseMappings(['--map', 'one=C:/one', '--map=two=C:/two'])], [['one', 'C:/one'], ['two', 'C:/two']]);
});

test('dry-run inventories props and example media with bytes and hashes, then copy verifies', () => {
  const f = fixture();
  try {
    const manifest = inventoryMigration(f.engine, new Map([['demo', f.product]]));
    assert.equal(manifest.items.length, 2);
    assert.ok(manifest.items.every((item) => item.status === 'copy-ready' && item.bytes > 0 && /^[a-f0-9]{64}$/.test(item.sha256)));
    assert.equal(copyMigration(manifest), 2);
    assert.ok(manifest.items.every((item) => item.status === 'copied-verified'));
    for (const item of manifest.items) assert.equal(readFileSync(item.destination, 'utf8'), readFileSync(item.source, 'utf8'));
  } finally {
    rmSync(f.root, {recursive: true, force: true});
  }
});

test('copy skips a differing destination and never overwrites it', () => {
  const f = fixture();
  try {
    const first = inventoryMigration(f.engine, new Map([['demo', f.product]]));
    mkdirSync(join(f.product, 'marketing', 'assets', 'demo', 'props'), {recursive: true});
    const dest = join(f.product, 'marketing', 'assets', 'demo', 'props', 'demo-launch.json');
    writeFileSync(dest, 'user-owned');
    const manifest = inventoryMigration(f.engine, new Map([['demo', f.product]]));
    assert.equal(manifest.items.find((item) => item.destination === dest).status, 'collision');
    assert.equal(copyMigration(manifest), 2);
    assert.equal(readFileSync(dest, 'utf8'), 'user-owned');
    const archived = manifest.items.find((item) => item.destination === dest);
    assert.equal(archived.archiveStatus, 'copied-verified');
    assert.equal(readFileSync(archived.archiveDestination, 'utf8'), '{"brandId":"demo"}\n');
    assert.ok(first.items.length > 0);
  } finally {
    rmSync(f.root, {recursive: true, force: true});
  }
});

test('review archive hashes and copies unmapped diagnostics outside the engine', () => {
  const f = fixture();
  try {
    mkdirSync(join(f.engine, 'out', 'proof'), {recursive: true});
    writeFileSync(join(f.engine, 'out', 'proof', 'frame.png'), 'proof');
    const manifest = inventoryMigration(f.engine, new Map([['demo', f.product]]));
    const rows = buildReviewArchive(manifest, join(f.root, 'review'), true);
    const row = rows.find((item) => item.source.endsWith('frame.png'));
    assert.equal(row.status, 'copied-verified');
    assert.equal(readFileSync(row.destination, 'utf8'), 'proof');
  } finally {
    rmSync(f.root, {recursive: true, force: true});
  }
});

test('source cleanup removes only files with current hash-matched destinations', () => {
  const f = fixture();
  try {
    const manifest = inventoryMigration(f.engine, new Map([['demo', f.product]]));
    copyMigration(manifest);
    const changed = manifest.items.find((item) => item.source.endsWith('launch.mp4'));
    writeFileSync(changed.destination, 'changed-after-copy');
    const result = removeVerifiedSources(manifest);
    assert.equal(result.removed, 1);
    assert.equal(result.skipped.length, 1);
    assert.equal(readFileSync(changed.source, 'utf8'), 'media');
  } finally {
    rmSync(f.root, {recursive: true, force: true});
  }
});

test('removal phase loads a persisted reviewed manifest and rejects another engine', () => {
  const f = fixture();
  const path = join(f.root, 'reviewed.json');
  try {
    const manifest = inventoryMigration(f.engine, new Map([['demo', f.product]]));
    copyMigration(manifest);
    writeFileSync(path, JSON.stringify(manifest));
    assert.equal(loadReviewedManifest(path, f.engine).items.length, 2);
    assert.throws(() => loadReviewedManifest(path, f.product), /different animation engine/);
  } finally {
    rmSync(f.root, {recursive: true, force: true});
  }
});

test('CLI rejects copy and removal in the same invocation', () => {
  const path = join(tmpdir(), `migration-reject-${process.pid}-${Date.now()}.json`);
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./migrate-workspace.mjs', import.meta.url)), '--copy', '--remove-sources', '--manifest', path], {encoding: 'utf8'});
  assert.equal(result.status, 1);
  assert.match(result.stderr, /separate phases/);
});

test('inventory skips junctions instead of traversing them', (t) => {
  const f = fixture();
  const outside = join(f.root, 'outside');
  mkdirSync(outside);
  writeFileSync(join(outside, 'secret.bin'), 'outside');
  try {
    try { symlinkSync(outside, join(f.engine, 'examples', 'demo', 'linked'), 'junction'); }
    catch (error) { t.skip(`junction unavailable: ${error.code}`); return; }
    const manifest = inventoryMigration(f.engine, new Map([['demo', f.product]]));
    assert.ok(manifest.skipped.some((row) => row.reason === 'symbolic-link-or-junction'));
    assert.ok(manifest.items.every((item) => !item.source.endsWith('secret.bin')));
  } finally {
    rmSync(f.root, {recursive: true, force: true});
  }
});

test('inventory rejects a top-level props junction', (t) => {
  const f = fixture();
  const outside = join(f.root, 'outside-props');
  mkdirSync(outside);
  writeFileSync(join(outside, 'demo-launch.json'), 'outside');
  rmSync(join(f.engine, 'props'), {recursive: true});
  try {
    try { symlinkSync(outside, join(f.engine, 'props'), 'junction'); }
    catch (error) { t.skip(`junction unavailable: ${error.code}`); return; }
    const manifest = inventoryMigration(f.engine, new Map([['demo', f.product]]));
    assert.ok(manifest.skipped.some((row) => row.source === join(f.engine, 'props') && row.reason === 'symbolic-link-or-junction'));
    assert.ok(manifest.items.every((item) => item.source !== join(f.engine, 'props', 'demo-launch.json')));
  } finally {
    rmSync(f.root, {recursive: true, force: true});
  }
});

test('review archive rejects a descendant junction before copying', (t) => {
  const f = fixture();
  const outside = join(f.root, 'outside-archive');
  const archive = join(f.root, 'review');
  mkdirSync(join(f.engine, 'out', 'diagnostic'), {recursive: true});
  writeFileSync(join(f.engine, 'out', 'diagnostic', 'frame.png'), 'proof');
  mkdirSync(outside);
  mkdirSync(archive);
  try {
    try { symlinkSync(outside, join(archive, 'out'), 'junction'); }
    catch (error) { t.skip(`junction unavailable: ${error.code}`); return; }
    const manifest = inventoryMigration(f.engine, new Map([['demo', f.product]]));
    assert.throws(() => buildReviewArchive(manifest, archive, true), /escapes its selected root/);
    assert.equal(existsSync(join(outside, 'diagnostic', 'frame.png')), false);
  } finally {
    rmSync(f.root, {recursive: true, force: true});
  }
});

test('removal rejects a destination redirected after review', (t) => {
  const f = fixture();
  const outside = join(f.root, 'outside-destination');
  try {
    const manifest = inventoryMigration(f.engine, new Map([['demo', f.product]]));
    copyMigration(manifest);
    const row = manifest.items.find((item) => item.source.endsWith('launch.mp4'));
    const parent = dirname(row.destination);
    rmSync(parent, {recursive: true});
    mkdirSync(outside);
    copyFileSync(row.source, join(outside, 'launch.mp4'));
    try { symlinkSync(outside, parent, 'junction'); }
    catch (error) { t.skip(`junction unavailable: ${error.code}`); return; }
    const result = removeVerifiedSources(manifest);
    assert.ok(result.skipped.some((item) => item.source === row.source));
    assert.equal(existsSync(row.source), true);
  } finally {
    rmSync(f.root, {recursive: true, force: true});
  }
});

test('removal never treats a top-level legacy junction target as an allowed root', (t) => {
  const f = fixture();
  const outside = join(f.root, 'outside-source');
  const destination = join(f.product, 'marketing', 'any.bin');
  mkdirSync(outside);
  writeFileSync(join(outside, 'foreign.bin'), 'same');
  mkdirSync(join(f.product, 'marketing'), {recursive: true});
  writeFileSync(destination, 'same');
  try {
    try { symlinkSync(outside, join(f.engine, 'out'), 'junction'); }
    catch (error) { t.skip(`junction unavailable: ${error.code}`); return; }
    const source = join(f.engine, 'out', 'foreign.bin');
    const hash = createHash('sha256').update('same').digest('hex');
    const result = removeVerifiedSources({engineRoot: f.engine, items: [{source, destination, projectRoot: f.product, bytes: 4, sha256: hash}]});
    assert.equal(result.removed, 0);
    assert.equal(existsSync(join(outside, 'foreign.bin')), true);
  } finally {
    rmSync(f.root, {recursive: true, force: true});
  }
});

test('copy rechecks the final destination after inventory and rejects a junction race', (t) => {
  const f = fixture();
  const outside = join(f.root, 'outside');
  mkdirSync(outside);
  try {
    const manifest = inventoryMigration(f.engine, new Map([['demo', f.product]]));
    const target = manifest.items.find((item) => item.source.endsWith('launch.mp4'));
    mkdirSync(join(f.product, 'marketing', 'assets', 'demo', 'assets'), {recursive: true});
    try { symlinkSync(outside, join(f.product, 'marketing', 'assets', 'demo', 'assets', 'examples'), 'junction'); }
    catch (error) { t.skip(`junction unavailable: ${error.code}`); return; }
    assert.throws(() => copyMigration({items: [target]}), /escapes product repository/);
  } finally {
    rmSync(f.root, {recursive: true, force: true});
  }
});
