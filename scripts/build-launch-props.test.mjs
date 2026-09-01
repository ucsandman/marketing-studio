// node --test scripts/build-launch-props.test.mjs
// The builder runs on import, so EMBED_AUDIO is read from its source text.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

test('every brand with measured VO word times is in EMBED_AUDIO', () => {
  // A brand whose picture lock is VO-derived must embed its audio manifest in
  // props/<brand>-launch.json, or every matrix/thumb/hook tool that reads those
  // props computes act lengths from launchTiming's constants instead of the VO.
  const src = readFileSync(join(root, 'scripts', 'build-launch-props.mjs'), 'utf8');
  const m = src.match(/const EMBED_AUDIO = new Set\(\[([^\]]*)\]\)/);
  assert.ok(m, 'EMBED_AUDIO set literal not found');
  const embed = new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  const wordTimed = readdirSync(join(root, 'props'))
    .filter((f) => f.endsWith('-audio.json'))
    .filter((f) => (JSON.parse(readFileSync(join(root, 'props', f), 'utf8')).lines ?? []).some((l) => l.words?.length))
    .map((f) => f.replace(/-audio\.json$/, ''));
  assert.ok(wordTimed.length > 0, 'no word-timed audio manifests found');
  assert.deepEqual(wordTimed.filter((b) => !embed.has(b)), [], `word-timed brands missing from EMBED_AUDIO (of ${wordTimed.length})`);
});
