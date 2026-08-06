import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {dirname, join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {test} from 'node:test';
import {PLATFORM_MAP} from '../build-postkit.mjs';
import {parsePostsManifest} from './posts-manifest.mjs';

const root = dirname(dirname(dirname(fileURLToPath(import.meta.url))));
const platformRows = JSON.parse(readFileSync(join(root, 'scripts', 'platforms.json'), 'utf8'));
const platformById = new Map(platformRows.map((row) => [row.id, row]));
const platformKeys = Object.keys(PLATFORM_MAP);

const post = {
  id: 'next-owner',
  direction: 'A',
  headline: 'Every synth has a next owner.',
  caption: 'Buy, sell, and rent synthesizers with people who know the difference.',
};

test('defaults optional post fields without breaking a downstream builder', () => {
  const [parsed] = parsePostsManifest([post], platformKeys);
  assert.equal(parsed.light, false);
  assert.deepEqual(parsed.platforms, platformKeys);
});

test('rejects duplicate post ids', () => {
  assert.throws(() => parsePostsManifest([post, {...post}], platformKeys), /duplicate post id: next-owner/);
});

test('rejects an unknown direction', () => {
  assert.throws(() => parsePostsManifest([{...post, direction: 'B'}], platformKeys), /unknown direction "B"/);
});

test('rejects an unknown platform key', () => {
  assert.throws(() => parsePostsManifest([{...post, platforms: ['mastodon']}], platformKeys), /unknown platform key "mastodon"/);
});

test('rejects an em dash in public copy through lint-copy', () => {
  assert.throws(() => parsePostsManifest([{...post, caption: 'Every synth — has a next owner.'}], platformKeys), /em-dash/);
});

test('every default platform maps to PLATFORM_MAP and a MotionVariant platforms.json row', () => {
  const [parsed] = parsePostsManifest([post], platformKeys);
  for (const platformKey of parsed.platforms) {
    const cfg = PLATFORM_MAP[platformKey];
    assert.ok(cfg, `${platformKey}: missing PLATFORM_MAP entry`);
    const row = platformById.get(cfg.videoSource);
    assert.ok(row, `${platformKey}: ${cfg.videoSource} missing from platforms.json`);
    assert.equal(row.comp, 'MotionVariant', `${platformKey}: ${cfg.videoSource} is not MotionVariant`);
  }
});
