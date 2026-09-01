// node --test scripts/judge-av-sync.test.mjs
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {
  FPS,
  VO_LEAD,
  voFrameLen,
  actFor,
  checkVoOverruns,
  checkVoLead,
  checkCaptionDwell,
  checkFeatureCoverage,
  checkUnknownActs,
  checkWordText,
  checkWordFit,
  checkEstimatedWords,
  checkCueDiscipline,
  checkSfxTickDrift,
  checkHookOnset,
} from './judge-av-sync.mjs';

// A hand-built timing table (no dependency on launchTiming.ts internals).
const timing = {
  logo: {from: 0, len: 150},
  hook: {from: 150, len: 186},
  demo: {from: 336, len: 200},
  features: [
    {from: 536, len: 180},
    {from: 716, len: 180},
  ],
  end: {from: 896, len: 150},
};

test('voFrameLen mirrors ceil(durationMs/1000*FPS)', () => {
  assert.equal(voFrameLen(1000), FPS);
  assert.equal(voFrameLen(1001), FPS + 1); // ceil rounds up
  assert.equal(voFrameLen(7970), 240);
});

test('actFor resolves named and feature-N acts, null for unknown', () => {
  assert.equal(actFor('logo', timing), timing.logo);
  assert.equal(actFor('feature-1', timing), timing.features[1]);
  assert.equal(actFor('feature-9', timing), null);
  assert.equal(actFor('bogus', timing), null);
});

test('checkVoOverruns: clean line produces no finding', () => {
  // logo act = 150f, available = 138f. 3000ms -> 90f < 138f.
  const findings = checkVoOverruns([{act: 'logo', durationMs: 3000, text: 'a b c'}], timing);
  assert.equal(findings.length, 0);
});

test('checkVoOverruns: overrun reports ms + words to cut', () => {
  // hook act = 186f, available = 174f. Need vf > 174 -> durationMs > 5800ms.
  // 8 words at 7000ms. vf = ceil(210) = 210. overrun = 210-174 = 36f = 1200ms.
  const line = {act: 'hook', durationMs: 7000, text: 'one two three four five six seven eight'};
  const findings = checkVoOverruns([line], timing);
  assert.equal(findings.length, 1);
  const f = findings[0];
  assert.equal(f.check, 'vo-overrun');
  assert.equal(f.level, 'FAIL');
  assert.equal(f.overrunMs, 1200);
  // msPerWord = 7000/8 = 875 -> ceil(1200/875) = 2 words.
  assert.equal(f.wordsToCut, 2);
  assert.match(f.message, /trim the copy/);
});

test('checkVoOverruns: exact fit (vf == available) is not an overrun', () => {
  // available for logo = 138f. durationMs that yields exactly 138f: 138/30*1000 = 4600ms.
  const findings = checkVoOverruns([{act: 'logo', durationMs: 4600, text: 'x y'}], timing);
  assert.equal(voFrameLen(4600), 138);
  assert.equal(findings.length, 0);
});

test('checkVoLead: act shorter than the lead-in fails', () => {
  const tiny = {...timing, logo: {from: 0, len: VO_LEAD}};
  const findings = checkVoLead([{act: 'logo', durationMs: 100, text: 'x'}], tiny);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, 'vo-lead');
});

test('checkCaptionDwell: flags steps closer than 700ms, ignores clicks/focus', () => {
  const events = [
    {type: 'step', t: 0, label: 'A'},
    {type: 'click', t: 100, x: 0, y: 0},
    {type: 'step', t: 500, label: 'B'}, // 500ms after A -> too fast
    {type: 'step', t: 1500, label: 'C'}, // 1000ms after B -> ok
  ];
  const findings = checkCaptionDwell(events);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].gapMs, 500);
  assert.equal(findings[0].from, 'A');
  assert.equal(findings[0].to, 'B');
});

test('checkCaptionDwell: all-spaced steps are clean', () => {
  const events = [
    {type: 'step', t: 0, label: 'A'},
    {type: 'step', t: 800, label: 'B'},
    {type: 'step', t: 1600, label: 'C'},
  ];
  assert.equal(checkCaptionDwell(events).length, 0);
});

test('checkFeatureCoverage: feature with copy but no VO line fails', () => {
  const features = [
    {heading: 'Guardrails', lines: ['a']},
    {heading: 'Ledger', lines: ['b']},
  ];
  const lines = [{act: 'feature-0', durationMs: 1000, text: 'x'}]; // feature-1 missing
  const findings = checkFeatureCoverage(features, lines);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].act, 'feature-1');
});

test('checkFeatureCoverage: full coverage is clean', () => {
  const features = [{heading: 'A', lines: ['x']}];
  const lines = [{act: 'feature-0', durationMs: 1000, text: 'x'}];
  assert.equal(checkFeatureCoverage(features, lines).length, 0);
});

test('checkUnknownActs: bad act reference is caught', () => {
  const findings = checkUnknownActs([{act: 'feature-99', durationMs: 1000, text: 'x'}], timing);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, 'unknown-act');
});

// --- word-locked timing checks --------------------------------------------

const wordLine = (over = {}) => ({
  act: 'hook',
  durationMs: 2000,
  text: 'See spend leaks',
  words: [
    {w: 'See', startMs: 0, endMs: 350},
    {w: 'spend', startMs: 400, endMs: 900},
    {w: 'leaks', startMs: 1000, endMs: 1500},
  ],
  ...over,
});

