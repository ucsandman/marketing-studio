import test from 'node:test';
import assert from 'node:assert/strict';
import {validateManifest, parseSrt, windowCues} from './wrap-contract.mjs';

const good = {version: 1, video: 'video.mp4', captions: 'captions.srt', fps: 30,
  exportedAt: '2026-07-12T20:00:00Z',
  segments: [{id: 'guard', title: 'Guard decisions', startSec: 12.5, endSec: 41}]};

test('valid manifest passes', () => { assert.deepEqual(validateManifest(good), good); });
test('wrong version throws naming version', () => {
  assert.throws(() => validateManifest({...good, version: 2}), /version/);
});
test('endSec <= startSec throws naming the segment id', () => {
  assert.throws(() => validateManifest({...good,
    segments: [{id: 'bad', title: 'x', startSec: 5, endSec: 5}]}), /bad/);
});
test('duplicate ids throw', () => {
  assert.throws(() => validateManifest({...good, segments: [
    {id: 'a', title: 'x', startSec: 0, endSec: 1},
    {id: 'a', title: 'y', startSec: 2, endSec: 3}]}), /duplicate/i);
});
test('parseSrt parses cues incl multi-line and CRLF', () => {
  const srt = '1\r\n00:00:10,000 --> 00:00:14,000\r\nhello\r\nworld\r\n\r\n2\r\n00:00:20,500 --> 00:00:21,000\r\nbye\r\n';
  assert.deepEqual(parseSrt(srt), [
    {startSec: 10, endSec: 14, text: 'hello world'},
    {startSec: 20.5, endSec: 21, text: 'bye'},
  ]);
});
test('windowCues clamps and re-bases', () => {
  const cues = [{startSec: 10, endSec: 14, text: 'a'}, {startSec: 30, endSec: 31, text: 'b'}];
  assert.deepEqual(windowCues(cues, 12, 20), [{startSec: 0, endSec: 2, text: 'a'}]);
});
