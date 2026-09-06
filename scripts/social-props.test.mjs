// node --test scripts/social-props.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {resolveWorkspace} from './lib/workspace.mjs';

test('headlineOverVideo is set only by the practicalsystems clips; every other approved clip stays plain', (t) => {
  const projectRoot = mkdtempSync(join(tmpdir(), 'social-props-product-'));
  t.after(() => rmSync(projectRoot, {recursive: true, force: true}));
  mkdirSync(join(projectRoot, '.git'), {recursive: true});
  const propsDirs = new Map();
  const write = (brand, channel, headlineOverVideo = false) => {
    let propsDir = propsDirs.get(brand);
    if (!propsDir) {
      propsDir = resolveWorkspace(null, {brand, project: projectRoot}).propsDir;
      mkdirSync(propsDir, {recursive: true});
      propsDirs.set(brand, propsDir);
    }
    writeFileSync(join(propsDir, `${brand}-social-${channel}.json`), JSON.stringify({video: `${brand}/${channel}.mp4`, headlineOverVideo}));
  };
  for (const channel of ['x', 'linkedin', 'vertical']) write('practicalsystems', channel, true);
  for (const brand of ['costclaw', 'sidetap']) for (const channel of ['x', 'linkedin', 'vertical']) write(brand, channel);

  const files = [...propsDirs.values()].flatMap((propsDir) => readdirSync(propsDir).filter((file) => /-social-.*\.json$/.test(file)).map((file) => ({file, propsDir})));
  const withVideo = files.filter(({file, propsDir}) => JSON.parse(readFileSync(join(propsDir, file), 'utf8')).video);
  const flagged = files.filter(({file, propsDir}) => JSON.parse(readFileSync(join(propsDir, file), 'utf8')).headlineOverVideo === true).map(({file}) => file);
  assert.ok(withVideo.length > 3, `expected the six older video clips too, saw ${withVideo.length}`);
  assert.deepEqual(flagged.sort(), [
    'practicalsystems-social-linkedin.json',
    'practicalsystems-social-vertical.json',
    'practicalsystems-social-x.json',
  ]);
});
