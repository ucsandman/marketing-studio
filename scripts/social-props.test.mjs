// node --test scripts/social-props.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync, readdirSync} from 'node:fs';
import {join, dirname} from 'node:path';
import {fileURLToPath} from 'node:url';

const PROPS = join(dirname(fileURLToPath(import.meta.url)), '..', 'props');

test('headlineOverVideo is set only by the practicalsystems clips; every other approved clip stays plain', () => {
  const files = readdirSync(PROPS).filter((f) => /-social-.*\.json$/.test(f));
  const withVideo = files.filter((f) => JSON.parse(readFileSync(join(PROPS, f), 'utf8')).video);
  const flagged = files.filter((f) => JSON.parse(readFileSync(join(PROPS, f), 'utf8')).headlineOverVideo === true);
  assert.ok(withVideo.length > 3, `expected the six older video clips too, saw ${withVideo.length}`);
  assert.deepEqual(flagged.sort(), [
    'practicalsystems-social-linkedin.json',
    'practicalsystems-social-vertical.json',
    'practicalsystems-social-x.json',
  ]);
});
