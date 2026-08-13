// Unit tests for the pure helpers in judge-audio.mjs (the module is import-safe:
// main() only runs when executed directly, matching judge-av-sync.test.mjs).
// Run: node --test scripts/judge-audio.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeTokens,
  squash,
  levenshtein,
  similarity,
  parseFfprobeStreams,
  parseEbur128,
  parseSilenceEvents,
  parseVolumeDetect,
  matchLinesToWindows,
  MATCH_MIN_SCORE,
  checkStream,
  checkLoudness,
  checkEdgeSilence,
  checkInteriorGap,
  checkContent,
  checkOrder,
  checkTiming,
  duckFinding,
  neighborGapWindow,
  CONTENT_SIMILARITY_THRESHOLD,
  INTERIOR_GAP_WARN_S,
  LEADING_SILENCE_FAIL_S,
  TRAILING_SILENCE_FAIL_S,
  EDGE_SILENCE_TOLERANCE_S,
  FPS,
} from './judge-audio.mjs';
import {FADE_IN, FADE_OUT} from '../studio/src/lib/audioMix.ts';

// --- normalization + similarity (load-bearing) ------------------------------

test('normalizeTokens: lowercases, strips punctuation, collapses whitespace', () => {
  assert.deepEqual(normalizeTokens('CostClaw. A local audit for Claude Code.'), [
    'cost', 'claw', 'a', 'local', 'audit', 'for', 'claude', 'code',
  ]);
});

test('normalizeTokens: joins runs of single-character tokens ("n p x" -> "npx")', () => {
  assert.deepEqual(normalizeTokens('n p x costclaw audit'), ['npx', 'costclaw', 'audit']);
});

test('normalizeTokens: empty/whitespace-only text -> empty array', () => {
  assert.deepEqual(normalizeTokens(''), []);
  assert.deepEqual(normalizeTokens('   '), []);
});

test('squash: joins tokens with no separator', () => {
  assert.equal(squash(['cost', 'claw']), 'costclaw');
});

test('levenshtein: identical strings are 0, empty vs non-empty is the length', () => {
  assert.equal(levenshtein('abc', 'abc'), 0);
  assert.equal(levenshtein('', 'abc'), 3);
  assert.equal(levenshtein('abc', ''), 3);
});

test('similarity: "CostClaw." vs "Cost Claw," compare equal (measured whisper delta)', () => {
  const a = normalizeTokens('CostClaw.');
  const b = normalizeTokens('Cost Claw,');
  assert.equal(similarity(a, b), 1);
});

test('similarity: "n p x costclaw audit" vs "NPX Cost Claw audit" compare equal (measured whisper delta)', () => {
  const a = normalizeTokens('n p x costclaw audit');
  const b = normalizeTokens('NPX Cost Claw audit');
  assert.equal(similarity(a, b), 1);
});

test('similarity: "Each priced, with evidence." vs "each priced with evidence" compare equal (measured whisper delta)', () => {
  const a = normalizeTokens('Each priced, with evidence.');
  const b = normalizeTokens('each priced with evidence');
  assert.equal(similarity(a, b), 1);
});

test('similarity: unrelated sentences score well below the content threshold', () => {
  const a = normalizeTokens('Cache misses, model misrouting, sessions that outgrow the cache. Each priced, with evidence.');
  const b = normalizeTokens('The pricing engine now supports quarterly billing cycles for enterprise customers.');
  assert.ok(similarity(a, b) < CONTENT_SIMILARITY_THRESHOLD, `expected a low score, got ${similarity(a, b)}`);
});

// --- ffmpeg/ffprobe parsers, against REAL captured output ------------------
// Captured 2026-08-12 on out/costclaw/launch-final.mp4 (73.8s, aac 48kHz stereo).

const FFPROBE_JSON = {
  programs: [], stream_groups: [],
  streams: [
    {index: 0, codec_name: 'h264', codec_type: 'video', duration: '73.666667', side_data_list: [{}]},
    {index: 1, codec_name: 'aac', codec_type: 'audio', sample_rate: '48000', duration: '73.800000'},
  ],
  format: {duration: '73.800000'},
};

test('parseFfprobeStreams: extracts video/audio duration and sample rate', () => {
  assert.deepEqual(parseFfprobeStreams(FFPROBE_JSON), {
    hasAudio: true, videoDurationS: 73.8, audioDurationS: 73.8, sampleRate: 48000,
  });
});

