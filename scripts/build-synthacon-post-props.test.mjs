import assert from 'node:assert/strict';
import {mkdtempSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {test} from 'node:test';
import {buildPostProps} from './build-synthacon-post-props.mjs';

test('writes one MotionVariant props file per manifest post', () => {
  const dir = mkdtempSync(join(tmpdir(), 'synthacon-post-props-'));
  const manifestPath = join(dir, 'posts.json');
  const propsDir = join(dir, 'props');
  writeFileSync(manifestPath, JSON.stringify([
    {id: 'next-owner', direction: 'A', headline: 'Every synth has a next owner.', caption: 'Buy, sell, and rent synthesizers with people who know the difference.'},
    {id: 'gear-near-you', direction: 'C', headline: 'Gear near you, from people who play', caption: 'Synths, drum machines, studio hardware', light: true},
  ]));

  const written = buildPostProps(manifestPath, propsDir);
  assert.deepEqual(written.map((path) => path.split('/').pop()), ['synthacon-post-next-owner.json', 'synthacon-post-gear-near-you.json']);
  assert.deepEqual(JSON.parse(readFileSync(join(propsDir, 'synthacon-post-next-owner.json'), 'utf8')), {
    brandId: 'synthacon',
    direction: 'A',
    headline: 'Every synth has a next owner.',
    caption: 'Buy, sell, and rent synthesizers with people who know the difference.',
    light: false,
  });
  assert.deepEqual(JSON.parse(readFileSync(join(propsDir, 'synthacon-post-gear-near-you.json'), 'utf8')), {
    brandId: 'synthacon',
    direction: 'C',
    headline: 'Gear near you, from people who play',
    caption: 'Synths, drum machines, studio hardware',
    light: true,
  });
  rmSync(dir, {recursive: true, force: true});
});
