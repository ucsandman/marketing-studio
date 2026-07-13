// Unit tests for the pure helpers in build-wrap-props.mjs (the module is
// import-safe: main() only runs when executed directly, matching
// build-magnetic-demo-media.mjs's isMain convention).
// Run: node --test scripts/build-wrap-props.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {propsForSegment, stagedVideoName} from './build-wrap-props.mjs';

const manifest = {
  version: 1,
  video: 'video.mp4',
  captions: 'captions.srt',
  fps: 30,
  exportedAt: '2026-07-12T20:00:00Z',
  segments: [
    {id: 'guard', title: 'Guard decisions', startSec: 12.5, endSec: 41},
    {id: 'ledger', title: 'Ledger view', startSec: 60, endSec: 90},
  ],
};

const cues = [
  {startSec: 5, endSec: 10, text: 'before the window'},
  {startSec: 20, endSec: 25, text: 'inside the window'},
  {startSec: 50, endSec: 55, text: 'after the window'},
];

test('propsForSegment returns the exact WrapClip props shape, captions windowed + re-based', () => {
  const segment = manifest.segments[0];
  const props = propsForSegment(manifest, cues, segment, 'dashclaw', 'dashclaw/wrap-handoff.mp4', 'Govern your agents at dashclaw.io');
  assert.deepEqual(props, {
    brandId: 'dashclaw',
    video: 'dashclaw/wrap-handoff.mp4',
    segment: {startSec: 12.5, endSec: 41, title: 'Guard decisions'},
    captions: [
      {startSec: 7.5, endSec: 12.5, text: 'inside the window'},
    ],
    cta: 'Govern your agents at dashclaw.io',
    music: null,
  });
});

test('propsForSegment throws naming the segment when it is not in manifest.segments', () => {
  const foreignSegment = {id: 'nope', title: 'x', startSec: 0, endSec: 1};
  assert.throws(
    () => propsForSegment(manifest, cues, foreignSegment, 'dashclaw', 'dashclaw/wrap-handoff.mp4', 'cta'),
    /nope/,
  );
});

test('stagedVideoName derives wrap-<basename>.mp4 from the handoff dir', () => {
  assert.equal(stagedVideoName('C:\\Users\\x\\handoff-abc'), 'wrap-handoff-abc.mp4');
  assert.equal(stagedVideoName('/tmp/handoff-xyz'), 'wrap-handoff-xyz.mp4');
});