test('parseFfprobeStreams: no audio stream -> hasAudio false', () => {
  const noAudio = {...FFPROBE_JSON, streams: [FFPROBE_JSON.streams[0]]};
  const parsed = parseFfprobeStreams(noAudio);
  assert.equal(parsed.hasAudio, false);
  assert.equal(parsed.audioDurationS, null);
});

const EBUR128_OUTPUT = [
  '[Parsed_ebur128_0 @ 00000202b398d440] Summary:',
  '',
  '  Integrated loudness:',
  '    I:         -16.0 LUFS',
  '    Threshold: -26.1 LUFS',
  '',
  '  Loudness range:',
  '    LRA:         2.8 LU',
  '    Threshold: -36.0 LUFS',
  '    LRA low:   -17.6 LUFS',
  '    LRA high:  -14.8 LUFS',
  '',
  '  True peak:',
  '    Peak:       -1.4 dBFS',
].join('\n');

test('parseEbur128: extracts integrated LUFS, LRA and true peak from a real Summary block', () => {
  assert.deepEqual(parseEbur128(EBUR128_OUTPUT), {integratedLufs: -16.0, lra: 2.8, truePeakDb: -1.4});
});

test('parseEbur128: unparseable text -> null', () => {
  assert.equal(parseEbur128('size=N/A time=00:00:11.58 bitrate=N/A'), null);
});

const SILENCEDETECT_OUTPUT = [
  '[Parsed_silencedetect_0 @ 000001372ee505c0] silence_start: 72.535479',
  '[Parsed_silencedetect_0 @ 000001372ee505c0] silence_end: 73.8 | silence_duration: 1.264521',
].join('\n');

test('parseSilenceEvents: extracts start/end/duration triples from real silencedetect output', () => {
  assert.deepEqual(parseSilenceEvents(SILENCEDETECT_OUTPUT), [
    {startS: 72.535479, endS: 73.8, durationS: 1.264521},
  ]);
});

test('parseSilenceEvents: no silences -> empty array', () => {
  assert.deepEqual(parseSilenceEvents('size=N/A time=00:00:11.58 bitrate=N/A'), []);
});

const VOLUMEDETECT_OUTPUT = [
  '[Parsed_volumedetect_0 @ 00000182dc0242c0] n_samples: 1058816',
  '[Parsed_volumedetect_0 @ 00000182dc0242c0] mean_volume: -18.7 dB',
  '[Parsed_volumedetect_0 @ 00000182dc0242c0] max_volume: -1.5 dB',
].join('\n');

test('parseVolumeDetect: extracts mean and max volume from real volumedetect output', () => {
  assert.deepEqual(parseVolumeDetect(VOLUMEDETECT_OUTPUT), {meanDb: -18.7, maxDb: -1.5});
});

// --- windowed line matching --------------------------------------------------
// A real word list (costclaw launch-final.mp4, faster-whisper "small"): logo,
// then a 40.4s gap spanning the interior speechless stretch, then feature-0 —
// enough to exercise window matching and ordering together.
const WORDS = [
  {w: 'Cost', start: 0.0, end: 0.78}, {w: 'Claw,', start: 0.78, end: 1.06},
  {w: 'a', start: 1.36, end: 1.5}, {w: 'local', start: 1.5, end: 1.7},
  {w: 'audit', start: 1.7, end: 2.06}, {w: 'for', start: 2.06, end: 2.26},
  {w: 'Claude', start: 2.26, end: 2.54}, {w: 'Code.', start: 2.54, end: 2.84},
  {w: 'Cache', start: 43.28, end: 43.96}, {w: 'misses,', start: 43.96, end: 44.26},
];

const LINES = [
  {act: 'logo', text: 'CostClaw. A local audit for Claude Code.', durationMs: 2870},
  {act: 'feature-0', text: 'Cache misses,', durationMs: 500},
];

test('matchLinesToWindows: finds the best-content-matching word window per line, unconstrained by position', () => {
  const matches = matchLinesToWindows(LINES, WORDS);
  assert.equal(matches[0].act, 'logo');
  assert.equal(matches[0].segment.startMs, 0);
  assert.equal(matches[0].segment.endMs, 2840);
  assert.equal(matches[0].score, 1);
  assert.equal(matches[1].act, 'feature-0');
  assert.equal(matches[1].segment.startMs, 43280);
});