// Every line the repo ships today: no `words` key at all.
const plainLines = [
  {act: 'hook', durationMs: 4000, text: 'a b'},
  {act: 'logo', durationMs: 2000, text: 'c d'},
];

test('checkWordText: a table that reconstructs its text is clean', () => {
  assert.equal(checkWordText([wordLine()]).length, 0);
});

test('checkWordText: a table aligned to another sentence fails', () => {
  const findings = checkWordText([wordLine({text: 'See waste leaks'})]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, 'word-text-mismatch');
  assert.equal(findings[0].level, 'FAIL');
  assert.equal(findings[0].act, 'hook');
});

test('checkWordFit: spoken words inside the act are clean', () => {
  // hook act = 186f, available = 174f. Last word ends at 5000ms -> 150f.
  const line = wordLine({words: [{w: 'x', startMs: 0, endMs: 5000}], text: 'x'});
  assert.equal(checkWordFit([line], timing).length, 0);
});

test('checkWordFit: words past the act report the overrun in ms', () => {
  // 7000ms -> 210f, available 174f, overrun 36f = 1200ms.
  const line = wordLine({words: [{w: 'x', startMs: 0, endMs: 7000}], text: 'x'});
  const findings = checkWordFit([line], timing);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, 'word-overrun');
  assert.equal(findings[0].level, 'FAIL');
  assert.equal(findings[0].overrunMs, 1200);
});

test('checkEstimatedWords: even-distribution times warn, measured ones do not', () => {
  const findings = checkEstimatedWords([wordLine({wordsEstimated: true})]);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].check, 'estimated-word-times');
  assert.equal(findings[0].level, 'WARN');
  assert.equal(checkEstimatedWords([wordLine()]).length, 0);
});

test('checkCueDiscipline: a back-weighted, on-word cue set is clean', () => {
  const cues = [{act: 'hook', frames: [100, 130, 160], wordFrames: [100, 130, 160], actLen: 186}];
  assert.deepEqual(checkCueDiscipline(cues), []);
});

test('checkCueDiscipline: three cues inside one beat fail on density', () => {
  const cues = [{act: 'hook', frames: [100, 102, 104], wordFrames: [100, 102, 104], actLen: 186}];
  const density = checkCueDiscipline(cues).filter((f) => f.check === 'cue-density');
  assert.equal(density.length, 1);
  assert.equal(density[0].level, 'FAIL');
  assert.equal(density[0].cuesInBeat, 3);
});

test('checkCueDiscipline: cues bunched in the first half warn', () => {
  const cues = [{act: 'hook', frames: [10, 40, 70], wordFrames: [10, 40, 70], actLen: 186}];
  const front = checkCueDiscipline(cues).filter((f) => f.check === 'cue-front-loaded');
  assert.equal(front.length, 1);
  assert.equal(front[0].level, 'WARN');
});

test('checkCueDiscipline: an unmatched display unit warns', () => {
  const cues = [{act: 'hook', frames: [100, null, 160], wordFrames: [100, 160], actLen: 186}];
  const unmatched = checkCueDiscipline(cues).filter((f) => f.check === 'cue-unmatched');
  assert.equal(unmatched.length, 1);
  assert.equal(unmatched[0].level, 'WARN');
  assert.equal(unmatched[0].unmatched, 1);
});

test('checkCueDiscipline: a cue trailing its word past tolerance fails', () => {
  const cues = [{act: 'hook', frames: [19], wordFrames: [12, 100], actLen: 186}];
  const lag = checkCueDiscipline(cues).filter((f) => f.check === 'cue-lag');
  assert.equal(lag.length, 1);
  assert.equal(lag[0].level, 'FAIL');
  assert.equal(lag[0].lagFrames, 7);
});

test('checkCueDiscipline: no cues at all is clean', () => {
  assert.deepEqual(checkCueDiscipline([]), []);
});

test('checkSfxTickDrift: warns only for word-cued feature acts with sfx on', () => {
  const cues = [{act: 'feature-0', frames: [100], wordFrames: [100], actLen: 180}];
  assert.equal(checkSfxTickDrift(true, cues).length, 1);
  assert.equal(checkSfxTickDrift(true, cues)[0].level, 'WARN');
  assert.equal(checkSfxTickDrift(false, cues).length, 0);
  assert.equal(checkSfxTickDrift(true, [{act: 'hook', frames: [100]}]).length, 0);
});

test('every word check is a no-op on manifests with no word timings', () => {
  assert.deepEqual(checkWordText(plainLines), []);
  assert.deepEqual(checkWordFit(plainLines, timing), []);
  assert.deepEqual(checkEstimatedWords(plainLines), []);
});

test('checkHookOnset: a 150-frame logo act reports 5.0s at 30fps, no threshold', () => {
  // timing fixture above: logo.len = 150, 2 features -> logo+hook+demo+2+end = 6 acts.
  const onset = checkHookOnset(timing);
  assert.equal(onset.frame, 150);
  assert.equal(onset.seconds, 5.0);
  assert.equal(onset.actsResolved, 6);
  assert.equal(onset.message, 'hook copy on screen at frame 150 (5.0s); 6 acts resolved.');
});
