import test from 'node:test';
import assert from 'node:assert/strict';
import {
  buildTtsUrl,
  buildTtsTimestampsUrl,
  buildMusicBody,
  parseFfprobeDuration,
  redact,
  resolveProbeFile,
  resolveWordsArgs,
  aggregateWords,
  estimateWords,
  resolveVoiceId,
} from './client.mjs';

test('buildTtsUrl embeds the voice id and mp3 output format', () => {
  assert.equal(
    buildTtsUrl('21m00Tcm4TlvDq8ikWAM'),
    'https://api.elevenlabs.io/v1/text-to-speech/21m00Tcm4TlvDq8ikWAM?output_format=mp3_44100_128',
  );
});

test('buildMusicBody carries prompt, length, and the music_v2 model', () => {
  assert.deepEqual(buildMusicBody('dark pulse', 45100), {
    prompt: 'dark pulse',
    music_length_ms: 45100,
    model_id: 'music_v2',
  });
});

test('parseFfprobeDuration reads HH:MM:SS.cc into ms', () => {
  const out = 'Input #0, mp3\n  Duration: 00:00:45.12, start: 0.02, bitrate: 128 kb/s';
  assert.equal(parseFfprobeDuration(out), 45120);
  assert.equal(parseFfprobeDuration('Duration: 00:01:02.50,'), 62500);
  assert.equal(parseFfprobeDuration('no duration here'), null);
});

test('redact strips the secret from arbitrary text', () => {
  assert.equal(redact('boom sk_123 happened', 'sk_123'), 'boom <redacted> happened');
});

test('resolveProbeFile extracts the --file path', () => {
  assert.equal(resolveProbeFile(['probe', '--file', 'out/logo.mp3']), 'out/logo.mp3');
});

test('resolveProbeFile throws when --file is missing', () => {
  assert.throws(() => resolveProbeFile(['probe']), /--file/);
});

test('resolveProbeFile throws when --file has no value', () => {
  assert.throws(() => resolveProbeFile(['probe', '--file']), /--file/);
});

test('buildTtsTimestampsUrl targets the with-timestamps endpoint', () => {
  assert.equal(
    buildTtsTimestampsUrl('v1'),
    'https://api.elevenlabs.io/v1/text-to-speech/v1/with-timestamps?output_format=mp3_44100_128',
  );
});

// 'Hi there.' at 100ms per character.
const HI_THERE = {
  characters: ['H', 'i', ' ', 't', 'h', 'e', 'r', 'e', '.'],
  character_start_times_seconds: [0.0, 0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8],
  character_end_times_seconds: [0.1, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.9],
};

test('aggregateWords groups characters into words with punctuation attached', () => {
  assert.deepEqual(aggregateWords(HI_THERE, 'Hi there.'), [
    {w: 'Hi', startMs: 0, endMs: 200},
    {w: 'there.', startMs: 300, endMs: 900},
  ]);
});

test('aggregateWords throws when the alignment arrays disagree', () => {
  const bad = {...HI_THERE, character_end_times_seconds: [0.1, 0.2]};
  assert.throws(() => aggregateWords(bad, 'Hi there.'), /alignment arrays disagree/);
});

test('aggregateWords throws when the table does not reconstruct the submitted text', () => {
  assert.throws(() => aggregateWords(HI_THERE, 'Hi everyone.'), /does not reconstruct/);
});

test('aggregateWords throws on non-monotonic word starts', () => {
  const bad = {
    characters: ['a', ' ', 'b'],
    character_start_times_seconds: [0.5, 0.6, 0.1],
    character_end_times_seconds: [0.6, 0.7, 0.2],
  };
  assert.throws(() => aggregateWords(bad, 'a b'), /non-monotonic word starts at index 1/);
});

test('aggregateWords throws on a whitespace-only alignment', () => {
  const blank = {
    characters: [' ', ' '],
    character_start_times_seconds: [0, 0.1],
    character_end_times_seconds: [0.1, 0.2],
  };
  assert.throws(() => aggregateWords(blank, '  '), /no word-level timestamps/);
});

test('estimateWords spreads words evenly across the measured duration', () => {
  const words = estimateWords('a b c d', 4000);
  assert.deepEqual(
    words.map((w) => w.startMs),
    [0, 1000, 2000, 3000],
  );
  assert.deepEqual(
    words.map((w) => w.endMs),
    [1000, 2000, 3000, 4000],
  );
});

test('estimateWords throws on empty text or a non-positive duration', () => {
  assert.throws(() => estimateWords('', 1000), /non-empty text/);
  assert.throws(() => estimateWords('a', 0), /durationMs > 0/);
});

test('resolveWordsArgs extracts file, text, and out', () => {
  assert.deepEqual(
    resolveWordsArgs(['words', '--file', 'x.mp3', '--text', 'hi', '--out', 'x.json']),
    {file: 'x.mp3', text: 'hi', out: 'x.json'},
  );
});

test('resolveWordsArgs throws when --out is missing', () => {
  assert.throws(
    () => resolveWordsArgs(['words', '--file', 'x.mp3', '--text', 'hi']),
    /words requires --file, --text, --out/,
  );
});

test('resolveVoiceId prefers the brand override over global over default', (t) => {
  const savedGlobal = process.env.ELEVENLABS_VOICE_ID;
  const savedBrand = process.env.ELEVENLABS_VOICE_ID_PRACTICAL_SYSTEMS;
  t.after(() => {
    if (savedGlobal === undefined) delete process.env.ELEVENLABS_VOICE_ID;
    else process.env.ELEVENLABS_VOICE_ID = savedGlobal;
    if (savedBrand === undefined) delete process.env.ELEVENLABS_VOICE_ID_PRACTICAL_SYSTEMS;
    else process.env.ELEVENLABS_VOICE_ID_PRACTICAL_SYSTEMS = savedBrand;
  });
  delete process.env.ELEVENLABS_VOICE_ID;
  delete process.env.ELEVENLABS_VOICE_ID_PRACTICAL_SYSTEMS;

  assert.deepEqual(resolveVoiceId(process.env, 'practical-systems'), {
    voice: '21m00Tcm4TlvDq8ikWAM',
    source: 'default',
  });

  process.env.ELEVENLABS_VOICE_ID = 'global-voice';
  assert.deepEqual(resolveVoiceId(process.env, 'practical-systems'), {
    voice: 'global-voice',
    source: 'global env (ELEVENLABS_VOICE_ID)',
  });

  process.env.ELEVENLABS_VOICE_ID_PRACTICAL_SYSTEMS = 'brand-voice';
  assert.deepEqual(resolveVoiceId(process.env, 'practical-systems'), {
    voice: 'brand-voice',
    source: 'brand env (ELEVENLABS_VOICE_ID_PRACTICAL_SYSTEMS)',
  });

  // No brand id: global still applies, brand override is never consulted.
  assert.deepEqual(resolveVoiceId(process.env, undefined), {
    voice: 'global-voice',
    source: 'global env (ELEVENLABS_VOICE_ID)',
  });
});