test('matchLinesToWindows: a line whose words are nowhere in the transcript gets null', () => {
  const matches = matchLinesToWindows(LINES, WORDS.slice(0, 8)); // only the logo words
  const feature0 = matches.find((m) => m.act === 'feature-0');
  assert.equal(feature0.segment, null);
  assert.equal(feature0.score, 0);
});

// REGRESSION (three-brand evidence run, docs/ERRORS.md 2026-08-13): back-to-back
// VO lines with sub-second gaps. The old gap-grouped matcher merged all three
// into one blob, matched it to ONE act, and reported the neighbors "not heard at
// all" with their words sitting verbatim in the transcript — the sidetap
// feature-0/feature-2 and paperroute end false FAILs. Windows must not care
// about the 0.5s gaps.
test('matchLinesToWindows: back-to-back lines with sub-second gaps each match their own window', () => {
  const words = [
    {w: 'Under', start: 57.3, end: 57.6}, {w: 'it', start: 57.6, end: 57.8},
    {w: 'all,', start: 57.8, end: 58.2}, {w: 'the', start: 58.2, end: 58.4},
    {w: 'real', start: 58.4, end: 58.8}, {w: 'tree.', start: 58.8, end: 59.4},
    // 0.5s gap — under the old 1s threshold, so the old matcher merged here
    {w: 'Nervous?', start: 59.9, end: 60.4}, {w: 'Same.', start: 60.6, end: 61.0},
    // 0.6s gap
    {w: 'A', start: 61.6, end: 61.7}, {w: 'free', start: 61.7, end: 62.0},
    {w: 'Apple', start: 62.0, end: 62.4}, {w: 'ID.', start: 62.4, end: 62.9},
  ];
  const lines = [
    {act: 'feature-0', text: 'Under it all, the real tree.', durationMs: 2100},
    {act: 'feature-1', text: 'Nervous? Same.', durationMs: 1100},
    {act: 'feature-2', text: 'A free Apple ID.', durationMs: 1300},
  ];
  const matches = matchLinesToWindows(lines, words);
  for (const m of matches) assert.notEqual(m.segment, null, `${m.act} must be heard`);
  assert.equal(matches[0].segment.startMs, 57300);
  assert.equal(matches[0].segment.endMs, 59400);
  assert.equal(matches[1].segment.startMs, 59900);
  assert.equal(matches[1].segment.endMs, 61000);
  assert.equal(matches[2].segment.startMs, 61600);
  assert.equal(matches[2].segment.endMs, 62900);
  for (const m of matches) assert.ok(m.score >= CONTENT_SIMILARITY_THRESHOLD);
});

// REGRESSION: whisper stamped sidetap's hook-opening "This" as 1.2s-5.62s — the
// first word after a music-only stretch absorbs the gap, and 3.7s of music landed
// inside the measured VO span. Edge words longer than MAX_EDGE_WORD_S keep only
// their final (leading) second.
test('matchLinesToWindows: a pathologically stretched edge word does not inflate the window span', () => {
  const words = [
    {w: 'This', start: 1.2, end: 5.62}, // the real measured artifact
    {w: 'is', start: 5.62, end: 5.8},
    {w: 'real.', start: 5.8, end: 6.3},
  ];
  const matches = matchLinesToWindows([{act: 'hook', text: 'This is real.', durationMs: 1400}], words);
  assert.equal(matches[0].segment.startMs, 4620); // 5.62 - 1.0s, not 1.2
  assert.equal(matches[0].segment.endMs, 6300);
});

test('matchLinesToWindows: a lightly mangled line still matches (above the floor, below a perfect score)', () => {
  // paperroute's real end line: whisper heard "paperoot .gg" for "paperoute.gg".
  const words = [
    {w: 'Try', start: 0, end: 0.2}, {w: 'it', start: 0.2, end: 0.4},
    {w: 'free', start: 0.4, end: 0.7}, {w: 'at', start: 0.7, end: 0.9},
    {w: 'paperoot', start: 0.9, end: 1.5}, {w: '.gg', start: 1.5, end: 1.9},
  ];
  const lines = [{act: 'end', text: 'Try it free at paperoute.gg', durationMs: 1900}];
  const matches = matchLinesToWindows(lines, words);
  assert.notEqual(matches[0].segment, null);
  assert.ok(matches[0].score >= MATCH_MIN_SCORE);
  assert.ok(matches[0].score < 1);
});

