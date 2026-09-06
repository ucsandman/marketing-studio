import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {existsSync} from 'node:fs';
import {dirname, relative, resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
const portable = (path) => path.replaceAll('\\', '/');
const generated = /^(?:out|assets|props|examples)\/|^studio\/public\/[^/]+\//;

export function existingGeneratedPaths(paths, base = root, present = existsSync) {
  return paths
    .map(portable)
    .filter((path) => generated.test(path) && present(resolve(base, path)));
}

function assertNoGenerated(paths, base = root, present = existsSync) {
  const forbidden = existingGeneratedPaths(paths, base, present);
  assert.deepEqual(forbidden, [], `legacy product outputs remain: ${forbidden.join(', ')}`);
  return forbidden;
}

test('output guard detects a synthetic legacy engine artifact', () => {
  const fixture = portable(relative(root, import.meta.filename));
  assert.throws(
    () => assertNoGenerated(['out/example/render.mp4', fixture], root, () => true),
    /out\/example\/render\.mp4/,
  );
});

test('tracked working tree contains no legacy product outputs', () => {
  const tracked = execFileSync('git', ['ls-files', '-z'], {cwd: root, encoding: 'utf8'})
    .split('\0')
    .filter(Boolean);
  const forbidden = assertNoGenerated(tracked);
  console.log(`source-output-guard: scanned=${tracked.length} forbidden=${forbidden.length}`);
  assert.ok(tracked.length > 100, `expected a real repository scan, got ${tracked.length} paths`);
});
