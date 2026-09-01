// node --test scripts/fonts-faces.test.mjs
// studio/src/lib/fonts.ts is read as text: importing it fires the google-fonts loaders.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync, statSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'studio', 'src');
const walk = (dir) =>
  readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return walk(p);
    return /\.tsx?$/.test(f) && !/\.test\./.test(f) ? [p] : [];
  });

test('no font face is loaded that no component requests (an unrequested face is not inert)', () => {
  // The google-fonts loader registers one discrete FontFace per weight. A request
  // for a weight with no face falls back to the nearest loaded one, so adding a
  // heavier face silently re-weights every site that was falling back: Archivo 900
  // moved costclaw's eleven `fontWeight: 800` headings from 700 to 900 (2026-09-01).
  const requested = new Set(['400']); // the implicit default weight
  let sites = 0;
  for (const file of walk(SRC)) {
    for (const m of readFileSync(file, 'utf8').matchAll(/fontWeight:\s*'?(\d{3})'?/g)) {
      requested.add(m[1]);
      sites++;
    }
  }
  const fontsSrc = readFileSync(join(SRC, 'lib', 'fonts.ts'), 'utf8');
  const loaded = [...fontsSrc.matchAll(/weights:\s*\[([^\]]+)\]/g)].flatMap((m) =>
    [...m[1].matchAll(/'(\d{3})'/g)].map((w) => w[1]),
  );
  assert.ok(sites > 0 && loaded.length > 0, `scanned sites=${sites} faces=${loaded.length}`);
  assert.deepEqual(loaded.filter((w) => !requested.has(w)), [], `faces nobody requests (of ${loaded.length})`);
});