// --- findings ----------------------------------------------------------------

test('checkStream: PASS when the audio stream spans the video', () => {
  const findings = checkStream({videoDurationS: 73.8, audioDurationS: 73.8, hasAudio: true, sampleRate: 48000});
  assert.equal(findings.find((f) => f.check === 'stream').level, 'PASS');
  assert.equal(findings.find((f) => f.check === 'sample-rate').level, 'PASS');
});

test('checkStream: FAIL when audio is short by more than 0.5s', () => {
  const findings = checkStream({videoDurationS: 73.8, audioDurationS: 70.0, hasAudio: true, sampleRate: 48000});
  assert.equal(findings.find((f) => f.check === 'stream').level, 'FAIL');
});

test('checkStream: FAIL when there is no audio stream at all', () => {
  const findings = checkStream({videoDurationS: 73.8, audioDurationS: null, hasAudio: false, sampleRate: null});
  assert.equal(findings[0].level, 'FAIL');
});

test('checkStream: WARN on an off-spec sample rate', () => {
  const findings = checkStream({videoDurationS: 73.8, audioDurationS: 73.8, hasAudio: true, sampleRate: 44100});
  assert.equal(findings.find((f) => f.check === 'sample-rate').level, 'WARN');
});

test('checkLoudness: PASS on-target, WARN/FAIL further off (mirrors master-audio.mjs targets)', () => {
  assert.equal(checkLoudness({integratedLufs: -14, truePeakDb: -3, lra: 7})[0].level, 'PASS');
  assert.equal(checkLoudness({integratedLufs: -16, truePeakDb: -1.4, lra: 2.8})[0].level, 'WARN'); // the real costclaw measurement
  assert.equal(checkLoudness({integratedLufs: -20, truePeakDb: 1, lra: 7})[0].level, 'FAIL');
});

test('checkEdgeSilence: FAIL only over the derived (fade + tolerance) threshold, on either edge', () => {
  const leadDur = LEADING_SILENCE_FAIL_S + 0.1;
  const trailDur = TRAILING_SILENCE_FAIL_S + 0.1;
  const events = [{startS: 0, endS: leadDur, durationS: leadDur}, {startS: 73.8 - trailDur, endS: 73.8, durationS: trailDur}];
  const findings = checkEdgeSilence(events, 73.8);
  assert.equal(findings.find((f) => f.check === 'leading-silence').level, 'FAIL');
  assert.equal(findings.find((f) => f.check === 'trailing-silence').level, 'FAIL');

  const clean = checkEdgeSilence([], 73.8);
  assert.equal(clean.every((f) => f.level === 'PASS'), true);
});

test('checkEdgeSilence: exactly at the derived boundary still PASSes', () => {
  const events = [{startS: 73.8 - TRAILING_SILENCE_FAIL_S, endS: 73.8, durationS: TRAILING_SILENCE_FAIL_S}];
  const findings = checkEdgeSilence(events, 73.8);
  assert.equal(findings.find((f) => f.check === 'trailing-silence').level, 'PASS');
});

test('checkEdgeSilence: costclaw baseline trailing silence (1.26s) now PASSes under the fade-derived bar', () => {
  const findings = checkEdgeSilence([{startS: 72.535479, endS: 73.8, durationS: 1.264521}], 73.8);
  assert.equal(findings.find((f) => f.check === 'trailing-silence').level, 'PASS');
});

// The bars must be DERIVED from audioMix.ts's fade constants, not literal numbers —
// asserting the formula (not today's 1.3s/1.7s) is what catches a retuned fade
// leaving the gate stale.
test('LEADING_SILENCE_FAIL_S / TRAILING_SILENCE_FAIL_S are derived from FADE_IN/FADE_OUT, not hardcoded', () => {
  assert.equal(LEADING_SILENCE_FAIL_S, FADE_IN / FPS + EDGE_SILENCE_TOLERANCE_S);
  assert.equal(TRAILING_SILENCE_FAIL_S, FADE_OUT / FPS + EDGE_SILENCE_TOLERANCE_S);
});

