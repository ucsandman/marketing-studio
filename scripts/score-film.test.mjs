import test from 'node:test';
import assert from 'node:assert/strict';
import {lineCollisions, mixFilter, nextGain, BREATH_MS} from './score-film.mjs';
import {classify, judge, filmStatus} from './check-audio.mjs';

const manifest = {
  fps: 30,
  music: {src: 'x/music.mp3'},
  lines: [
    {id: 'a', src: 'x/a.mp3', startMs: 400, durationMs: 4490},
    {id: 'b', src: 'x/b.mp3', startMs: 5420, durationMs: 3840},
  ],
  sfx: [
    {frame: 50, name: 'tick'},
    {frame: 116, name: 'tick'},
    {frame: 300, name: 'whoosh'},
  ],
};

test('lineCollisions flags a line that starts inside the previous one plus the breath', () => {
  assert.deepEqual(lineCollisions(manifest.lines, 28000), []);
  const tight = [manifest.lines[0], {id: 'b', startMs: 4890 + BREATH_MS - 1, durationMs: 100}];
  assert.equal(lineCollisions(tight, 28000).length, 1);
  assert.match(lineCollisions([{id: 'z', startMs: 27000, durationMs: 2000}], 28000)[0], /past the film/);
});

test('mixFilter places every line at its startMs, ducks the bed, lands every cue on its frame', () => {
  const f = mixFilter(manifest, 28.0, ['tick', 'whoosh']);
  assert.match(f, /\[2:a\]acompressor[^;]*adelay=400\|400\[vo0\]/);
  assert.match(f, /\[3:a\]acompressor[^;]*adelay=5420\|5420\[vo1\]/);
  assert.match(f, /sidechaincompress/);
  // the duck key is padded to the film, or the bed (and the picture with it) stops
  // when the last narration line does
  assert.match(f, /\[key0\]apad=whole_dur=28\.000\[key\]/);
  assert.match(f, /adelay=1667\|1667/); // frame 50 @30fps
  assert.match(f, /adelay=3867\|3867/); // frame 116
  assert.match(f, /adelay=10000\|10000/); // frame 300
  assert.match(f, /amix=inputs=5:normalize=0:duration=first\[mix\]$/); // bed + voice + 3 cues
});

test('mixFilter with --music-only has no narration inputs and no duck', () => {
  const f = mixFilter(manifest, 28.0, ['tick', 'whoosh'], {musicOnly: true});
  assert.doesNotMatch(f, /sidechaincompress|\[vo0\]/);
  assert.match(f, /amix=inputs=4:/);
});

test('nextGain moves by the measured shortfall', () => {
  assert.equal(nextGain(8.7, -11.8, -14), 6.5);
  assert.equal(nextGain(2.0, -15.0, -14), 3);
});

test('check-audio classifies delivery surfaces and skips deliberate silent files', () => {
  assert.equal(classify('postkit/x/social-16x9.mp4').check, true);
  assert.equal(classify('postkit/x/social-16x9-silent.mp4').check, false);
  assert.equal(classify('matrix/launch-16x9.mp4').check, true);
  assert.equal(classify('matrix/social-9x16-captioned.mp4').check, true);
  assert.equal(classify('matrix/social-9x16-captioned-silent.mp4').check, false);
  assert.equal(classify('launch.mp4').check, true);
  assert.equal(classify('launch-final.mp4').check, true);
  assert.equal(classify('social-x-final-v2.mp4').check, true);
  assert.equal(classify('launch-v2.mp4').check, false); // director-loop version, scored later
  assert.equal(classify('logo-reveal.mp4').check, false); // ingredient
  assert.equal(classify('og.mp4').check, false);
  assert.equal(classify('film/film-v4.mp4').check, false); // handled by filmStatus
});

test('check-audio judge fails no-audio, silent and off-target files', () => {
  assert.equal(judge({hasAudio: false}).verdict, 'FAIL');
  assert.equal(judge({hasAudio: true, meanDb: -60, I: -14}).verdict, 'FAIL');
  assert.equal(judge({hasAudio: true, meanDb: -20, I: -22}).verdict, 'FAIL');
  assert.equal(judge({hasAudio: true, meanDb: -20, I: -13.8}).verdict, 'PASS');
});

test('filmStatus wants the NEWEST version scored with narration', () => {
  assert.equal(filmStatus(['film-v3.mp4', 'film-v3-scored.mp4', 'film-v4.mp4'], {voLines: 7}).verdict, 'FAIL');
  assert.equal(filmStatus(['film-v4.mp4', 'film-v4-scored.mp4'], null).verdict, 'FAIL');
  assert.equal(filmStatus(['film-v4.mp4', 'film-v4-scored.mp4'], {voLines: 0, musicOnly: false}).verdict, 'FAIL');
  assert.equal(filmStatus(['film-v4.mp4', 'film-v4-scored.mp4'], {voLines: 0, musicOnly: true}).verdict, 'WARN');
  assert.equal(filmStatus(['film-v4.mp4', 'film-v4-scored.mp4'], {voLines: 7}).verdict, 'PASS');
  assert.equal(filmStatus(['scaffold-preview.mp4'], null), null);
});
