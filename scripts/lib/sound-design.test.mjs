import test from 'node:test';
import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {
  MAX_BRIDGE_FRAMES,
  assessMusicMarkers,
  detectBeatGrid,
  reportFindings,
  resolveNarrationLines,
} from './sound-design.mjs';
import {mixFilter} from '../score-film.mjs';
import {timingFromShots, voWindows} from '../../studio/src/lib/audioMix.ts';
import {pictureEventCues} from '../../studio/src/lib/sfxCues.ts';

test('J/L bridges resolve against the cut and stay bounded', () => {
  const lines = [
    {id: 'j', durationMs: 1000, bridge: {kind: 'J', cutMs: 2000, frames: 6}},
    {id: 'l', durationMs: 1000, bridge: {kind: 'L', cutMs: 3000, frames: 6}},
  ];
  const resolved = resolveNarrationLines(lines, 30, 5000);
  assert.equal(resolved[0].startMs, 1800);
  assert.equal(resolved[1].startMs, 2200);
  assert.throws(
    () => resolveNarrationLines([{id: 'bad', durationMs: 100, bridge: {kind: 'J', cutMs: 50, frames: MAX_BRIDGE_FRAMES}}], 30, 5000),
    /outside the picture/,
  );
});

test('shot audioRef places narration once, independent of visual ids', () => {
  const timing = timingFromShots(
    [
      {id: 'demo-wide', from: 10, len: 80, audioRef: 'demo'},
      {id: 'demo-detail', from: 90, len: 60, audioRef: null},
      {id: 'cta', from: 150, len: 45, audioRef: 'end'},
    ],
    ['demo', 'end'],
  );
  assert.deepEqual(timing.demo, {from: 10, len: 80});
  assert.deepEqual(timing.end, {from: 150, len: 45});
  assert.deepEqual(timing.logo, {from: 0, len: 0});
});

test('shot audioRef rejects duplicate replay and missing requested narration', () => {
  assert.throws(
    () => timingFromShots([
      {id: 'a', from: 0, len: 30, audioRef: 'hook'},
      {id: 'b', from: 30, len: 30, audioRef: 'hook'},
    ], ['hook']),
    /more than once/,
  );
  assert.throws(() => timingFromShots([{id: 'detail', from: 0, len: 30, audioRef: null}], ['hook']), /missing audio act/);
});

test('locked Truckside directed cut fits each measured VO once with safe tail handles', () => {
  const shots = [
    {id: 'hook', from: 0, len: 216, audioRef: 'hook'},
    {id: 'feature-0', from: 216, len: 170, audioRef: 'feature-0'},
    {id: 'feature-1', from: 386, len: 162, audioRef: 'feature-1'},
    {id: 'end', from: 548, len: 234, audioRef: 'end', audio: {music: 'resolve'}},
  ];
  // Durations were measured from the existing local Truckside MP3s with ffprobe;
  // this fixture locks the compact edit against those real narration handles.
  const lines = [
    {act: 'hook', src: 'audio/hook.mp3', durationMs: 6362, text: ''},
    {act: 'feature-0', src: 'audio/feature-0.mp3', durationMs: 4830, text: ''},
    {act: 'feature-1', src: 'audio/feature-1.mp3', durationMs: 4551, text: ''},
    {act: 'end', src: 'audio/end.mp3', durationMs: 6966, text: ''},
  ];
  const timing = timingFromShots(shots, lines.map((line) => line.act));
  const windows = voWindows(lines, timing);

  assert.deepEqual(lines.map((line) => line.act), ['hook', 'feature-0', 'feature-1', 'end']);
  assert.deepEqual(windows.map(({fromFrame, toFrame}) => [fromFrame, toFrame]), [
    [12, 203],
    [228, 373],
    [398, 535],
    [560, 769],
  ]);
  assert.deepEqual(windows.map((window, i) => shots[i].from + shots[i].len - window.toFrame), [13, 13, 13, 13]);
  assert.equal(new Set(windows.map((window) => window.src)).size, 4);
  assert.deepEqual(pictureEventCues(shots), []);
});

test('beat analysis only emits a BPM when the measured pulse train is defensible', () => {
  const samples = new Float32Array(400 * 12);
  for (let beat = 0; beat < 24; beat++) {
    const start = beat * 200; // 120 BPM at 400 Hz
    for (let i = 0; i < 12; i++) samples[start + i] = 0.8 * (1 - i / 12);
  }
  const analysis = detectBeatGrid(samples, 400);
  assert.equal(analysis.estimatedBpm, 120);
  assert.ok(analysis.confidence >= 0.55);
  assert.ok(analysis.beatTimesMs.length >= 8);
  assert.equal(detectBeatGrid(new Float32Array(100), 400).estimatedBpm, null);
});

test('long silence and constant input return no beat grid without hanging', () => {
  const moduleUrl = new URL('./sound-design.mjs', import.meta.url).href;
  const probe = spawnSync(
    process.execPath,
    ['--input-type=module', '--eval', `import {detectBeatGrid} from ${JSON.stringify(moduleUrl)}; process.stdout.write(JSON.stringify(detectBeatGrid(new Float32Array(4000), 400)));`],
    {encoding: 'utf8', timeout: 1500},
  );
  assert.equal(probe.signal, null, probe.error?.message);
  assert.equal(probe.status, 0, probe.stderr);
  assert.deepEqual(JSON.parse(probe.stdout), {estimatedBpm: null, confidence: 0, beatTimesMs: [], windows: 200});
  assert.deepEqual(detectBeatGrid(new Float32Array(4000).fill(0.25), 400), {
    estimatedBpm: null,
    confidence: 0,
    beatTimesMs: [],
    windows: 200,
  });
});

test('music markers retain picture time and report measured offset without snapping', () => {
  const [marker] = assessMusicMarkers(
    [{id: 'end:resolve', frame: 90, kind: 'resolve'}],
    {beatTimesMs: [2950], estimatedBpm: 120, confidence: 0.7, windows: 100},
    30,
  );
  assert.equal(marker.timeMs, 3000);
  assert.equal(marker.deltaMs, -50);
  assert.equal(marker.aligned, true);
});

test('production filter uses distinct narration and SFX buses', () => {
  const manifest = {
    fps: 30,
    lines: [{id: 'a', startMs: 500, durationMs: 1000}],
    sfx: [{frame: 45, name: 'tick'}],
  };
  const graph = mixFilter(manifest, 4, ['tick'], {productionBuses: true});
  assert.match(graph, /\[voice0\]highpass=f=75/);
  assert.match(graph, /\[S0_0\]amix=inputs=1[^;]*acompressor[^;]*\[sfxbus\]/);
  assert.match(graph, /\[bedd\]\[voice\]\[sfxbus\]amix=inputs=3/);
});

test('machine report keeps perceptual review explicitly incomplete', () => {
  const findings = reportFindings({
    measurements: {I: -14, TP: -1.2, LRA: 5},
    beatAnalysis: {estimatedBpm: null, confidence: 0.1, beatTimesMs: [], windows: 20},
    markerResults: [],
    expectedDurationSec: 10,
    actualDurationSec: 10,
  });
  assert.equal(findings.find((f) => f.category === 'perceptual-review')?.level, 'incomplete');
});
