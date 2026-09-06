// Unit tests for the pure helpers in build-magnetic-demo-media.mjs (the module
// is import-safe: main() only runs when executed directly).
// Run: node --test scripts/build-magnetic-demo-media.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {join} from 'node:path';
import {
  assertScriptedPauses,
  frameInventory,
  magneticMediaPaths,
  parseSilenceDurations,
  sameConfig,
} from './build-magnetic-demo-media.mjs';

test('magneticMediaPaths matches the recorder media contract', () => {
  const workspace = {assetsDir: join('product', 'marketing', 'assets', 'magnetic', 'assets')};
  const paths = magneticMediaPaths(workspace);
  assert.equal(paths.mediaDir, join(workspace.assetsDir, 'demo-media'));
  assert.equal(paths.footageDir, join(paths.mediaDir, 'frames'));
  assert.equal(paths.voDir, join(paths.mediaDir, 'vo'));
});

test('frameInventory: contiguous sequence has no strays', () => {
  const names = ['frame_0001.png', 'frame_0002.png', 'frame_0003.png', 'render-config.json'];
  assert.deepEqual(frameInventory(names), {prefix: 3, strays: []});
});

test('frameInventory: frames beyond a gap are strays (orphan contamination)', () => {
  // frames 1-2 contiguous, then an orphaned process left 5, 7, 9
  const names = ['frame_0001.png', 'frame_0002.png', 'frame_0005.png', 'frame_0009.png', 'frame_0007.png'];
  assert.deepEqual(frameInventory(names), {prefix: 2, strays: [5, 7, 9]});
});

test('frameInventory: no frame 1 means everything is a stray', () => {
  const names = ['frame_0002.png', 'frame_0003.png'];
  assert.deepEqual(frameInventory(names), {prefix: 0, strays: [2, 3]});
});

test('frameInventory: empty dir', () => {
  assert.deepEqual(frameInventory([]), {prefix: 0, strays: []});
});

test('frameInventory: non-frame files are ignored', () => {
  assert.deepEqual(frameInventory(['render-config.json', 'notes.txt']), {prefix: 0, strays: []});
});

test('sameConfig: equal configs match regardless of key order', () => {
  assert.equal(sameConfig({a: 1, b: {c: 2, d: 3}}, {b: {d: 3, c: 2}, a: 1}), true);
});

test('sameConfig: any knob difference is a mismatch', () => {
  assert.equal(sameConfig({accent: '#0a84ff', scale: 1.2}, {accent: '#0a84ff', scale: 2.6}), false);
  assert.equal(sameConfig({accent: '#0a84ff'}, {accent: '#0a84ff', extra: 1}), false);
});

const FFMPEG_OUTPUT = [
  '[silencedetect @ 0x1] silence_start: 2.013152',
  '[silencedetect @ 0x1] silence_end: 4.814762 | silence_duration: 2.80161',
  '[silencedetect @ 0x1] silence_start: 7.541678',
  '[silencedetect @ 0x1] silence_end: 10.30127 | silence_duration: 2.759592',
].join('\n');

test('parseSilenceDurations: extracts every silence_duration', () => {
  assert.deepEqual(parseSilenceDurations(FFMPEG_OUTPUT), [2.80161, 2.759592]);
});

test('parseSilenceDurations: no silences -> empty', () => {
  assert.deepEqual(parseSilenceDurations('size=N/A time=00:00:11.58 bitrate=N/A'), []);
});

test('assertScriptedPauses: accepts exactly two 2-3s pauses', () => {
  assert.doesNotThrow(() => assertScriptedPauses([2.80161, 2.759592]));
});

test('assertScriptedPauses: rejects wrong count', () => {
  assert.throws(() => assertScriptedPauses([2.8]), /expected 2 detected silences/);
  assert.throws(() => assertScriptedPauses([2.8, 2.7, 2.6]), /expected 2 detected silences/);
  assert.throws(() => assertScriptedPauses([]), /expected 2 detected silences/);
});

test('assertScriptedPauses: rejects durations outside [2,3]s', () => {
  assert.throws(() => assertScriptedPauses([1.9, 2.8]), /outside the scripted 2-3s window/);
  assert.throws(() => assertScriptedPauses([2.8, 3.26]), /outside the scripted 2-3s window/);
});