test('checkInteriorGap: WARN (not FAIL) over the threshold, carrying the measured number', () => {
  const words = [{start: 0, end: 19.78}, {start: 43.28, end: 44}];
  const findings = checkInteriorGap(words);
  assert.equal(findings[0].level, 'WARN');
  assert.equal(Math.round(findings[0].gapS * 10) / 10, 23.5);
});

test(`checkInteriorGap: PASS under the ${INTERIOR_GAP_WARN_S}s threshold`, () => {
  const words = [{start: 0, end: 1}, {start: 3, end: 4}];
  assert.equal(checkInteriorGap(words)[0].level, 'PASS');
});

test('checkContent: PASS on a high-similarity match, FAIL with both raw strings on a miss', () => {
  const matches = [
    {act: 'logo', manifestText: 'CostClaw.', segment: {text: 'Cost Claw,'}, score: 1},
    {act: 'feature-0', manifestText: 'Real line.', segment: {text: 'Totally different words.'}, score: 0.1},
    {act: 'end', manifestText: 'Never heard.', segment: null, score: 0},
  ];
  const findings = checkContent(matches);
  assert.equal(findings[0].level, 'PASS');
  assert.equal(findings[1].level, 'FAIL');
  assert.equal(findings[1].manifestText, 'Real line.');
  assert.equal(findings[1].heardText, 'Totally different words.');
  assert.equal(findings[2].level, 'FAIL');
  assert.equal(findings[2].heardText, null);
});

test('checkOrder: PASS when matched segments are in ascending time order', () => {
  const matches = [
    {act: 'logo', segment: {startMs: 0}},
    {act: 'hook', segment: {startMs: 5000}},
  ];
  assert.equal(checkOrder(matches)[0].level, 'PASS');
});

test('checkOrder: FAIL when a later act is heard before an earlier one finishes', () => {
  const matches = [
    {act: 'logo', segment: {startMs: 5000}},
    {act: 'hook', segment: {startMs: 0}},
  ];
  const finding = checkOrder(matches)[0];
  assert.equal(finding.level, 'FAIL');
});

test('checkTiming: PASS within tolerance; a span delta alone is WARN, not FAIL (whisper timestamp noise)', () => {
  const matches = [
    {act: 'logo', durationMs: 2870, segment: {startMs: 0, endMs: 2840}},
    {act: 'hook', durationMs: 2000, segment: {startMs: 0, endMs: 3000}},
  ];
  const findings = checkTiming(matches, {});
  assert.equal(findings[0].level, 'PASS'); // delta -0.03s
  assert.equal(findings[1].level, 'WARN'); // delta +1.0s but nothing says it landed in the wrong act
});

test('checkTiming: FAIL when the measured span falls outside its launchTiming act window', () => {
  const matches = [{act: 'hook', durationMs: 1000, segment: {startMs: 20000, endMs: 21000}}];
  const acts = {hook: {from: 0, len: 30}}; // act window is [0s, 1s] at 30fps — segment is nowhere near it
  const findings = checkTiming(matches, acts);
  assert.equal(findings[0].level, 'FAIL');
  assert.equal(findings[0].withinActWindow, false);
});

test('checkTiming: SKIPPED when the line was never heard', () => {
  const findings = checkTiming([{act: 'end', durationMs: 1000, segment: null}], {});
  assert.equal(findings[0].level, 'SKIPPED');
});

test('duckFinding: PASS when the music is measurably quieter during VO, WARN otherwise', () => {
  assert.equal(duckFinding('demo', -22, -18).level, 'PASS'); // music -18dB, VO window -22dB -> 4dB quieter
  assert.equal(duckFinding('hook', -18.7, -18.9).level, 'WARN'); // the real costclaw measurement (no clear signal)
});

test('neighborGapWindow: picks the larger of the two neighboring gaps, above the minimum duration', () => {
  const segments = [
    {startMs: 0, endMs: 1000},
    {startMs: 1200, endMs: 2000}, // 200ms gap before, too short to use
    {startMs: 5000, endMs: 6000}, // 3000ms gap after segment[1]
  ];
  const gap = neighborGapWindow(segments, 1);
  assert.deepEqual(gap, {startMs: 2000, endMs: 5000});
});

test('neighborGapWindow: null at the very start/end with no usable neighbor', () => {
  const segments = [{startMs: 0, endMs: 1000}];
  assert.equal(neighborGapWindow(segments, 0), null);
});
